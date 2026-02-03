const apiKey = 'lJqHjNLlcncfG5xfCilcCEKUrospUwJn';
const wallet = '0x5f68f040ce9c7e4980b3a4d3a5dde17ea9db9fb6';

async function run() {
  let allTrades = [];
  for (let page = 1; page <= 12; page++) {
    const res = await fetch(`https://openapi.opinion.trade/openapi/trade/user/${wallet}?chainId=56&page=${page}&limit=20`, {
      headers: { apikey: apiKey }
    });
    const data = await res.json();
    allTrades = allTrades.concat(data.result.list);
  }
  
  const fedTrades = allTrades.filter(t => t.rootMarketTitle === 'US Fed Rate Decision in January?');
  console.log('=== US Fed Rate Decision in January? ===');
  console.log('Total trades:', fedTrades.length);
  
  const byOutcome = {};
  fedTrades.forEach(t => {
    const key = t.marketTitle + ':' + t.outcomeSide;
    if (!byOutcome[key]) byOutcome[key] = { name: t.marketTitle, outcome: t.outcome, buys: 0, sells: 0, profit: 0 };
    const shares = parseFloat(t.shares);
    const profit = parseFloat(t.profit);
    if (t.side === 'Buy') byOutcome[key].buys += shares;
    else byOutcome[key].sells += shares;
    byOutcome[key].profit += profit;
  });

  Object.entries(byOutcome).forEach(([key, d]) => {
    const net = d.buys - d.sells;
    console.log(`\n--- ${d.name} (${d.outcome}) ---`);
    console.log(`  Buy:  ${d.buys.toFixed(2)} shares`);
    console.log(`  Sell: ${d.sells.toFixed(2)} shares`);
    console.log(`  Net:  ${net.toFixed(2)} shares`);
    console.log(`  Profit: $${d.profit.toFixed(4)}`);
    console.log(`  Status: ${Math.abs(net) < 0.01 ? 'CLOSED (net=0)' : 'OPEN (holding ' + net.toFixed(2) + ' shares)'}`);
  });
}
run();
