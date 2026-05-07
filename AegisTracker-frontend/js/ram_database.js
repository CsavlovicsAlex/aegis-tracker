// ==========================================
// database.js - PURE DATA & LOGIC (Easily Testable)
// ==========================================

const Ram_database = {
  // --- 1. STATE ---
  currentUser: null,
  totalPortfolioValue: 1000.00,

  skins: [
    {id: 1, name: "AK-47 | Slate", float: 0.1502, price: 12.45},
    {id: 2, name: "M4A4 | Howl", float: 0.0423, price: 1245.99},
    {id: 3, name: "AWP | Dragon Lore", float: 0.0078, price: 2899.00},
    {id: 4, name: "Karambit | Fade", float: 0.0156, price: 789.50},
    {id: 5, name: "Glock-18 | Fade", float: 0.0089, price: 156.75},
    {id: 6, name: "Desert Eagle | Blaze", float: 0.0234, price: 425.30},
    {id: 7, name: "USP-S | Kill Confirmed", float: 0.1845, price: 89.99},
    {id: 8, name: "M9 Bayonet | Doppler", float: 0.0012, price: 1150.00},
    {id: 9, name: "AK-47 | Bloodsport", float: 0.0450, price: 85.50},
    {id: 10, name: "AWP | Asiimov", float: 0.2105, price: 120.00},
    {id: 11, name: "M4A1-S | Printstream", float: 0.0890, price: 180.25},
    {id: 12, name: "Butterfly Knife | Vanilla", float: 0.1200, price: 1850.00},
    {id: 13, name: "Desert Eagle | Printstream", float: 0.0420, price: 95.00},
    {id: 14, name: "Glock-18 | Water Elemental", float: 0.1100, price: 8.50},
    {id: 15, name: "MAC-10 | Disco Tech", float: 0.4500, price: 2.50},
    {id: 16, name: "AWP | Atheris", float: 0.0350, price: 12.00},
    {id: 17, name: "AK-47 | Redline", float: 0.1501, price: 22.50},
    {id: 18, name: "M4A4 | Neo-Noir", float: 0.0650, price: 35.00}
  ],

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

  assetData: {
    labels: ['Skins', 'Cases', 'Agents', 'Charms'],
    values: [600, 200, 150, 50],
    colors: ['#ff8c00', '#00ff7f', '#3b82f6', '#ff00ff']
  },

  rarityData: {
    labels: ['Mil-Spec (Blue)', 'Restricted (Purple)', 'Classified (Pink)', 'Covert (Red)'],
    values: [45, 25, 15, 15],
    colors: ['#4b69ff', '#8847ff', '#d32ce6', '#eb4b4b']
  },

  // --- 2. AUTH LOGIC ---
  login: function (username) {
    this.currentUser = username;
  },
  logout: function () {
    this.currentUser = null;
  },
  isLoggedIn: function () {
    return this.currentUser !== null;
  },

  // --- 3. CRUD LOGIC ---
  getSkinById: function (id) {
    return this.skins.find(skin => skin.id === id);
  },

  getSkinsChunk: function (startIndex, limit) {
    return this.skins.slice(startIndex, startIndex + limit);
  },

  getTotalSkinsCount: function () {
    return this.skins.length;
  },

  addSkin: function (skinData) {
    const newId = this.skins.length > 0 ? Math.max(...this.skins.map(s => s.id)) + 1 : 1;
    skinData.id = newId;
    this.skins.push(skinData);
  },

  updateSkin: function (id, updatedData) {
    const index = this.skins.findIndex(skin => skin.id === id);
    if (index !== -1) {
      this.skins[index] = {...this.skins[index], ...updatedData, id: id};
    }
  },

  deleteSkin: function (id) {
    this.skins = this.skins.filter(skin => skin.id !== id);
  }
};
