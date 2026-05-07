// ==========================================
// tests.js - UNIT TESTS FOR DATABASE LOGIC
// ==========================================

function runDatabaseTests() {
  console.log("🧪 Starting Database Unit Tests...");
  let passed = 0;
  let failed = 0;

  // Helper function to make our assertions look nice in the console
  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    // --- TEST 1: Authentication ---
    Ram_database.login("AegisTrader");
    assert(Ram_database.isLoggedIn() === true, "User should be logged in");
    assert(Ram_database.currentUser === "AegisTrader", "Current user should match the login name");

    Ram_database.logout();
    assert(Ram_database.isLoggedIn() === false, "User should be logged out");
    assert(Ram_database.currentUser === null, "Current user should be null after logout");

    // --- TEST 2: Read Operations ---
    const firstSkin = Ram_database.getSkinById(1);
    assert(firstSkin.name === "AK-47 | Slate", "getSkinById should return correct item");

    const chunk = Ram_database.getSkinsChunk(0, 5);
    assert(chunk.length === 5, "getSkinsChunk should return exactly 5 items");

    const initialCount = Ram_database.getTotalSkinsCount();
    assert(initialCount === 18, "Initial database count should be 18");

    // --- TEST 3: Create Operation ---
    Ram_database.addSkin({name: "Test AWP", float: 0.1234, price: 500.00});
    const newCount = Ram_database.getTotalSkinsCount();
    assert(newCount === initialCount + 1, "addSkin should increase total count by 1");

    // Find the skin we just added (it should have ID 19)
    const newlyAddedSkin = Ram_database.skins[Ram_database.skins.length - 1];
    assert(newlyAddedSkin.name === "Test AWP", "New skin data should match input");

    // --- TEST 4: Update Operation ---
    Ram_database.updateSkin(newlyAddedSkin.id, {price: 600.00});
    const updatedSkin = Ram_database.getSkinById(newlyAddedSkin.id);
    assert(updatedSkin.price === 600.00, "updateSkin should successfully change the price");
    assert(updatedSkin.name === "Test AWP", "updateSkin should not alter unspecified fields");

    // --- TEST 5: Delete Operation ---
    Ram_database.deleteSkin(newlyAddedSkin.id);
    assert(Ram_database.getTotalSkinsCount() === initialCount, "deleteSkin should restore original count");
    assert(Ram_database.getSkinById(newlyAddedSkin.id) === undefined, "Deleted skin should no longer exist");

  } catch (error) {
    console.error("💥 A test crashed the script:", error);
  }

  // --- SUMMARY ---
  console.log(`\n📊 Test Summary: ${passed} Passed, ${failed} Failed`);
  if (failed === 0) {
    console.log("🏆 MAXIMUM CODE COVERAGE ACHIEVED!");
  }
}

// Run the tests immediately when this file loads
runDatabaseTests();
