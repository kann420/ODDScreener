// Test script to find Syria market trade details
const apiKey = 'lJqHjNLlcncfG5xfCilcCEKUrospUwJn';
const wallet = '0x5f68f040ce9c7e4980b3a4d3a5dde17ea9db9fb6';

async function findSyriaTrades() {
  let allTrades = [];
  let page = 1;
  
  while (page <= 30) {
    // Correct endpoint: /trade/user/{wallet}
    const url = `https://openapi.opinion.trade/openapi/trade/user/${wallet}?chainId=56&page=${page}&limit=50`;
    const res = await fetch(url, { headers: { apikey: apiKey } });
    const data = await res.json();
    
    if (!data.result?.list?.length) break;
    allTrades = allTrades.concat(data.result.list);
    page++;
  }
  
  console.log(`Total trades fetched: ${allTrades.length}`);
  
  // Find Syria trades
  const syriaTrades = allTrades.filter(t => 
    (t.marketTitle || '').toLowerCase().includes('syria')
  );
  
  if (syriaTrades.length) {
    console.log('\n=== Syria Trades ===');
    
    // Show ALL fields from first trade
    console.log('\n[First Trade Full Object]:');
    console.log(JSON.stringify(syriaTrades[0], null, 2));
    
    // Summarize all trades
    console.log('\n[Trade Summary]:');
    let netShares = 0;
    let totalBought = 0;
    let totalSold = 0;
    
    for (const t of syriaTrades) {
      const shares = Number(t.shares || t.qty || 0);
      const amount = Number(t.amount || t.usdAmount || 0);
      const side = (t.side || '').toUpperCase();
      
      if (side === 'BUY') {
        netShares += shares;
        totalBought += amount;
      } else if (side === 'SELL') {
        netShares -= shares;
        totalSold += amount;
      }
      
      console.log(`  ${side}: ${shares.toFixed(2)} shares @ ${t.price} = $${amount.toFixed(2)}`);
    }
    
    console.log(`\nNet Shares Held: ${netShares.toFixed(2)}`);
    console.log(`Total Bought: $${totalBought.toFixed(2)}`);
    console.log(`Total Sold: $${totalSold.toFixed(2)}`);
    console.log(`Trade P&L (sell - buy): $${(totalSold - totalBought).toFixed(2)}`);
    
    // Opinion says: User bought 99.94 shares YES @ $99.94, won +$0.69
    // If user WON: payout = 99.94 * $1 = $99.94
    // cost = $99.94 -> profit should be ~$0
    // But Opinion shows +$0.69, suggesting cost was less than $99.94
    
    // Calculate "if user won" vs "if user lost"
    console.log(`\nIf user WON (payout = netShares * $1):`);
    console.log(`  Payout: $${netShares.toFixed(2)}`);
    console.log(`  Profit: $${(netShares - totalBought + totalSold).toFixed(2)}`);
    
    console.log(`\nIf user LOST (payout = $0):`);
    console.log(`  Payout: $0`);
    console.log(`  Profit: $${(0 - totalBought + totalSold).toFixed(2)}`);
    
  } else {
    console.log('No Syria trades found');
    // Show some trade titles
    const titles = [...new Set(allTrades.map(t => t.marketTitle))].slice(0, 20);
    console.log('Some titles:', titles);
  }
}

findSyriaTrades().catch(console.error);
