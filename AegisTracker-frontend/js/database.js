// ==========================================
// database.js - API REPOSITORY & OFFLINE SYNC
// ==========================================

const API_BASE = CONFIG.API_BASE;

const Database = {
  marketData: {
    trending: [
      {name: "M4A1-S | Printstream", wear: "Minimal Wear", price: 185.50},
      {name: "AWP | Atheris", wear: "Factory New", price: 12.00},
      {name: "AK-47 | Bloodsport", wear: "Field-Tested", price: 85.20}
    ],
    new: [
      {name: "Desert Eagle | Printstream", wear: "Factory New", price: 95.00},
      {name: "Glock-18 | Water Elemental", wear: "Minimal Wear", price: 8.50}
    ],
    roi: [
      {name: "MAC-10 | Disco Tech", wear: "Battle-Scarred", price: 2.50, note: "+15% 7d trend"},
      {name: "P250 | Sand Dune", wear: "Well-Worn", price: 0.10, note: "Meme stock"}
    ]
  },

  // --- 1. STATE & AUTH ---
  currentUser: null,

  login: async function (username) {
    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: username})
    });

    if (response.ok) {
      this.currentUser = username
      const userData = await response.json();

      // Save the user data to the browser's Local Storage!
      localStorage.setItem('currentUser', JSON.stringify(userData));
      console.log("Logged in successfully!", userData);

      // Example logic to change the UI based on permissions:
      if (userData.permissions.includes("VIEW_ALL_USERS")) {
        console.log("Welcome Admin! Unlocking Admin Panel...");
      }
      return true;
    } else {
      console.error("Login failed. User not found.");
      return false;
    }
  },
  logout: function () {
    this.currentUser = null;
  },
  isLoggedIn: function () {
    return this.currentUser !== null;
  },

  // --- 2. OFFLINE SYNC MECHANICS ---
  localSkinsCache: [], // Local memory to hold skins for offline viewing
  actionQueue: [],     // The list of actions to perform when back online
  isSyncing: false,

  // Helper to check if we are online
  isOnline: function () {
    return navigator.onLine;
  },

  // --- WEBSOCKET LISTENER ---
  initWebSocket: function () {
    // Note the "ws://" protocol instead of "http://"
    const ws = new WebSocket(CONFIG.WS_BASE);

    ws.onopen = () => console.log("📞 WebSocket connection established!");

    ws.onmessage = (event) => {
      const newItems = JSON.parse(event.data);
      console.log("🔔 WebSocket Alert: New items generated!", newItems);

      // 1. Add them to the top of our local cache
      newItems.forEach(item => this.localSkinsCache.unshift(item));

      // 2. Dispatch a custom event to tell the UI to refresh!
      window.dispatchEvent(new Event('liveDataReceived'));
    };

    ws.onclose = () => console.log("📵 WebSocket disconnected.");
  },

  // The Synchronization Loop
  syncWithServer: async function () {
    if (this.isSyncing || this.actionQueue.length === 0 || !this.isOnline()) return;

    console.log("🔄 Network restored! Starting background sync...");
    this.isSyncing = true;

    // Process the queue one by one in chronological order
    while (this.actionQueue.length > 0) {
      // Look at the first item, but don't remove it yet
      const action = this.actionQueue[0];

      try {
        if (action.type === 'POST') {
          const response = await fetch(`${API_BASE}/skins`, {
            method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(action.payload)
          });

          if (response.ok) {
            const savedSkin = await response.json();

            const index = this.localSkinsCache.find(s => s.id === action.payload.id);
            if (index !== -1) {
              this.localSkinsCache[index] = savedSkin
            }
          }
        } else if (action.type === 'PUT') {
          await fetch(`${API_BASE}/skins/${action.id}`, {
            method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(action.payload)
          });
        } else if (action.type === 'DELETE') {
          await fetch(`${API_BASE}/skins/${action.id}`, {method: "DELETE"});
        }

        // If successful, remove it from the queue
        this.actionQueue.shift();
      } catch (error) {
        console.error("❌ Sync failed, server might still be unreachable.", error);
        break; // Stop the loop, we will try again later
      }
    }

    this.isSyncing = false;
    console.log("✅ Sync complete!");

    // Force a fresh fetch from the server to ensure IDs and data are perfectly aligned
    if (this.actionQueue.length === 0) {
      this.getSkinsChunk(0, 100);
    }
  },

  // --- 3. API CRUD LOGIC (Upgraded for Offline) ---

  getSkinsChunk: async function (skip, limit) {
    if (this.isOnline()) {
      try {
        const response = await fetch(`${API_BASE}/skins?skip=${skip}&limit=${limit}`);
        if (!response.ok)
          throw new Error("Server unreachable");

        const data = await response.json();

        // merge our local cache with the new data from the server
        data.forEach(fetchedItem => {
          const index = this.localSkinsCache.findIndex(localItem => localItem.id === fetchedItem.id)
          if (index !== -1) {
            this.localSkinsCache[index] = fetchedItem
          } else {
            this.localSkinsCache.push(fetchedItem)
          }
        })

        return data;
      } catch (error) {
        console.log(error);
        console.warn("⚠️ Server unreachable, falling back to local memory.");
      }
    }
    // OFFLINE FALLBACK: Return the slice from our RAM cache
    return this.localSkinsCache.slice(skip, skip + limit);
  },

  getSkinById: async function (id) {
    // Always check local cache first for speed and offline support
    let skin = this.localSkinsCache.find(skin => skin.id === id);
    if (skin) return skin;

    // If not in cache and online, try fetching it
    const allSkins = await this.getSkinsChunk(0, 100);
    return allSkins.find(skin => skin.id === id);
  },

  addSkin: async function (skinData) {
    // 1. Optimistic Local Update
    const tempId = Date.now(); // Give it a temporary ID based on time
    skinData.id = tempId;
    this.localSkinsCache.push(skinData);

    // 2. Network / Queue Logic
    if (this.isOnline() && !this.isSyncing && this.actionQueue.length === 0) {
      try {
        const response = await fetch(`${API_BASE}/skins`, {
          method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(skinData)
        });
        if (!response.ok) throw new Error();

        // overwrite the temporary id
        const savedSkin = response.json();
        const index = this.localSkinsCache.findIndex(skin => skin.id === savedSkin.id);
        if (index !== -1) this.localSkinsCache[index] = savedSkin;
      } catch (e) {
        console.log(e)
        this.actionQueue.push({type: 'POST', payload: skinData});
      }
    } else {
      this.actionQueue.push({type: 'POST', payload: skinData});

      if (this.isOnline() && !this.isSyncing) {
        this.syncWithServer();
      }
    }
  },

  updateSkin: async function (id, updatedData) {
    // 1. Optimistic Local Update
    const index = this.localSkinsCache.findIndex(s => s.id === id);
    if (index !== -1) {
      this.localSkinsCache[index] = {...this.localSkinsCache[index], ...updatedData};
    }

    // 2. Network / Queue Logic
    if (this.isOnline() && !this.isSyncing && this.actionQueue.length === 0) {
      try {
        const response = await fetch(`${API_BASE}/skins/${id}`, {
          method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(updatedData)
        });
        if (!response.ok) throw new Error();
        return await response.json();
      } catch (e) {
        console.log(e)
        this.actionQueue.push({type: 'PUT', id: id, payload: updatedData});
      }
    } else {
      this.actionQueue.push({type: 'PUT', id: id, payload: updatedData});
      if (this.isOnline && !this.isSyncing) this.syncWithServer();
    }
  },

  deleteSkin: async function (id) {
    // 1. Optimistic Local Update
    this.localSkinsCache = this.localSkinsCache.filter(s => s.id !== id);

    // 2. Network / Queue Logic
    if (this.isOnline() && !this.isSyncing && this.actionQueue.length === 0) {
      try {
        const response = await fetch(`${API_BASE}/skins/${id}`, {method: "DELETE"});
        if (!response.ok) throw new Error();
      } catch (e) {
        console.log(e)
        this.actionQueue.push({type: 'DELETE', id: id});
      }
    } else {
      this.actionQueue.push({type: 'DELETE', id: id});
      if (this.isOnline() && !this.isSyncing) this.syncWithServer();
    }
  },

  // Statistics logic
  getInventoryValue: async function () {
    const response = await fetch(`${API_BASE}/users/1/inventory/total_value`);
    return await response.json();
  },

  getAssetData: async function () {
    // Assuming a hardcoded user_id of 1 for now
    const response = await fetch(`${API_BASE}/users/1/inventory/asset_allocation`);
    return await response.json();
  },

  getRarityData: async function () {
    const response = await fetch(`${API_BASE}/users/1/inventory/rarity_distribution`);
    return await response.json();
  },

  getObservationList: async function (skip, limit) {
    const response = await fetch(`${API_BASE}/admin/observation-list?skip=${skip}&limit=${limit}`);
    if (response.ok) {
      return await response.json();
    }
    return [];
  },

  getSystemLogs: async function (skip, limit) {
    const response = await fetch(`${API_BASE}/admin/logs?skip=${skip}&limit=${limit}`);
    if (response.ok) {
      return await response.json();
    }
    return [];
  },
}

window.addEventListener('online', () => {
  Database.syncWithServer();
});

window.addEventListener('offline', () => {
  console.warn("📶 Network lost. Operating in offline mode.");
})

Database.initWebSocket();
