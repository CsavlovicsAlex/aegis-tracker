// ==========================================
// ui.js - PURE USER INTERFACE & DOM MANIPULATION (ASYNC)
// ==========================================

// --- 1. AUTHENTICATION UI (Remains synchronous because auth is currently local) ---
async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const answer = await Database.login(username);

  if (!answer) {
    alert("Incorrect credentials!");
    return;
  }

  document.getElementById('main-nav').style.display = 'flex';

  const userData = JSON.parse(localStorage.getItem('currentUser'));
  if (userData && userData.permissions.includes("VIEW_ALL_USERS")) {
    document.getElementById('nav-admin').style.display = 'block';
  } else {
    document.getElementById('nav-admin').style.display = 'none';
  }

  navigate('presentation-view');
  initChat();
}

function toggleLogoutBtn() {
  if (Database.isLoggedIn()) {
    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.style.display = logoutBtn.style.display === 'none' ? 'block' : 'none';
  }
}

function handleLogout() {
  Database.logout();

  document.getElementById('main-nav').style.display = 'none';
  document.getElementById('logout-btn').style.display = 'none';
  document.getElementById('login-form').reset();
  navigate('login-view');
}

// --- 2. MASTER VIEW (Infinite Scroll) ---
let itemsPerLoad = 25;
let currentlyDisplayed = 0; // How many items are actually on the screen
let prefetchBuffer = [];    // The hidden waiting room for the next chunk
let isFetching = false;     // Mutex lock for the network
let hasMoreData = true;     // Flag to tell us if the database is empty

async function loadInitialTable() {
  document.getElementById('table-body').innerHTML = "";
  currentlyDisplayed = 0;
  prefetchBuffer = [];
  hasMoreData = true;
  isFetching = false;

  // 1. Fetch the very first chunk and draw it immediately
  const initialData = await Database.getSkinsChunk(0, itemsPerLoad);
  renderItemsToTable(initialData);

  // 2. Silently fetch the next chunk into the background buffer!
  if (initialData.length === itemsPerLoad) {
    backgroundPrefetch();
  } else {
    hasMoreData = false; // The DB has less than 10 items total
  }
}

async function backgroundPrefetch() {
  // If we are already fetching, or there is no more data on the server, stop.
  if (isFetching || !hasMoreData) return;

  isFetching = true;

  // Calculate where the server should start reading from
  const offset = currentlyDisplayed + prefetchBuffer.length;
  const nextData = await Database.getSkinsChunk(offset, itemsPerLoad);

  if (nextData.length > 0) {
    // Add the new data to our hidden waiting room
    prefetchBuffer.push(...nextData);
  }

  if (nextData.length < itemsPerLoad) {
    // If the server gave us less than 10 items, we've reached the end of the DB
    hasMoreData = false;
  }

  isFetching = false;
}

async function loadMoreItems() {
  if (!hasMoreData && prefetchBuffer.length === 0) return; // Nothing left to show!

  if (prefetchBuffer.length > 0) {
    // THE MAGIC: The user hit the bottom. We instantly render from RAM, not the network!
    const itemsToRender = prefetchBuffer.splice(0, itemsPerLoad); // Take items out of the buffer
    renderItemsToTable(itemsToRender);

    // Now that the buffer is empty, silently fetch the next batch
    backgroundPrefetch();

  } else if (hasMoreData && !isFetching) {
    // FAILSAFE: If the user scrolled faster than our background fetch could finish,
    // we do a standard direct fetch.
    isFetching = true;
    const data = await Database.getSkinsChunk(currentlyDisplayed, itemsPerLoad);
    renderItemsToTable(data);
    isFetching = false;

    backgroundPrefetch(); // Queue up the next one
  }
}

// Helper function just to draw the HTML safely
function renderItemsToTable(items) {
  const tbody = document.getElementById('table-body');

  items.forEach(item => {
    // DOM Duplicate Check
    if (document.getElementById(`skin-row-${item.id}`)) return;

    const row = document.createElement('tr');
    row.id = `skin-row-${item.id}`;

    const displayFloat = item.float_value !== null && item.float_value !== undefined ? item.float_value.toFixed(4) : "N/A";
    const displayPrice = item.price !== null && item.price !== undefined ? item.price.toFixed(2) : "0.00";

    row.innerHTML = `
      <td class="skin-name-link" onclick="openSkinPresentation(${item.id})">${item.name}</td>
      <td>${displayFloat}</td>
      <td style="color: #00ff7f;">$${displayPrice}</td>
      <td>
        <button class="action-btn" onclick="openEditForm(${item.id})">Edit</button>
        <button class="action-btn" onclick="deleteItem(${item.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  currentlyDisplayed += items.length;
}

// The Scroll Listener (Remains the same!)
// --- THE UPGRADED SCROLL LISTENER ---
window.addEventListener('scroll', async function () {
  // Only trigger the infinite scroll if we are actively looking at the Master View
  if (document.getElementById('master-view').classList.contains('active')) {

    // Calculate how far down the user has scrolled on the whole page
    const scrollPosition = window.innerHeight + window.scrollY;
    const pageHeight = document.documentElement.scrollHeight;

    // If they are within 50 pixels of the bottom, load more!
    if (scrollPosition >= pageHeight - 50) {
      await loadMoreItems();
    }
  }
});

// --- 3. CREATE, UPDATE, DELETE UI ---
function openCreateForm() {
  document.getElementById('form-title').innerText = "Add New Skin";
  document.getElementById('crud-form').reset();
  document.getElementById('item-id').value = "";
  navigate('detail-view');
}

// ADDED ASYNC
async function openEditForm(id) {
  document.getElementById('form-title').innerText = "Edit Skin Details";
  const item = await Database.getSkinById(id); // ADDED AWAIT

  if (item) {
    document.getElementById('item-id').value = item.id;
    document.getElementById('item-name').value = item.name;
    document.getElementById('item-float').value = item.float_value !== null ? item.float_value : "";
    document.getElementById('item-price').value = item.price;
    navigate('detail-view');
  }
}

// ADDED ASYNC
async function saveItem(event) {
  event.preventDefault();

  const idInput = document.getElementById('item-id').value;
  const itemData = {
    name: document.getElementById('item-name').value,
    float_value: parseFloat(document.getElementById('item-float').value), // match Python key
    price: parseFloat(document.getElementById('item-price').value)
  };

  if (idInput === "") {
    await Database.addSkin(itemData); // ADDED AWAIT
  } else {
    await Database.updateSkin(parseInt(idInput), itemData); // ADDED AWAIT
  }

  await loadInitialTable(); // ADDED AWAIT
  navigate('master-view');
}

// ADDED ASYNC
async function deleteItem(id) {
  if (confirm("Are you sure you want to remove this item from your watchlist?")) {
    await Database.deleteSkin(id); // ADDED AWAIT
    await loadInitialTable(); // ADDED AWAIT
  }
}

// --- 4. PRESENTATION VIEW ---
let priceTrendChartInstance = null;

// ADDED ASYNC
async function openSkinPresentation(id) {
  const item = await Database.getSkinById(id); // ADDED AWAIT
  if (!item) return;

  document.getElementById('presentation-name').innerText = item.name;

  const safePrice = item.price !== null && item.price !== undefined ? item.price : 0;
  document.getElementById('presentation-price').innerText = `$${safePrice}`;

  document.getElementById('presentation-float').innerText =
    item.float_value !== null && item.float_value !== undefined
      ? item.float_value.toFixed(4)
      : "N/A";

  const rarity = safePrice > 500 ? "Covert Grade" : item.price > 100 ? "Classified Grade" : "Restricted Grade";
  document.getElementById('presentation-rarity').innerText = rarity;

  const mockLabels = Array.from({length: 30}, (_, i) => `Day ${i + 1}`);
  let mockPrices = [];
  let startingPrice = item.price * 0.8;
  for (let i = 0; i < 30; i++) {
    startingPrice += (Math.random() - 0.3) * (item.price * 0.05);
    mockPrices.push(startingPrice.toFixed(2));
  }
  mockPrices[29] = item.price;

  const ctx = document.getElementById('priceTrendChart').getContext('2d');
  if (priceTrendChartInstance) priceTrendChartInstance.destroy();

  priceTrendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: mockLabels,
      datasets: [{
        label: 'Market Price ($)', data: mockPrices,
        borderColor: '#00ff7f', backgroundColor: 'rgba(0, 255, 127, 0.1)',
        borderWidth: 2, fill: true, tension: 0.3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true, color: '#a0a0a0',
      plugins: {legend: {display: false}},
      scales: {
        y: {ticks: {color: '#a0a0a0'}},
        x: {ticks: {color: '#a0a0a0', maxTicksLimit: 10}}
      }
    }
  });

  navigate('skin-detail-view');
}

// --- 5. MARKET & INVENTORY UI ---
function switchTab(tabId) {
  // (Market UI relies on hardcoded data for now, so it stays synchronous)
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');

  const grid = document.getElementById('market-grid');
  grid.innerHTML = "";

  if (Database.marketData && Database.marketData[tabId]) {
    Database.marketData[tabId].forEach(item => {
      grid.innerHTML += `
          <div class="skin-card">
            <h3>${item.name}</h3>
            <p style="color: var(--text-muted);">${item.wear}</p>
            ${item.note ? `<p style="font-size: 0.8rem; margin-top: 5px; color: #ff9900;">${item.note}</p>` : ''}
            <div class="price">$${item.price.toFixed(2)}</div>
          </div>
        `;
    });
  }
}

let assetChartInstance = null;
let rarityChartInstance = null;

// Global variables to hold the chart data so the toggles work
let currentAssetData = null;
let currentRarityData = null;

function createChart(ctx, chartInstance, type, dataObj) {
  if (chartInstance) chartInstance.destroy();
  return new Chart(ctx, {
    type: type,
    data: {
      labels: dataObj.labels,
      datasets: [{
        data: dataObj.values, backgroundColor: dataObj.colors,
        borderColor: '#1e1e1e', borderWidth: 2
      }]
    },
    options: {
      responsive: true, color: '#a0a0a0', plugins: {legend: {display: false}},
      scales: type === 'bar' ? {
        y: {beginAtZero: true, ticks: {color: '#a0a0a0'}},
        x: {ticks: {color: '#a0a0a0'}}
      } : {}
    }
  });
}

function renderLegend(containerId, dataObj, isCurrency) {
  const legendContainer = document.getElementById(containerId);
  legendContainer.innerHTML = "";
  dataObj.labels.forEach((label, index) => {
    const displayValue = isCurrency ? `$${dataObj.values[index].toFixed(2)}` : `${dataObj.values[index]} Items`;
    legendContainer.innerHTML += `
      <div class="legend-row">
        <div class="legend-label">
          <div class="legend-color-box" style="background-color: ${dataObj.colors[index]};"></div>
          <span>${label}</span>
        </div>
        <div class="legend-value">${displayValue}</div>
      </div>
    `;
  });
}

function toggleAssetChart() {
  if (!currentAssetData) return;
  const isBar = document.getElementById('asset-chart-toggle').checked;
  document.getElementById('asset-chart-label').innerText = isBar ? "Bar Chart" : "Donut Chart";
  assetChartInstance = createChart(document.getElementById('assetChart').getContext('2d'), assetChartInstance, isBar ? 'bar' : 'doughnut', currentAssetData);
}

function toggleRarityChart() {
  if (!currentRarityData) return;
  const isBar = document.getElementById('rarity-chart-toggle').checked;
  document.getElementById('rarity-chart-label').innerText = isBar ? "Bar Chart" : "Donut Chart";
  rarityChartInstance = createChart(document.getElementById('rarityChart').getContext('2d'), rarityChartInstance, isBar ? 'bar' : 'doughnut', currentRarityData);
}

// --- 7. ADMIN DASHBOARD LOGIC ---
let adminCurrentPage = 0;
const ADMIN_ITEMS_PER_PAGE = 5;

async function loadAdminPage(direction = 0) {
  adminCurrentPage += direction;
  if (adminCurrentPage < 0) adminCurrentPage = 0;

  const skip = adminCurrentPage * ADMIN_ITEMS_PER_PAGE;
  const data = await Database.getObservationList(skip, ADMIN_ITEMS_PER_PAGE);

  const tbody = document.getElementById('admin-table-body');
  tbody.innerHTML = "";

  data.forEach(item => {
    // Format the scary red text for the reason
    tbody.innerHTML += `
      <tr>
        <td style="font-weight: bold;">User #${item.user_id}</td>
        <td style="color: #ff4444;">${item.reason}</td>
        <td style="color: var(--text-muted); font-size: 0.9rem;">${item.detected_at.replace('T', ' ').substring(0, 19)}</td>
      </tr>
    `;
  });

  // Update Pagination UI
  document.getElementById('admin-page-indicator').innerText = `Page ${adminCurrentPage + 1}`;
  document.getElementById('admin-prev').disabled = adminCurrentPage === 0;

  // If we got back fewer items than the limit, we hit the end!
  document.getElementById('admin-next').disabled = data.length < ADMIN_ITEMS_PER_PAGE;
}

// --- ADMIN TAB LOGIC ---
async function switchAdminTab(tabName) {
  // 1. Reset all buttons to inactive
  document.getElementById('tab-suspects').classList.remove('active');
  document.getElementById('tab-logs').classList.remove('active');

  // 2. Hide all panels
  document.getElementById('panel-suspects').style.display = 'none';
  document.getElementById('panel-logs').style.display = 'none';

  // 3. Activate the clicked tab and show its panel
  document.getElementById(`tab-${tabName}`).classList.add('active');
  document.getElementById(`panel-${tabName}`).style.display = 'block';

  // 4. Load the data!
  if (tabName === 'suspects') {
    await loadAdminPage(0); // Uses your existing suspect logic
  } else if (tabName === 'logs') {
    await loadSystemLogs(); // Calls the new function below
  }
}

async function loadSystemLogs() {
  // Fetch the latest 50 logs
  const logs = await Database.getSystemLogs(0, 50);
  const tbody = document.getElementById('admin-logs-table-body');
  tbody.innerHTML = "";

  logs.forEach(log => {
    // We display the exact formatted string the professor asked for!
    tbody.innerHTML += `
      <tr>
        <td style="color: var(--text-muted); width: 50px;">#${log.id}</td>
        <td style="font-family: monospace; color: #00ff7f;">${log.formatted_entry}</td>
      </tr>
    `;
  });
}

// --- 6. ROUTING ---
// ADDED ASYNC
async function navigate(viewId) {
  if (!Database.isLoggedIn() && viewId !== 'login-view') {
    alert("Please log in first!");
    return;
  }

  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

  if (viewId === 'master-view') {
    await loadInitialTable(); // ADDED AWAIT
  } else if (viewId === 'market-view') {
    switchTab('trending');
  } else if (viewId === 'inventory-view') {

    // --- CONNECTING YOUR PYTHON STATS API TO CHART.JS ---
    const rawAssetData = await Database.getAssetData();
    const rawRarityData = await Database.getRarityData();

    // Transform Python dictionary into Chart.js friendly arrays
    currentAssetData = {
      labels: Object.keys(rawAssetData).map(key => key.charAt(0).toUpperCase() + key.slice(1)), // Capitalize keys
      values: Object.values(rawAssetData),
      colors: ['#ff8c00', '#00ff7f', '#3b82f6', '#ff00ff', '#eab308']
    };

    currentRarityData = {
      labels: Object.keys(rawRarityData).map(key => key.charAt(0).toUpperCase() + key.slice(1)),
      values: Object.values(rawRarityData),
      colors: ['#b0c3d9', '#5e98d9', '#4b69ff', '#8847ff', '#d32ce6', '#eb4b4b', '#e4ae39']
    };

    // Calculate total portfolio value from the API data
    const totalValue = currentAssetData.values.reduce((sum, current) => sum + current, 0);

    document.getElementById('total-portfolio-value').innerText = `$${totalValue.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;

    renderLegend('asset-legend', currentAssetData, true);
    renderLegend('rarity-legend', currentRarityData, false);
    toggleAssetChart();
    toggleRarityChart();
  } else if (viewId === 'observation-list') {
    await loadAdminPage(0);
  } else if (viewId === 'admin-view') {
    await switchAdminTab('suspects'); // Default to the suspects tab!
  }
}

// --- LIVE DATA REFRESH LISTENER ---
window.addEventListener('liveDataReceived', async () => {
  // If the user is looking at the Master Table, reload it
  if (document.getElementById('master-view').classList.contains('active')) {
    await loadInitialTable();
  }
});

// --- 8. GLOBAL CHAT LOGIC ---
let chatSocket = null;

function initChat() {
  // Un-hide the chat box now that we are logged in
  document.getElementById('chat-container').style.display = 'flex';

  // Connect to the chat WebSocket! (Using your config variable)
  chatSocket = new WebSocket(`${CONFIG.WS_BASE}/chat`);

  chatSocket.onmessage = function(event) {
    const messagesDiv = document.getElementById('chat-messages');

    // Add the new message to the UI
    messagesDiv.innerHTML += `<div style="margin-bottom: 5px;">${event.data}</div>`;

    // Auto-scroll to the bottom
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  };
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (input.value.trim() !== "" && chatSocket) {

    // Grab the username from Local Storage
    const userData = JSON.parse(localStorage.getItem('currentUser'));
    const username = userData ? userData.username : "Guest";

    // Format the message: "AegisAdmin: Hello!"
    const formattedMessage = `<b>${username}:</b> ${input.value}`;

    // Send it to the Python server
    chatSocket.send(formattedMessage);

    // Clear the input box
    input.value = '';
  }
}

// Add event listener so pressing "Enter" sends the message
document.getElementById('chat-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendChatMessage();
});
