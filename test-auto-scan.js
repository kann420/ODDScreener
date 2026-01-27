// test-auto-scan.js
// Test auto-scan feature
async function test() {
  try {
    console.log("Fetching auto-scan results...");
    const res = await fetch('http://localhost:3000/api/arbitage/scan?debug=1&limit=10');
    const json = await res.json();
    
    console.log("\n=== AUTO-SCAN RESULTS ===");
    console.log("OK:", json.ok);
    console.log("Total rows:", json.rows?.length || 0);
    console.log("Meta:", JSON.stringify(json.meta, null, 2));
    
    if (json.rows?.length) {
      console.log("\n=== FOUND OPPORTUNITIES ===");
      json.rows.forEach((row, i) => {
        console.log(`\n[${i+1}] ${row.title || row.opinionTitle || "Untitled"}`);
        console.log(`    Arb: ${row.arbPct?.toFixed(2)}%`);
        console.log(`    Similarity: ${(row.similarity * 100).toFixed(1)}%`);
        console.log(`    Strategy: ${row.strategy?.join(' + ')}`);
        console.log(`    Poly: ${row.poly?.title}`);
        console.log(`    Opinion: ${row.opinion?.title}`);
      });
    }
    
    // Show some debug info
    if (json.debug?.length) {
      console.log("\n=== DEBUG (first 10) ===");
      json.debug.slice(0, 10).forEach(d => {
        console.log(JSON.stringify(d));
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}
test();
