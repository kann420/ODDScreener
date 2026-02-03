// Debug script for closed arbitrage P&L calculation

const PORT = 3000;
const POLY_WALLET = "0x052Ce60adc64101b42155dbD878d5A533baBb3FD";
const OPINION_WALLET = "0x5f68f040ce9c7e4980b3a4d3a5dde17ea9db9fb6";

async function debug() {
  try {
    const url = `http://localhost:${PORT}/api/arbitage/wallet-positions?polyWallet=${POLY_WALLET}&opinionWallet=${OPINION_WALLET}&type=closed`;
    console.log("Fetching:", url);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log("\n=== SUMMARY ===");
    console.log("closedArb count:", data.closedArb?.length || 0);
    
    if (data.closedArb?.length > 0) {
      // Find Backpack $2B specifically
      const backpack2B = data.closedArb.find(p => 
        p.marketTitle?.toLowerCase().includes("backpack") && 
        p.marketTitle?.includes("2B")
      );
      
      if (backpack2B) {
        console.log("\n=== BACKPACK FDV $2B MARKET ===");
        console.log(JSON.stringify(backpack2B, null, 2));
        
        console.log("\n=== KEY DEBUG VALUES ===");
        console.log("closedPnl:", backpack2B.closedPnl);
        console.log("polyPnl:", backpack2B.polyPnl);
        console.log("opinionPnl:", backpack2B.opinionPnl);
        console.log("totalBet:", backpack2B.totalBet);
        console.log("entryTotalCents:", backpack2B.entryTotalCents);
        console.log("_cashFlow:", backpack2B._cashFlow);
      } else {
        console.log("\n❌ Backpack $2B not found. Available markets:");
        data.closedArb.slice(0, 5).forEach((p, i) => {
          console.log(`${i + 1}. ${p.marketTitle} | P&L: $${p.closedPnl}`);
        });
      }
    } else {
      console.log("No closed arb pairs found");
    }
    
  } catch (error) {
    console.error("Error:", error.message);
  }
}

debug();
