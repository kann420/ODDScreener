---

name: wallet-track-guidelines

description: Guidelines for wallet tracking features including Polymarket/Opinion position tracking, trade history, P&L calculation, and arbitrage management.

---

## When to use

- Building or debugging wallet tracker features
- Calculating P&L for positions (open or closed)
- Fetching trade history from Polymarket or Opinion
- Arbitrage pair matching and management
- Debugging incorrect P&L values

## API Endpoints

### Polymarket Data API
Base URL: `https://data-api.polymarket.com`

**Positions (current holdings):**
```
GET /positions?user={wallet}&sizeThreshold=0.1&limit=100&sortBy=CURRENT_VALUE&sortDirection=DESC
```

**Trades:** ⚠️ May be incomplete
```
GET /trades?user={wallet}&limit=500
```

**Activity:** ✅ More complete, use for merging
```
GET /activity?user={wallet}&limit=1000
```
Filter by `type === 'TRADE'` for trade activities only.

### Opinion OpenAPI
Base URL: `https://openapi.opinion.trade/openapi`

**Positions:**
```
GET /positions/user/{wallet}?chainId=56&limit=100&page=1
```

**Trades:** (paginated, max 20 per page)
```
GET /trade/user/{wallet}?chainId=56&limit=20&page=1
```
Response fields:
- `type`: 1 = BUY, 2 = SELL
- `amount`: shares
- `price`: execution price
- `time`: timestamp in milliseconds

## P&L Calculation

### Cash Flow P&L (Recommended for Closed Positions)

```javascript
function calculateCashFlowPnL(trades) {
  let totalBought = 0;  // Money spent
  let totalSold = 0;    // Money received
  
  for (const trade of trades) {
    const usdValue = trade.size * trade.price;
    if (trade.side === 'BUY') {
      totalBought += usdValue;
    } else {
      totalSold += usdValue;
    }
  }
  
  return {
    totalBought,
    totalSold,
    pnl: totalSold - totalBought,  // Positive = profit
  };
}
```

### Trade Aggregation

Group trades by market/outcome, then calculate:

```javascript
function aggregateTrades(trades, marketKey) {
  const grouped = {};
  
  for (const trade of trades) {
    const key = `${trade.conditionId || trade.marketId}_${trade.outcome || trade.side}`;
    if (!grouped[key]) {
      grouped[key] = { buys: [], sells: [] };
    }
    
    if (trade.side === 'BUY') {
      grouped[key].buys.push(trade);
    } else {
      grouped[key].sells.push(trade);
    }
  }
  
  return Object.entries(grouped).map(([key, data]) => {
    const totalBought = data.buys.reduce((sum, t) => sum + t.size * t.price, 0);
    const totalSold = data.sells.reduce((sum, t) => sum + t.size * t.price, 0);
    const netShares = data.buys.reduce((sum, t) => sum + t.size, 0) 
                    - data.sells.reduce((sum, t) => sum + t.size, 0);
    
    return {
      key,
      totalBought,
      totalSold,
      netShares,
      pnl: totalSold - totalBought,
      isClosed: Math.abs(netShares) < 0.01,
    };
  });
}
```

## Closed Position Detection

A position is considered "closed" when:
- `netShares` is approximately 0 (< 0.01 threshold)
- OR market has resolved

```javascript
function isPositionClosed(position) {
  const threshold = 0.01;
  return Math.abs(position.netShares) < threshold;
}
```

## Arbitrage Pair Matching

### Active Pairs
Match by:
1. Market title similarity (fuzzy matching)
2. Opposite sides (Poly YES + Opinion NO, or vice versa)
3. Same outcome meaning (e.g., "Will X happen?" YES = "X" outcome)

### Closed Pairs
For closed arbitrage P&L:
```javascript
function createClosedArbPair(polyTrades, opinionTrades) {
  const polyAgg = aggregateTrades(polyTrades);
  const opinionAgg = aggregateTrades(opinionTrades);
  
  // Combined P&L
  const totalBought = polyAgg.totalBought + opinionAgg.totalBought;
  const totalSold = polyAgg.totalSold + opinionAgg.totalSold;
  const pnl = totalSold - totalBought;
  
  return {
    poly: polyAgg,
    opinion: opinionAgg,
    combined: { totalBought, totalSold, pnl },
  };
}
```

## Common Issues & Fixes

### 1. Incomplete Polymarket Trades
**Problem:** `/trades` endpoint missing recent trades.
**Solution:** Merge with `/activity` endpoint:
```javascript
// See polymarket-gamma-clob skill for full implementation
const trades = await fetchPolymarketTrades(wallet); // Merges both endpoints
```

### 2. Wrong Side Detection from Activity
**Problem:** Using `usdcSize < 0` to determine side.
**Solution:** Use `activity.side` directly - it's already "BUY" or "SELL".

### 3. Wrong Field Name for Shares
**Problem:** Using `activity.shares` (doesn't exist).
**Solution:** Use `activity.size` for share count.

### 4. Opinion Trade Type Mapping
**Problem:** Opinion API uses numeric types.
**Solution:** Map correctly:
```javascript
const side = trade.type === 1 ? 'BUY' : 'SELL';
```

### 5. Timestamp Format
**Problem:** Different timestamp formats.
**Solution:**
- Opinion: milliseconds (divide by 1000 for seconds)
- Polymarket: can be seconds or milliseconds, check magnitude

```javascript
function normalizeTimestamp(ts) {
  // If > year 2100 in seconds, it's milliseconds
  return ts > 4102444800 ? Math.floor(ts / 1000) : ts;
}
```

### 6. Resolution/Redeem Trades
**Problem:** Market resolution creates fake "trades" in data.
**Solution:** Filter by checking if price is market resolution price (0 or 1) or use activity type filter.

## Guardrails

- Always merge Polymarket `/trades` + `/activity` for complete data
- Use direct `side` field from Activity API, never derive from usdcSize
- Use `size` field not `shares` in Activity API
- Opinion timestamps are in milliseconds
- Consider resolution trades when calculating closed positions
- Cache trade data appropriately (30s-1min) to avoid rate limits
- Log aggregation results for debugging P&L issues

## Debug Logging

For P&L issues, log:
```javascript
console.log(`[createClosedArbPair] ${marketName}:
  Poly: bought=$${polyAgg.totalBought.toFixed(2)}, sold=$${polyAgg.totalSold.toFixed(2)}
  Opinion: bought=$${opinionAgg.totalBought.toFixed(2)}, sold=$${opinionAgg.totalSold.toFixed(2)}
  Combined P&L=$${pnl.toFixed(2)}`);
```

## Related Skills

- `polymarket-gamma-clob`: Full Polymarket API documentation
- `opinion-rest-markets`: Opinion market data APIs
- `smart-money-persistence`: Database persistence for tracking
