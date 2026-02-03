// Debug Polymarket trades for specific market
const POLY_WALLET = "0x052Ce60adc64101b42155dbD878d5A533baBb3FD";

async function debugPolyTrades() {
  try {
    // Fetch ALL trades with pagination using cursor
    console.log("=== FETCHING ALL TRADES WITH PAGINATION ===\n");
    
    let allTrades = [];
    let cursor = null;
    let page = 0;
    
    while (true) {
      page++;
      let url = `https://data-api.polymarket.com/trades?user=${POLY_WALLET.toLowerCase()}&limit=500`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }
      
      console.log(`Page ${page}: ${url.slice(0, 100)}...`);
      const response = await fetch(url);
      const data = await response.json();
      
      if (!data || data.length === 0) break;
      
      allTrades.push(...data);
      console.log(`  Got ${data.length} trades, total: ${allTrades.length}`);
      
      // Get cursor from last item (using timestamp or id)
      const lastTrade = data[data.length - 1];
      if (!lastTrade.cursor && !lastTrade.id) break;
      
      cursor = lastTrade.cursor || lastTrade.id;
      
      // Safety: max 10 pages
      if (page >= 10) break;
      
      // If less than limit, we've reached the end
      if (data.length < 500) break;
    }
    
    console.log(`\nTotal trades fetched: ${allTrades.length}`);
    
    // Find ALL Backpack $2B trades
    const backpackTrades = allTrades.filter(t => 
      t.title?.toLowerCase().includes("backpack") && 
      t.title?.includes("2B")
    );
    
    console.log("\n=== BACKPACK $2B TRADES ===");
    console.log("Found", backpackTrades.length, "trades\n");
    
    // Sort by timestamp
    backpackTrades.sort((a, b) => a.timestamp - b.timestamp);
    
    let totalBought = 0, totalSold = 0;
    let sharesBought = 0, sharesSold = 0;
    
    backpackTrades.forEach((t, i) => {
      const shares = Number(t.size) || 0;
      const price = Number(t.price) || 0;
      const amount = shares * price;
      const side = (t.side || '').toUpperCase();
      const date = new Date(t.timestamp * 1000).toISOString().slice(0,19);
      
      console.log(`${i + 1}. ${side} ${shares.toFixed(4)} shares @ ${(price * 100).toFixed(1)}¢ = $${amount.toFixed(4)} | ${t.outcome} | ${date}`);
      
      if (side === 'BUY') { totalBought += amount; sharesBought += shares; }
      if (side === 'SELL') { totalSold += amount; sharesSold += shares; }
    });
    
    console.log("\n=== SUMMARY ===");
    console.log(`Shares: Bought ${sharesBought.toFixed(2)}, Sold ${sharesSold.toFixed(2)}, Net: ${(sharesBought - sharesSold).toFixed(2)}`);
    console.log(`Amount: Bought $${totalBought.toFixed(2)}, Sold $${totalSold.toFixed(2)}`);
    console.log(`P&L: $${(totalSold - totalBought).toFixed(2)}`);
    
    // Also check activity for comparison
    console.log("\n\n=== CHECKING ACTIVITY ENDPOINT ===");
    const activityUrl = `https://data-api.polymarket.com/activity?user=${POLY_WALLET.toLowerCase()}&limit=1000`;
    const activityResponse = await fetch(activityUrl);
    const activities = await activityResponse.json();
    
    const backpackActivities = activities.filter(a => 
      a.title?.toLowerCase().includes("backpack") &&
      a.title?.includes("2B")
    );
    
    console.log(`Found ${backpackActivities.length} Backpack $2B activities`);
    
    // Check if there are any activities that are not in trades
    const tradeHashes = new Set(backpackTrades.map(t => t.transactionHash));
    const missingActivities = backpackActivities.filter(a => !tradeHashes.has(a.transactionHash));
    
    if (missingActivities.length > 0) {
      console.log(`\nWARNING: ${missingActivities.length} activities not found in trades!`);
      missingActivities.forEach((a, i) => {
        console.log(`  ${i + 1}. ${a.type} @ ${a.price} | ${a.outcome} | txHash: ${a.transactionHash?.slice(0, 20)}...`);
      });
    }
    
  } catch (error) {
    console.error("Error:", error.message);
    console.error(error.stack);
  }
}

debugPolyTrades();
