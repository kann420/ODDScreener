// test-api.js - Test arbitrage API
async function test() {
  try {
    const res = await fetch('http://localhost:3000/api/arbitage/opportunities?mode=manual');
    const data = await res.json();
    
    // Show results
    console.log("=== ARBITRAGE RESULTS ===");
    console.log("Rows:", data.rows?.length || 0);
    
    if (data.rows?.length) {
      data.rows.forEach((row, i) => {
        console.log(`\n[${i+1}] ${row.title}`);
        console.log(`    Arb: ${row.arbPct?.toFixed(2)}%`);
        console.log(`    Strategy: ${row.strategy?.join(' + ')}`);
      });
    }
    
    // Show debug logs
    console.log("\n=== DEBUG LOGS ===");
    if (data.debug?.length) {
      data.debug.forEach(d => {
        console.log(JSON.stringify(d));
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}
test();
