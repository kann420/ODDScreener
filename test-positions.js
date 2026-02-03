// Quick test for positions API
const wallet = "0x41e07735e8eC0C4d53db47a2C20E8F56ED51c59C";
const url = `http://localhost:3000/api/opinion/wallet/${wallet}/positions?chainId=56&page=1&limit=3`;

console.log("Fetching:", url);

fetch(url)
  .then(r => r.json())
  .then(data => {
    if (data.errno !== 0) {
      console.log("Error:", data);
      return;
    }
    
    console.log("Total positions:", data.result?.total);
    console.log("\n--- Positions ---");
    
    (data.result?.list || []).forEach((p, i) => {
      console.log(`\n[${i + 1}]`);
      console.log("  displayTitle:", p.displayTitle);
      console.log("  thumbnailUrl:", p.thumbnailUrl);
      console.log("  rootMarketId:", p.rootMarketId);
    });
  })
  .catch(e => {
    console.error("Fetch error:", e.message);
  });
