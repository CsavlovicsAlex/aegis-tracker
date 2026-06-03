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

  login: async function (username, password) {
    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: username, password: password})
    });

    if (!response.ok) {
      console.error("Login failed. Incorrect username or password.");
      return false;
    }

    const data = await response.json();

    // --- 2FA GATE ---
    // The backend returns this shape when the user has 2FA enabled.
    // We store the pre-auth token and signal the UI to show the TOTP form.
    if (data.requires_2fa) {
      sessionStorage.setItem('pre_auth_token', data.pre_auth_token);
      console.log("2FA required — awaiting TOTP code.");
      return '2fa_required'; // Special sentinel so the UI can switch views
    }

    // --- NORMAL LOGIN ---
    const token = data.access_token;
    const userInfo = data.user;

    this.currentUser = userInfo.username;
    sessionStorage.setItem('jwt_token', token);
    sessionStorage.setItem('currentUser', JSON.stringify(userInfo));

    console.log("Logged in successfully!", userInfo);

    if (userInfo.permissions.includes("VIEW_ALL_USERS")) {
      console.log("Welcome Admin! Unlocking Admin Panel...");
    }

    return true;
  },

  async register(username, password, steamId) {
    try {
      const payload = {
        username: username,
        steam_id: steamId === "" ? null : steamId,
        password: password
      };

      // Uses the global API_BASE from config.js
      const response = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        // Throw the backend error message (e.g., "Username already registered")
        throw new Error(data.detail || "Registration failed");
      }

      return data; // Success response
    } catch (error) {
      console.error("Registration API error:", error);
      throw error;
    }
  },

  logout: function () {
    this.currentUser = null;
    // Clear all sensitive session data
    sessionStorage.removeItem('jwt_token');
    sessionStorage.removeItem('currentUser');
  },

  /**
   * Safely retrieves the JWT token from sessionStorage.
   * Returns the token string, or null if no session exists.
   */
  getAuthContext: function () {
    const token = sessionStorage.getItem('jwt_token');
    if (!token) {
      console.warn("getAuthContext: No JWT found in session.");
      return null;
    }
    return token;
  },
  isLoggedIn: function () {
    // 1. Check if the token exists in storage
    const hasToken = sessionStorage.getItem('jwt_token') !== null;

    // 2. If they have a token but JS memory was wiped (like after a refresh), restore it
    if (hasToken && this.currentUser === null) {
      const storedUser = sessionStorage.getItem('currentUser');
      if (storedUser) {
        this.currentUser = JSON.parse(storedUser).username;
      }
    }

    return hasToken;
  },

  getUserID: function () {
    // 1. Safely retrieve the user and token from session storage
    const userString = sessionStorage.getItem('currentUser');
    const token = sessionStorage.getItem('jwt_token');

    // 2. The Guard Clause: If either is missing, stop immediately
    if (!userString || !token) {
      // Return null (or an empty object {}) so your UI knows to show an empty chart or an error message
      throw new Error("UNAUTHORIZED");
    }

    // 3. Parse the user string only after confirming it exists
    const storedUser = JSON.parse(userString);
    return {
      userId: storedUser.id,
      token: token
    };
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
    const auth = this.getUserID();

    // Process the queue one by one in chronological order
    while (this.actionQueue.length > 0) {
      // Look at the first item, but don't remove it yet
      const action = this.actionQueue[0];

      try {
        if (action.type === 'POST') {
          const response = await fetch(`${API_BASE}/skins`, {
            method: "POST", headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` // Injects your secure JWT
        }, body: JSON.stringify(action.payload)
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
            method: "PUT", headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` // Injects your secure JWT
        }, body: JSON.stringify(action.payload)
          });
        } else if (action.type === 'DELETE') {
          await fetch(`${API_BASE}/skins/${action.id}`, {method: "DELETE", headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` // Injects your secure JWT
        }});
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
        const auth = this.getUserID(); // Retrieve the JWT from session storage
        const response = await fetch(`${API_BASE}/skins?skip=${skip}&limit=${limit}`, {method: "GET", headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` // Injects your secure JWT
        }});
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
        const auth = this.getUserID(); // Retrieve the JWT from session storage
        const response = await fetch(`${API_BASE}/skins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${auth.token}` // Injects your secure JWT
          },
          body: JSON.stringify(skinData)
        });
        if (!response.ok) throw new Error();

        // overwrite the temporary id
        const savedSkin = await response.json(); // await was missing here
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
        const auth = this.getUserID(); // Retrieve the JWT from session storage
        const response = await fetch(`${API_BASE}/skins/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${auth.token}` // Injects your secure JWT
          },
          body: JSON.stringify(updatedData)
        });
        if (!response.ok) throw new Error();
        return await response.json();
      } catch (e) {
        console.log(e)
        this.actionQueue.push({type: 'PUT', id: id, payload: updatedData});
      }
    } else {
      this.actionQueue.push({type: 'PUT', id: id, payload: updatedData});
      if (this.isOnline() && !this.isSyncing) this.syncWithServer(); // isOnline was missing ()
    }
  },

  deleteSkin: async function (id) {
    // 1. Optimistic Local Update
    this.localSkinsCache = this.localSkinsCache.filter(s => s.id !== id);

    // 2. Network / Queue Logic
    if (this.isOnline() && !this.isSyncing && this.actionQueue.length === 0) {
      try {
        const auth = this.getUserID(); // Retrieve the JWT from session storage
        const response = await fetch(`${API_BASE}/skins/${id}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${auth.token}` // Injects your secure JWT
          }
        });
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
    // TODO: should I keep this function call or is it safer to compute locally the inventory value?
    // TODO: should I hide the user id when calling the API?
    const response = await fetch(`${API_BASE}/users/1/inventory/total_value`);
    return await response.json();
  },

  getAssetData: async function () {
    // check and get the user ID
    const auth = this.getUserID();

    try {
      // make the secure request with the dynamic ID and the JWT
      const response = await fetch(`${API_BASE}/users/${auth.userId}/inventory/asset_allocation`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` // Injects your secure JWT
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.error("Unauthorized: Your session has expired.");
        }
        throw new Error(`Server returned ${response.status}`);
      }

      return await response.json();

    } catch (error) {
      console.error("Failed to fetch asset data:", error);
      throw new Error(error);
    }
  },

  getRarityData: async function () {
    const auth = this.getUserID();

    try {
      // make the secure request with the dynamic ID and the JWT
      const response = await fetch(`${API_BASE}/users/${auth.userId}/inventory/rarity_distribution`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` // Injects your secure JWT
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.error("Unauthorized: Your session has expired.");
        }
        throw new Error(`Server returned ${response.status}`);
      }

      return await response.json();

    } catch (error) {
      console.error("Failed to fetch asset data:", error);
      throw new Error(error);
    }
  },

  getObservationList: async function (skip, limit) {
    const auth = this.getUserID();
    const response = await fetch(`${API_BASE}/admin/observation-list?skip=${skip}&limit=${limit}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` // Injects your secure JWT
        }});
    if (response.ok) {
      return await response.json();
    }
    return [];
  },

  getSystemLogs: async function (skip, limit) {
    const auth = this.getUserID();
    const response = await fetch(`${API_BASE}/admin/logs?skip=${skip}&limit=${limit}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}` // Injects your secure JWT
        }});
    if (response.ok) {
      return await response.json();
    }
    return [];
  },

  // --- PASSWORD RECOVERY ---

  /**
   * Step 1: Request a password reset link for the given username.
   * The backend prints the reset link to the console (email simulation).
   * Always returns true — the backend's generic response prevents username enumeration.
   *
   * @param {string} username
   * @returns {Promise<boolean>} true if the request was sent without a network error
   */
  requestPasswordReset: async function (username) {
    try {
      const response = await fetch(`${API_BASE}/password-recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      // The backend always returns 200 regardless of whether the user exists,
      // so we only need to flag hard network / server errors.
      return response.ok;
    } catch (error) {
      console.error("requestPasswordReset: Network error —", error);
      return false;
    }
  },

  /**
   * Step 2: Submit the reset token (from the URL) and the user's chosen new password.
   *
   * @param {string} token      — The JWT extracted from the ?token= query parameter
   * @param {string} newPassword — The new plain-text password chosen by the user
   * @returns {Promise<boolean>} true on success, false if the token is invalid/expired
   */
  submitNewPassword: async function (token, newPassword) {
    try {
      const response = await fetch(`${API_BASE}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword })
      });

      if (!response.ok) {
        // 400 = token expired or invalid; surface the backend's detail message
        const errorData = await response.json();
        console.error("submitNewPassword failed:", errorData.detail);
        return false;
      }

      return true;
    } catch (error) {
      console.error("submitNewPassword: Network error —", error);
      return false;
    }
  },

  // --- TWO-FACTOR AUTHENTICATION ---

  /**
   * Step 2 of the 2FA login flow.
   * Sends the 6-digit TOTP code along with the pre-auth token stored in sessionStorage.
   * On success, saves the real session token and boots the app exactly like a normal login.
   *
   * @param {string} code — The 6-digit code from the user's authenticator app
   * @returns {Promise<boolean>} true on success
   */
  verify2FA: async function (code) {
    const preAuthToken = sessionStorage.getItem('pre_auth_token');
    if (!preAuthToken) {
      console.error("verify2FA: No pre-auth token found in session.");
      return false;
    }

    try {
      const response = await fetch(`${API_BASE}/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre_auth_token: preAuthToken, code: code })
      });

      if (!response.ok) {
        const err = await response.json();
        console.error("verify2FA failed:", err.detail);
        return false;
      }

      const data = await response.json();

      // Clean up the Level-1 pre-auth token — it has served its purpose
      sessionStorage.removeItem('pre_auth_token');

      // --- 3FA CASCADE ---
      // The backend no longer returns a session token here.
      // It returns a Level-2 pre-auth token that must pass biometrics first.
      if (data.requires_3fa) {
        sessionStorage.setItem('pre_auth_token_v2', data.pre_auth_token_v2);
        console.log("2FA verified — awaiting biometric confirmation (3FA).");
        return '3fa_required'; // Sentinel for the UI to switch to #three-factor-view
      }

      // Fallback: if for any reason the server returns a full token here, handle it
      this.currentUser = data.user.username;
      sessionStorage.setItem('jwt_token', data.access_token);
      sessionStorage.setItem('currentUser', JSON.stringify(data.user));
      return true;

    } catch (error) {
      console.error("verify2FA: Network error —", error);
      return false;
    }
  },

  /**
   * Step 3 (final) of the MFA login cascade.
   * Sends the Level-2 pre-auth token to /verify-3fa (simulated biometric endpoint).
   * On success, saves the real session token and cleans up all temporary tokens.
   *
   * @returns {Promise<boolean>} true on success
   */
  verify3FA: async function () {
    const preAuthTokenV2 = sessionStorage.getItem('pre_auth_token_v2');
    if (!preAuthTokenV2) {
      console.error("verify3FA: No Level-2 pre-auth token found in session.");
      return false;
    }

    try {
      const response = await fetch(`${API_BASE}/verify-3fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre_auth_token_v2: preAuthTokenV2 })
      });

      if (!response.ok) {
        const err = await response.json();
        console.error("verify3FA failed:", err.detail);
        return false;
      }

      const data = await response.json();

      // Clean up ALL temporary pre-auth tokens
      sessionStorage.removeItem('pre_auth_token');
      sessionStorage.removeItem('pre_auth_token_v2');

      // Store the real session token \u2014 login is now fully complete
      this.currentUser = data.user.username;
      sessionStorage.setItem('jwt_token', data.access_token);
      sessionStorage.setItem('currentUser', JSON.stringify(data.user));

      console.log("3FA complete! Logged in as:", data.user.username);
      return true;

    } catch (error) {
      console.error("verify3FA: Network error \u2014", error);
      return false;
    }
  },

  /**
   * Step 1 of 2FA enrollment (user must be logged in).

   * Requests a fresh TOTP secret from the backend and returns
   * { provisioning_uri, secret } so the UI can render the QR code.
   *
   * @returns {Promise<{provisioning_uri: string, secret: string}|null>}
   */
  setup2FA: async function () {
    try {
      const auth = this.getUserID();
      const response = await fetch(`${API_BASE}/setup-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`
        }
      });

      if (!response.ok) {
        console.error("setup2FA: Server error —", response.status);
        return null;
      }

      return await response.json(); // { provisioning_uri, secret }

    } catch (error) {
      console.error("setup2FA: Network error —", error);
      return null;
    }
  },

  /**
   * Step 2 of 2FA enrollment.
   * Sends a valid TOTP code to prove the user scanned the QR correctly.
   * The backend flips is_2fa_enabled = True only on success.
   *
   * @param {string} code — 6-digit code from the authenticator
   * @returns {Promise<boolean>}
   */
  confirm2FA: async function (code) {
    try {
      const auth = this.getUserID();
      const response = await fetch(`${API_BASE}/confirm-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`
        },
        body: JSON.stringify({ code: code })
      });

      if (!response.ok) {
        const err = await response.json();
        console.error("confirm2FA failed:", err.detail);
        return false;
      }

      return true;

    } catch (error) {
      console.error("confirm2FA: Network error —", error);
      return false;
    }
  },
}


window.addEventListener('online', () => {
  Database.syncWithServer();
});

window.addEventListener('offline', () => {
  console.warn("📶 Network lost. Operating in offline mode.");
})

Database.initWebSocket();

// ==========================================
// SECURED GLOBAL CHAT CONNECTION
// ==========================================

/**
 * Connects to the /ws/chat WebSocket with JWT authentication.
 * The token is sent as the FIRST message payload immediately on open,
 * because browser WebSockets do not support custom HTTP headers.
 *
 * @returns {WebSocket|null} The connected socket, or null if auth context is missing.
 */
function connectToGlobalChat() {
  // 1. Retrieve the JWT — abort if the user has no session
  let token;
  try {
    token = Database.getAuthContext();
  } catch (e) {
    console.error("connectToGlobalChat: Auth error —", e.message);
    return null;
  }

  if (!token) {
    console.warn("connectToGlobalChat: No token available. Aborting connection.");
    return null;
  }

  // 2. Dynamically build the WebSocket URL from the API base
  //    Replace http(s) with ws(s) to get the correct protocol
  const wsUrl = CONFIG.API_BASE.replace(/^http/, 'ws') + '/ws/chat';

  // 3. Open the WebSocket connection
  const chatSocket = new WebSocket(wsUrl);

  // 4. ON OPEN — immediately send the JWT as the first message
  chatSocket.onopen = function () {
    console.log("🔌 Chat WebSocket opened. Sending auth token...");
    chatSocket.send(JSON.stringify({ type: "auth", token: token }));
  };

  // 5. ON CLOSE — check for Policy Violation (expired/invalid token)
  chatSocket.onclose = function (event) {
    if (event.code === 1008) {
      // Server rejected the token (expired or invalid JWT)
      alert("Your session has expired. Please log in again.");
      Database.logout();
    } else {
      console.log(`📵 Chat WebSocket closed (code: ${event.code}).`);
    }
  };

  chatSocket.onerror = function (error) {
    console.error("Chat WebSocket error:", error);
  };

  return chatSocket;
}
