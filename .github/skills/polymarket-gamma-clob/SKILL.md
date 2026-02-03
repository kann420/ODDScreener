---

name: polymarket-gamma-clob

description: Polymarket integration for arbitrage and wallet tracking. Use Gamma for metadata (events/markets/outcomes), CLOB for prices/orderbook, and Data API for user positions/trades/activity.

---

## When to use

- Arbitrage scan between Opinion and Polymarket
- Mapping outcomes/tokens
- Reading orderbook best bid/ask and available size
- Fetching user positions, trades, and activity history
- Wallet tracking for P&L calculation

## API Endpoints

### 1. Gamma API (Metadata)
Base URL: `https://gamma-api.polymarket.com`

```
GET /events          - List events with markets
GET /events/{id}     - Single event details
GET /markets         - List markets
GET /markets/{id}    - Single market with tokens
```

### 2. CLOB API (Orderbook/Prices)
Base URL: `https://clob.polymarket.com`

**Public endpoints (no auth):**
```
GET /book?token_id={tokenId}     - Orderbook for token
GET /price?token_id={tokenId}    - Current price
GET /midpoint?token_id={tokenId} - Midpoint price
```

**Authenticated endpoints (L2 Auth required):**
```
GET /data/trades     - User's trade history (requires API key)
```
⚠️ CLOB authenticated endpoints require L2 credentials (apiKey, secret, passphrase).
Cannot use for querying OTHER users' trades.

### 3. Data API (User Data) ⭐ PRIMARY FOR WALLET TRACKING
Base URL: `https://data-api.polymarket.com`

**Positions:**
```
GET /positions?user={wallet}&sizeThreshold=0.1&limit=100&sortBy=CURRENT_VALUE&sortDirection=DESC
```
Response: Array of position objects with:
- `conditionId`, `title`, `slug`, `eventSlug`
- `outcome` ("Yes"/"No"), `outcomeIndex`
- `size` (shares), `currentValue`
- `avgPrice`, `initialValue`

**Trades:** ⚠️ MAY BE INCOMPLETE
```
GET /trades?user={wallet}&limit=500
```
Response: Array of trade objects with:
- `transactionHash`, `timestamp`, `conditionId`
- `title`, `slug`, `outcome`
- `side` ("BUY"/"SELL"), `size`, `price`

**Activity:** ✅ MORE COMPLETE THAN /trades
```
GET /activity?user={wallet}&limit=1000
```
Response: Array of activity objects with:
- `type`: "TRADE", "REDEEM", "DEPOSIT", etc.
- `transactionHash`, `timestamp`, `conditionId`
- `title`, `slug`, `outcome`, `outcomeIndex`
- `side`: "BUY" or "SELL" (direct field, not derived)
- `size`: shares amount
- `price`: execution price
- `usdcSize`: USD value (always positive)

## CRITICAL: Trade Data Completeness

**Problem:** The `/trades` endpoint sometimes returns INCOMPLETE data.
Recent trades may be missing, causing incorrect P&L calculations.

**Solution:** Always fetch from BOTH endpoints and merge:

```javascript
async function fetchPolymarketTrades(wallet) {
  // Step 1: Fetch from /trades endpoint
  const tradesUrl = `${DATA_API}/trades?user=${wallet.toLowerCase()}&limit=500`;
  const tradesResponse = await fetch(tradesUrl);
  let trades = await tradesResponse.json() || [];
  
  // Step 2: Fetch from /activity endpoint (more complete)
  const activityUrl = `${DATA_API}/activity?user=${wallet.toLowerCase()}&limit=1000`;
  const activityResponse = await fetch(activityUrl);
  const activities = await activityResponse.json() || [];
  
  // Step 3: Merge missing trades from activity
  const tradeHashes = new Set(trades.map(t => t.transactionHash));
  
  const missingTrades = activities
    .filter(a => a.type === 'TRADE' && !tradeHashes.has(a.transactionHash))
    .map(activity => ({
      transactionHash: activity.transactionHash,
      timestamp: activity.timestamp,
      conditionId: activity.conditionId,
      title: activity.title,
      slug: activity.slug,
      outcome: activity.outcome,
      side: activity.side,        // Use directly - NOT derived from usdcSize
      size: activity.size,        // Field is 'size', NOT 'shares'
      price: activity.price,
      usdcSize: activity.usdcSize,
    }));
  
  return [...trades, ...missingTrades];
}
```

## Activity vs Trades Field Mapping

| Activity Field | Trades Field | Notes |
|---------------|--------------|-------|
| `side` | `side` | Activity has direct "BUY"/"SELL" |
| `size` | `size` | Shares amount |
| `price` | `price` | Execution price |
| `usdcSize` | - | Always positive, use for USD calculations |
| `type` | - | Filter for "TRADE" only |

⚠️ **NEVER** derive `side` from `usdcSize` sign - it's always positive in Activity API.

## Workflow

1) Fetch metadata from Gamma:
   - event -> markets -> outcomes -> token ids

2) Fetch pricing/orderbook from CLOB:
   - orderbook summary for token id(s)

3) Fetch user data from Data API:
   - positions: current holdings
   - trades + activity: trade history (MERGE BOTH)

4) Normalize to shared internal model:
   - outcomeName, yesToken/noToken
   - bestBid, bestAsk, bidSize, askSize

5) Add caching:
   - metadata cache longer (minutes)
   - prices cache short (seconds)
   - trades/activity cache medium (30s-1min)

## Guardrails

- Keep API keys in env only (if needed for CLOB L2)
- Validate tokenId exists before calling orderbook endpoints
- Log mapping mismatches clearly
- **Always merge /trades + /activity for complete trade history**
- Use `activity.side` directly, never derive from usdcSize
- Field is `activity.size` not `activity.shares`

## Output

- Mapper function: `{ outcomeKey -> tokenId }`
- Fetcher: best bid/ask prices
- Trade aggregator: merged trades from both endpoints



