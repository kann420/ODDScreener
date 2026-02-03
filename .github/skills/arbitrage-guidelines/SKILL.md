# Arbitrage Market Matching - Development Guidelines

## Overview

The Arbitrage feature matches prediction markets between **Opinion** and **Polymarket** to find arbitrage opportunities where users can profit from price differences on the same underlying event.

## Architecture

### Key Files

| File | Purpose |
|------|---------|
| `lib/arbitageAutoMatcher.js` | Core matching engine - fetches markets, normalizes text, finds matches |
| `lib/arbitageEngine.js` | Orchestrates scanning, calculates spreads, manages opportunities |
| `app/api/arbitage/scan/route.js` | API endpoint for scanning opportunities |
| `app/api/arbitage/debug-markets/route.js` | Debug endpoint to inspect fetched markets |
| `app/api/arbitage/wallet-positions/route.js` | Matches user's positions across platforms |
| `components/arbitage/ArbitageBoard.jsx` | Main UI component |

### Data Flow

```
1. Fetch Opinion markets (binary + categorical)
2. Fetch Polymarket events via Gamma API
3. Normalize market titles for comparison
4. Match markets using fuzzy scoring + whitelist rules
5. Fetch orderbook prices for matched pairs
6. Calculate arbitrage spread
7. Return sorted opportunities
```

---

## Opinion API Integration

### Market Types

- **Binary (marketType=0)**: Simple Yes/No markets
- **Categorical (marketType=1)**: Parent markets with multiple child outcomes

### Categorical Market Structure

```javascript
// Parent market (status=1 "Created" is NORMAL for categorical parents)
{
  marketId: 96,
  marketTitle: "StandX FDV above ... one day after launch?",
  status: 1,           // Created - this is expected!
  statusEnum: "Created",
  marketType: 1,       // Categorical
  childMarkets: [...]  // Array of child outcomes
}

// Child market (status=2 "Activated" when tradable)
{
  marketId: 1234,
  marketTitle: "$800M",
  status: 2,
  statusEnum: "Activated",
  parentMarketId: 96
}
```

### CRITICAL: Pagination Rules

```javascript
// Opinion API uses page-based pagination, NOT offset
// Max limit per request: 20 items

// ✅ CORRECT
const url = `/market?limit=20&page=1`;  // page 1
const url = `/market?limit=20&page=2`;  // page 2

// ❌ WRONG - offset doesn't work
const url = `/market?limit=20&offset=20`;
```

### Fetching Categorical Details

```javascript
// To get child markets, must fetch categorical detail endpoint
const detail = await opinionFetch(`/market/categorical/${marketId}`);
const children = detail.result?.data?.childMarkets || [];
```

---

## Polymarket API Integration

### Gamma API (Metadata)

```javascript
const GAMMA_BASE = "https://gamma-api.polymarket.com";

// Fetch events (returns events with nested markets)
const events = await fetch(`${GAMMA_BASE}/events?closed=false&limit=100`);

// Event structure
{
  id: "12345",
  title: "StandX FDV above ___ one day after launch?",
  markets: [
    { question: "StandX FDV above $800M?", clobTokenIds: "[123,456]" }
  ]
}
```

### CLOB API (Prices)

```javascript
const CLOB_BASE = "https://clob.polymarket.com";

// Fetch orderbook for a token
const book = await fetch(`${CLOB_BASE}/book?token_id=${tokenId}`);
```

### Low-Volume Markets Issue

Gamma `/events` API may not return low-volume markets. Solution: **Use public-search API for whitelisted keywords**:

```javascript
const WHITELIST_SEARCH_KEYWORDS = [
  "StandX", "Nansen", "MegaETH", "Fabric", 
  "Silver", "Gold", "acquired", "Largest Company"
];

async function fetchWhitelistEventsViaSearch(keywords) {
  const results = [];
  for (const kw of keywords) {
    const url = `${GAMMA_BASE}/public-search?query=${encodeURIComponent(kw)}&limit=50`;
    const data = await fetchJson(url);
    if (data?.events) results.push(...data.events);
  }
  return dedupeById(results);
}
```

---

## Text Matching Logic

### Normalization Rules

Markets use different placeholder formats that must be normalized:

| Platform | Format | Example |
|----------|--------|---------|
| Opinion | `...` or `…` | "StandX FDV above ... one day after launch?" |
| Polymarket | `___` or `__` | "StandX FDV above ___ one day after launch?" |

```javascript
function normalizeText(str) {
  return str
    .toLowerCase()
    .replace(/[_…\.]{2,}/g, " ") // Replace ___, ..., … with space
    .replace(/\(fdv\)/gi, "fdv") // Remove parentheses around FDV
    .replace(/\(si\)/gi, "")     // Remove (SI) for Silver
    .replace(/\(gc\)/gi, "")     // Remove (GC) for Gold
    .replace(/[^\w\s+]/g, " ")   // Keep alphanumeric, space, and +
    .replace(/\s+/g, " ")        // Collapse spaces
    .trim();
}
```

### Similarity Scoring

Uses word-based Jaccard similarity:

```javascript
function textSimilarity(a, b) {
  const wordsA = new Set(normalizeText(a).split(" "));
  const wordsB = new Set(normalizeText(b).split(" "));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union; // 0.0 to 1.0
}

const MATCH_THRESHOLD = 0.3; // Minimum score to consider a match
```

---

## Whitelist Rules

### Purpose

Manual whitelist rules ensure specific market pairs always match, even when:
- Text normalization fails
- Markets have different naming conventions
- Fuzzy matching score is below threshold

### Whitelist Structure

```javascript
const MANUAL_MATCH_WHITELIST = [
  // Simple keyword matching (most flexible)
  { opinionPattern: /standx/i, polyPattern: /standx/i },
  { opinionPattern: /megaeth/i, polyPattern: /megaeth/i },
  { opinionPattern: /nansen.*token/i, polyPattern: /nansen.*token/i },
  
  // Commodity markets with symbol differences
  { opinionPattern: /silver.*hit/i, polyPattern: /silver.*hit/i },
  { opinionPattern: /gold.*hit/i, polyPattern: /gold.*hit/i },
  
  // Markets with word variations
  { opinionPattern: /best ai model/i, polyPattern: /best ai model/i },
  { opinionPattern: /largest company/i, polyPattern: /largest company/i },
  { opinionPattern: /companies.*acquired/i, polyPattern: /companies.*acquired/i },
  
  // Fed/ECB rate decisions (different naming)
  { opinionPattern: /ecb rates decision/i, polyPattern: /ecb interest rates/i },
  { opinionPattern: /us fed rate decision/i, polyPattern: /fed decision/i },
];
```

### Whitelist Functions

```javascript
// Check if a market title matches any whitelist pattern
function isWhitelistedMarket(title) {
  const norm = title.toLowerCase();
  for (const rule of MANUAL_MATCH_WHITELIST) {
    if (rule.opinionPattern.test(norm)) return true;
  }
  return false;
}

// Check if Opinion and Poly markets match via whitelist
function checkWhitelistMatch(opinionTitle, polyEvents) {
  const opNorm = opinionTitle.toLowerCase();
  for (const rule of MANUAL_MATCH_WHITELIST) {
    if (!rule.opinionPattern.test(opNorm)) continue;
    for (const event of polyEvents) {
      if (rule.polyPattern.test(event.title.toLowerCase())) {
        return { polyEvent: event };
      }
    }
  }
  return null;
}
```

---

## Common Issues & Solutions

### Issue 1: Markets exist on Opinion but not found in scan

**Symptoms:**
- Market visible on Opinion website
- Not appearing in arbitrage scan results

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Categorical parent has no "Activated" children | Use `isWhitelistedMarket()` to preserve markets in whitelist even without active children |
| Market fetched after hitting `maxTotalMarkets` limit | Prioritize whitelist markets by sorting them first |
| Pagination error (using offset instead of page) | Always use `page` parameter with Opinion API |

**Code fix - Prioritize whitelist markets:**
```javascript
// Sort categorical parents to process whitelisted ones FIRST
const prioritizedParents = [...categoricalParents].sort((a, b) => {
  const aWhitelisted = isWhitelistedMarket(a.marketTitle);
  const bWhitelisted = isWhitelistedMarket(b.marketTitle);
  if (aWhitelisted && !bWhitelisted) return -1;
  if (!aWhitelisted && bWhitelisted) return 1;
  return 0;
});
```

**Code fix - Keep whitelist markets without active children:**
```javascript
const hasActiveChildren = activeChildren.length > 0;
const inWhitelist = isWhitelistedMarket(title);

// Keep if has active children OR is in whitelist
if (hasActiveChildren || inWhitelist) {
  allMarkets.push({ ...fullData, isCategorical: true, childMarkets: children });
}
```

### Issue 2: Markets exist on Polymarket but not found

**Symptoms:**
- Market visible on Polymarket website
- Not appearing in scan results

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Low volume, not returned by Gamma `/events` | Add keyword to `WHITELIST_SEARCH_KEYWORDS` and use `fetchWhitelistEventsViaSearch()` |
| Event is closed | Check `closed=false` filter |
| Pagination limit | Increase `maxPages` parameter |

### Issue 3: Markets don't match despite similar names

**Symptoms:**
- Both markets fetched
- No match found in results

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Different placeholder formats (`___` vs `...`) | Already handled in `normalizeText()` |
| Word variations ("has best" vs "has the best") | Add to whitelist with flexible regex |
| Symbol differences ("Silver (SI)" vs "Silver") | Add cleanup in `normalizeText()` |
| Match threshold too high | Verify `MATCH_THRESHOLD = 0.3` is being used |

---

## Scan Modes

### Quick Scan (Default)
- `maxTotalMarkets = 100`
- Fast, for frequent checks
- May miss some markets

### Full Scan
- `maxTotalMarkets = 9999`
- Comprehensive, finds all markets
- Slower (30-60 seconds)
- Triggered by user action (Full Scan button)

```javascript
// API call
GET /api/arbitage/scan?mode=full

// Engine call
await scanArbitageOpportunities({ scanMode: "full" });
```

---

## Debugging

### Debug Endpoint

```javascript
GET /api/arbitage/debug-markets?mode=full&search=standx,megaeth,gold

// Response
{
  opinionMarkets: [...],    // All fetched Opinion markets
  polymarketEvents: [...],  // All fetched Poly events
  stats: {
    opinionTotal: 150,
    categoricalParents: 331,
    whitelistKept: 5,       // Markets kept via whitelist
    polyTotal: 1047
  },
  searchResults: {          // Filtered by search param
    standx: [...],
    megaeth: [...],
    gold: [...]
  }
}
```

### Console Logging

Key log messages to watch:

```
[AutoMatcher] Found 47 binary markets
[AutoMatcher] Found 196 categorical parents, fetching details...
[AutoMatcher] Prioritizing 12 whitelisted markets first
[AutoMatcher] WHITELIST KEEP: "StandX FDV..." (no active children but in whitelist)
[AutoMatcher] SKIP: No active children for "Bitcoin above..." (5 total children)
[AutoMatcher] Found 53 categorical markets (3 kept via whitelist)
[Matching] ✓ Matched: "StandX FDV above $1B..." <-> "StandX FDV above ___..." (score: 0.88)
```

### Test Whitelist Matching

```javascript
// Quick test script
const testTitles = [
  "StandX FDV above ... one day after launch?",
  "MegaETH market cap (FDV) one day after launch?",
  "Will Silver hit ... by end of February?",
];

for (const title of testTitles) {
  console.log(`${isWhitelistedMarket(title) ? "✓" : "✗"} ${title}`);
}
```

---

## Adding New Market Pairs

When users report missing market pairs:

1. **Verify markets exist** on both platforms
2. **Check if fetched** via debug endpoint
3. **If not fetched on Opinion:**
   - Check if categorical with no active children → add to whitelist
   - Check pagination → verify page parameter usage
4. **If not fetched on Polymarket:**
   - Add keyword to `WHITELIST_SEARCH_KEYWORDS`
5. **If fetched but not matched:**
   - Compare normalized titles
   - Add whitelist rule with appropriate regex patterns

### Whitelist Pattern Guidelines

```javascript
// Simple - just match keyword (most flexible)
{ opinionPattern: /keyword/i, polyPattern: /keyword/i }

// With context - avoid false positives
{ opinionPattern: /keyword.*specific/i, polyPattern: /keyword.*specific/i }

// Handle variations
{ opinionPattern: /has (the )?best/i, polyPattern: /has (the )?best/i }
```

### ⚠️ CRITICAL: Time Period Mismatch Prevention

**Problem:** Broad whitelist patterns like `/best ai model/i` can match markets with **different time periods**, causing incorrect arbitrage pairs.

**Example of BAD match:**
- Opinion: "Which company has the best AI model end of **June**?"
- Polymarket: "Which company has best AI model end of **February**?"
- Both match `/best ai model/i` but are DIFFERENT markets!

**Solution:** The matcher includes `hasTimePeriodMismatch()` check that:
1. Extracts time periods (months, quarters) from both titles
2. Rejects matches if time periods differ

```javascript
// Time period extraction patterns
const monthPattern = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const quarterPattern = /\b(q[1-4])\b/i;

function extractTimePeriod(title) {
  const lower = title.toLowerCase();
  const monthMatch = lower.match(monthPattern);
  if (monthMatch) return { month: monthMatch[1] };
  const quarterMatch = lower.match(quarterPattern);
  if (quarterMatch) return { quarter: quarterMatch[1] };
  return null;
}

function hasTimePeriodMismatch(title1, title2) {
  const period1 = extractTimePeriod(title1);
  const period2 = extractTimePeriod(title2);
  if (!period1 || !period2) return false; // Can't compare, allow match
  if (period1.month && period2.month) {
    return period1.month !== period2.month; // true = MISMATCH
  }
  if (period1.quarter && period2.quarter) {
    return period1.quarter !== period2.quarter;
  }
  return false;
}
```

**When adding new whitelist patterns, ask yourself:**
> "Could this pattern match markets with different time periods (months, quarters, years)?"

If YES, the existing `hasTimePeriodMismatch()` will handle it. But be aware of edge cases:
- "end of 2025" vs "end of 2026" - years (currently handled via date patterns)
- "Q1 2026" vs "Q2 2026" - quarters (handled)
- "March 2026" vs "March 2027" - same month, different year (may need year extraction)

---

## Performance Considerations

1. **Caching**: Results cached for 1-5 minutes to avoid API rate limits
2. **Parallel fetching**: Pagination and detail fetches done in parallel
3. **Batch size**: Process 20 categorical markets at a time
4. **Timeout**: API calls have 20s timeout

```javascript
// Clear cache when needed
import { clearAutoMatchCache } from "@/lib/arbitageAutoMatcher";
clearAutoMatchCache();
```

---

## Related Skills

- [opinion-rest-markets](../opinion-rest-markets/SKILL.md) - Opinion API details
- [polymarket-gamma-clob](../polymarket-gamma-clob/SKILL.md) - Polymarket API details
