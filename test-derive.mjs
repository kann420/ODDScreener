// Test deriveClosed with marketInfoMap
import { deriveClosedPositions, calculateClosedPnL } from './lib/walletTracker/deriveClosed.js';

const apiKey = 'lJqHjNLlcncfG5xfCilcCEKUrospUwJn';
const wallet = '0x5f68f040ce9c7e4980b3a4d3a5dde17ea9db9fb6';

async function test() {
  console.log('=== Testing deriveClosed with marketInfoMap ===\n');
  
  // 1. Fetch trades
  let allTrades = [];
  let page = 1;
  while (page <= 20) {
    const res = await fetch(`https://openapi.opinion.trade/openapi/trade/user/${wallet}?chainId=56&page=${page}&limit=50`, {
      headers: { apikey: apiKey }
    });
    const data = await res.json();
    const list = data.result?.list || [];
    if (list.length === 0) break;
    allTrades = allTrades.concat(list);
    page++;
  }
  console.log('Total trades:', allTrades.length);
  
  // 2. Fetch positions
  const posRes = await fetch(`https://openapi.opinion.trade/openapi/positions/user/${wallet}?chainId=56&page=1&limit=100`, {
    headers: { apikey: apiKey }
  });
  const positions = (await posRes.json()).result?.list || [];
  console.log('Active positions:', positions.length);
  
  // 3. Build marketInfoMap for Syria (3355)
  const marketInfoMap = new Map();
  
  // Fetch Syria market info
  const syriaRes = await fetch('https://openapi.opinion.trade/openapi/market/3355', {
    headers: { apikey: apiKey }
  });
  const syriaMarket = (await syriaRes.json()).result?.data;
  
  let winningOutcomeSide = null;
  if (syriaMarket.resultTokenId === syriaMarket.yesTokenId) {
    winningOutcomeSide = 1;
  } else if (syriaMarket.resultTokenId === syriaMarket.noTokenId) {
    winningOutcomeSide = 2;
  }
  
  console.log('\nSyria market 3355:');
  console.log('  winningOutcomeSide:', winningOutcomeSide);
  
  marketInfoMap.set('3355', {
    marketId: '3355',
    winningOutcomeSide,
    statusEnum: syriaMarket.statusEnum,
    resolvedAt: syriaMarket.resolvedAt,
  });
  
  console.log('\nmarketInfoMap:', [...marketInfoMap.entries()]);
  
  // 4. Call deriveClosedPositions
  console.log('\n=== Calling deriveClosedPositions ===');
  const closedPositions = deriveClosedPositions(allTrades, positions, marketInfoMap);
  
  // 5. Find Syria in closed positions
  const syriaClosedPos = closedPositions.find(p => p.marketId === 3355 || p.marketId === '3355');
  
  if (syriaClosedPos) {
    console.log('\n=== Syria Closed Position ===');
    console.log('  marketTitle:', syriaClosedPos.marketTitle);
    console.log('  result:', syriaClosedPos.result);
    console.log('  closedPnl:', syriaClosedPos.closedPnl);
    console.log('  closedPnlPercent:', syriaClosedPos.closedPnlPercent);
    console.log('  totalBet:', syriaClosedPos.totalBet);
    console.log('  isClaimed:', syriaClosedPos.isClaimed);
    console.log('  wasClaimedAndRemoved:', syriaClosedPos.wasClaimedAndRemoved);
  } else {
    console.log('\nSyria NOT found in closed positions!');
    console.log('Closed positions marketIds:', closedPositions.map(p => p.marketId));
  }
}

test().catch(console.error);
