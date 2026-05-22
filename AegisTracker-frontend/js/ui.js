// ==========================================
// ui.js - PURE USER INTERFACE & DOM MANIPULATION (ASYNC)
// ==========================================

// --- 1. AUTHENTICATION UI
let inactivityTimer;
const INACTIVITY_LIMIT = 15 * 60 * 1000; // 15 minutes in milliseconds

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const answer = await Database.login(username, password);

  // --- 2FA GATE ---
  if (answer === '2fa_required') {
    // Nav stays hidden; route to the TOTP code entry view
    document.getElementById('two-factor-form').reset();
    document.getElementById('totp-feedback').style.display = 'none';
    navigate('two-factor-view');
    // Focus the code input so the user can type immediately
    setTimeout(() => document.getElementById('totp-code').focus(), 150);
    return;
  }

  if (!answer) {
    alert("Incorrect credentials!");
    return;
  }

  // --- NORMAL LOGIN SUCCESS ---
  document.getElementById('main-nav').style.display = 'flex';

  const userData = JSON.parse(sessionStorage.getItem('currentUser'));
  if (userData && userData.permissions.includes("VIEW_ALL_USERS")) {
    document.getElementById('nav-admin').style.display = 'block';
  } else {
    document.getElementById('nav-admin').style.display = 'none';
  }

  navigate('presentation-view');
  initChat();
}

async function handleRegister(event) {
  event.preventDefault();

  const usernameInput = document.getElementById('reg-username').value.trim();
  const steamIdInput = document.getElementById('reg-steamid').value.trim();
  const passwordInput = document.getElementById('reg-password').value;
  const confirmPasswordInput = document.getElementById('reg-confirm-password').value;

  // 1. Client-side security matching validation
  if (passwordInput !== confirmPasswordInput) {
    alert("Passwords do not match. Please try again.");
    return;
  }

  if (passwordInput.length < 8) {
    alert("Security requirement: Password must be at least 8 characters long.");
    return;
  }

  try {
    // 2. Execute network request through your existing Database handler
    await Database.register(usernameInput, passwordInput, steamIdInput);

    alert("Registration successful! You can now log in.");

    // 3. Clear form inputs safely
    document.getElementById('register-form').reset();

    // 4. Smoothly route back to login using your custom navigate system
    navigate('login-view');

  } catch (error) {
    // Displays exact error details passed up from Database.register
    alert(`Registration Error: ${error.message}`);
  }
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

// --- 2. 2FA UI HANDLERS ---

/**
 * Handles the TOTP code submission on the two-factor-view.
 * On success, finishes the login flow exactly like a normal login.
 */
async function handle2FAVerify(event) {
  event.preventDefault();
  const code = document.getElementById('totp-code').value.trim();
  const btn = document.getElementById('totp-submit-btn');
  const feedback = document.getElementById('totp-feedback');

  btn.disabled = true;
  btn.textContent = 'Verifying...';
  feedback.style.display = 'none';

  const ok = await Database.verify2FA(code);

  btn.disabled = false;
  btn.textContent = 'Verify Code';

  if (ok) {
    // Mirror the normal post-login boot sequence
    document.getElementById('main-nav').style.display = 'flex';
    const userData = JSON.parse(sessionStorage.getItem('currentUser'));
    if (userData && userData.permissions.includes('VIEW_ALL_USERS')) {
      document.getElementById('nav-admin').style.display = 'block';
    } else {
      document.getElementById('nav-admin').style.display = 'none';
    }
    navigate('presentation-view');
    initChat();
  } else {
    feedback.className = 'form-feedback error';
    feedback.textContent = '\u2717 Invalid or expired code. Please try again.';
    feedback.style.display = 'block';
    document.getElementById('totp-code').value = '';
    document.getElementById('totp-code').focus();
  }
}

/**
 * Opens the 2FA setup view for a logged-in user.
 * Calls /setup-2fa, then renders the returned provisioning URI as a QR code
 * using the qrcode.js library loaded via CDN.
 */
async function openSetup2FA() {
  navigate('setup-2fa-view');

  const data = await Database.setup2FA();
  if (!data) {
    alert('Could not start 2FA setup. Please try again.');
    return;
  }

  // Display the manual entry secret
  document.getElementById('totp-secret-display').textContent = data.secret;

  // Clear any previous QR code and render a fresh one
  const canvas = document.getElementById('qrcode-canvas');
  canvas.innerHTML = '';
  new QRCode(canvas, {
    text: data.provisioning_uri,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });

  // Reset the confirm form
  document.getElementById('confirm-2fa-form').reset();
  document.getElementById('confirm-2fa-feedback').style.display = 'none';
}

/**
 * Handles the confirmation step of 2FA enrollment.
 * Sends the typed code to /confirm-2fa; backend flips is_2fa_enabled = True.
 */
async function handle2FAConfirm(event) {
  event.preventDefault();
  const code = document.getElementById('confirm-totp-code').value.trim();
  const btn = document.getElementById('confirm-2fa-btn');
  const feedback = document.getElementById('confirm-2fa-feedback');

  btn.disabled = true;
  btn.textContent = 'Activating...';
  feedback.style.display = 'none';

  const ok = await Database.confirm2FA(code);

  btn.disabled = false;
  btn.textContent = 'Activate 2FA';

  if (ok) {
    feedback.className = 'form-feedback success';
    feedback.textContent = '\u2713 2FA is now active on your account! You will need your authenticator app on next login.';
    feedback.style.display = 'block';
    // Disable the button so they can't re-confirm
    btn.disabled = true;
  } else {
    feedback.className = 'form-feedback error';
    feedback.textContent = '\u2717 Code was invalid or expired. Please re-scan the QR code and try again.';
    feedback.style.display = 'block';
    document.getElementById('confirm-totp-code').value = '';
  }
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);

  // Only start the timer if they are actually logged in
  if (sessionStorage.getItem('jwt_token')) {
    inactivityTimer = setTimeout(logoutDueToInactivity, INACTIVITY_LIMIT);
  }
}

function logoutDueToInactivity() {
  alert("You have been logged out due to inactivity.");

  // Clear the sensitive data
  sessionStorage.removeItem('jwt_token');
  sessionStorage.removeItem('currentUser');

  // Redirect to login view
  navigate('login-view');
}

// Listen for activity across the whole document
document.addEventListener('mousemove', resetInactivityTimer);
document.addEventListener('keypress', resetInactivityTimer);
document.addEventListener('click', resetInactivityTimer);
document.addEventListener('scroll', resetInactivityTimer);

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

// --- 7. PASSWORD RECOVERY UI ---

/**
 * Step 1: Sends the recovery request and shows inline feedback.
 * The form is deliberately NOT cleared so the user can retry if they mistyped.
 */
async function handleForgotPassword(event) {
  event.preventDefault();
  const username = document.getElementById('recovery-username').value.trim();
  const btn = document.getElementById('recovery-submit-btn');
  const feedback = document.getElementById('recovery-feedback');

  // Disable button to prevent double-clicks
  btn.disabled = true;
  btn.textContent = 'Sending...';
  feedback.style.display = 'none';

  const ok = await Database.requestPasswordReset(username);

  btn.disabled = false;
  btn.textContent = 'Send Reset Link';

  // Always show the generic success message (matches the backend's enumeration-safe response)
  feedback.className = 'form-feedback success';
  feedback.textContent = ok
    ? '✓ If that username exists, a reset link has been printed to the server console.'
    : '✗ Network error. Please check your connection and try again.';
  feedback.style.display = 'block';
}

/**
 * Step 2: Validates the two password fields client-side, then calls the API.
 */
async function handleResetPassword(event) {
  event.preventDefault();
  const token = document.getElementById('reset-token').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-new-password').value;
  const btn = document.getElementById('reset-submit-btn');
  const feedback = document.getElementById('reset-feedback');

  feedback.style.display = 'none';

  // Client-side guard: passwords must match
  if (newPassword !== confirmPassword) {
    feedback.className = 'form-feedback error';
    feedback.textContent = '✗ Passwords do not match. Please try again.';
    feedback.style.display = 'block';
    return;
  }

  // Client-side guard: minimum length (backend enforces 6, we ask for 8 here)
  if (newPassword.length < 8) {
    feedback.className = 'form-feedback error';
    feedback.textContent = '✗ Password must be at least 8 characters.';
    feedback.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Updating...';

  const ok = await Database.submitNewPassword(token, newPassword);

  btn.disabled = false;
  btn.textContent = 'Update Password';

  if (ok) {
    feedback.className = 'form-feedback success';
    feedback.textContent = '✓ Password updated! Redirecting you to login...';
    feedback.style.display = 'block';
    document.getElementById('reset-password-form').reset();
    // Auto-redirect after 2 seconds so the user can read the success message
    setTimeout(() => navigate('login-view'), 2000);
  } else {
    feedback.className = 'form-feedback error';
    feedback.textContent = '✗ Reset link is invalid or has expired. Please request a new one.';
    feedback.style.display = 'block';
  }
}

/**
 * Updates the animated password strength bar and label.
 * Scoring is intentionally simple — it just counts character variety.
 */
function updatePasswordStrength(password) {
  const bar = document.getElementById('password-strength-bar');
  const label = document.getElementById('password-strength-label');

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { width: '0%',   color: 'var(--border-color)', text: '' },
    { width: '25%',  color: '#ff4444',             text: 'Weak' },
    { width: '50%',  color: '#ff9900',             text: 'Fair' },
    { width: '75%',  color: '#eab308',             text: 'Good' },
    { width: '100%', color: 'var(--accent-green)', text: 'Strong' },
    { width: '100%', color: 'var(--accent-green)', text: 'Strong' },
  ];

  const level = password.length === 0 ? levels[0] : levels[Math.max(1, score)];
  bar.style.setProperty('--strength-width', level.width);
  bar.style.setProperty('--strength-color', level.color);
  label.textContent = level.text;
  label.style.color = level.color;
}

// --- 6. ROUTING ---
// ADDED ASYNC
async function navigate(viewId) {
  const publicViews = ['login-view', 'register-view', 'forgot-password-view', 'reset-password-view', 'two-factor-view', 'setup-2fa-view'];
  if (!Database.isLoggedIn() && !publicViews.includes(viewId)) {
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
    let rawAssetData;
    let rawRarityData;
    try {
      rawAssetData = await Database.getAssetData();
      rawRarityData = await Database.getRarityData();
    } catch (error) {
      if (error.message === "UNAUTHORIZED") {
        alert("Session expired or unauthorized. Please log in.");
        await navigate('login-view');
      } else {
        console.error("A generic network error occurred.");
      }
      return;
    }

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
  } else if (viewId === 'chat-view') {
    const msgBox = document.getElementById('chat-messages');
    msgBox.scrollTop = msgBox.scrollHeight;
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
  // Connect to the SECURED chat WebSocket (sends JWT as first message)
  chatSocket = connectToGlobalChat();

  // If auth failed (no token), abort silently
  if (!chatSocket) {
    console.warn("Chat not initialized — user not authenticated.");
    return;
  }

  // Attach the message handler for incoming chat messages
  chatSocket.onmessage = function (event) {
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

    // Grab the username from Session Storage (not localStorage!)
    const userData = JSON.parse(sessionStorage.getItem('currentUser'));
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

// --- STARTUP: Auto-detect password reset token in the URL ---
// When the user clicks the link printed to the console by the backend, the page
// loads with a ?token= query parameter. We detect it here and route straight to
// the reset form so they don't have to do anything manually.
(function checkForResetToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (token) {
    // Inject the token into the hidden field on the reset form
    document.getElementById('reset-token').value = token;

    // Clean the token out of the URL bar (security: prevents bookmarking a one-time link)
    window.history.replaceState({}, document.title, window.location.pathname);

    // Route to the reset view — this view is public so no login check fires
    navigate('reset-password-view');
  }
})();

