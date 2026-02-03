---
name: opinion-rest-markets
description: Opinion OpenAPI (REST) for ODDScreeners: fetch and normalize markets (binary/categorical), tokens (latest price, orderbook, price history), and user data (positions, trades). Includes correct handling for categorical parent/root vs child markets, status rules, thumbnails, sorting, and pagination. Never store API keys in code; use env vars only.
---

## Purpose
Use Opinion OpenAPI (REST) to read and analyze:
- Market data (Discover / Bonus / New)
- Token data (latest price, orderbook, price history)
- User data (Wallet Tracker: positions and trades)
- Arbitrage and Smart Money data inputs (REST snapshot; websocket is separate skill)

## Base URL & Auth
- Base URL: https://openapi.opinion.trade/openapi
- Auth: API key in request header `apikey`
- NEVER hardcode API keys. Use env vars only (e.g. `process.env.OPINION_API_KEY`).
- Avoid logging API keys.

## Key Endpoints (REST)
Markets:
- GET /market  (market list, sorting, filtering)
- GET /market/{marketId} (market detail)  [if used in codebase]

Tokens:
- GET /token/latest-price
- GET /token/orderbook
- GET /token/price-history (if used in codebase)

User:
- GET /positions/user/{walletAddress}
- GET /trade/user/{walletAddress}

## /market parameters (high impact)
marketType:
- 0 = Binary
- 1 = Categorical (multi-outcome / parent/root market)

sortBy:
- 1 = new
- 2 = ending soon
- 3 = volume desc
- 4 = volume asc
- 5 = volume24h desc
- 6 = volume24h asc
- 7 = volume7d desc
- 8 = volume7d asc

status (important for filtering):
- 1 = Created
- 2 = Activated
- 3 = Resolving
- 4 = Resolved
- 5 = Failed
- 6 = Deleted

statusEnum:
- Created / Activated / Resolving / Resolved / Failed / Deleted

## Pagination rules (critical)
- Most list endpoints support pagination using `page` and `limit`.
- Maximum `limit` per request is **20 items**.
- Do NOT assume larger limits are supported.
- Always implement pagination loops when fetching lists.
- Stop pagination when:
  - returned list length < limit, OR
  - API explicitly indicates no next page.

## Critical Model Behavior (Categorical Parent vs Child)
This is the most common source of bugs.

Parent/root categorical market (marketType=1):
- status is always 1 (Created)
- statusEnum always Created
- marketType always 1
- This endpoint carries metadata such as thumbnail/image used by child markets.

Child outcome markets (marketType=0):
- status is always 2 (Activated)
- statusEnum always Activated
- marketType always 0
- Each child corresponds to a binary market representing one outcome.

Thumbnail rule:
- To render child outcome thumbnails, use the thumbnail from its parent/root market.

## When to use this skill
- Discover / Bonus / New market lists
- Fix missing categorical / multi-outcome markets
- Normalize parent/child relationships and thumbnails
- Build “Top markets” quickly (by volume / 24h / 7d)
- Wallet Tracker market reads (positions/trades require market context)
- Arbitrage market mapping between Opinion and other exchanges

## Recommended “Top markets” approach (fastest & most accurate)
Use GET /market with limit and sortBy, relying on volume fields in `result.list[]`.

Examples (do not hardcode API key):
- Top 10 total volume: sortBy=3
- Top 10 volume 24h: sortBy=5
- Top 10 volume 7d: sortBy=7

Typical request shape:
- page=1
- limit=10
- status=activated  (or equivalent filter supported by the API)
- marketType=1      (categorical parent list) or marketType=0 (binary list)
- sortBy based on requirement

## Workflow
1) Decide the data need:
   - Market list? token data? user positions? user trades?
2) Fetch with safe pagination:
   - Use `page` and `limit` parameters.
   - Respect maximum limit = 20 items per request.
   - Implement a loop over pages.
   - Stop when returned list length < limit OR no next page.
   - Never assume a single request returns full data.
3) Normalize into internal ODDScreener models:
   - Always include: marketId, marketType, status/statusEnum
   - For categorical:
     - Keep parent/root market record
     - Build mapping: parent -> children outcomes
     - Use parent thumbnail for child rendering
4) Filtering rules (NO guessing):
   - Never “guess by year/date parsing”.
   - Use explicit API fields: status/statusEnum/resolvedAt (if available).
   - Treat status=4 (Resolved) as resolved even if resolvedAt is 0 or missing.
5) Sorting:
   - Prefer server-side sortBy for large lists.
   - Only do client-side sort for small in-memory sets.
6) Caching (recommended):
   - Market list: short cache (e.g., 15–60s) if heavily requested.
   - Token latest price/orderbook: very short cache (e.g., 1–5s) depending on UI.
   - User endpoints: short cache or none (wallet-specific).
7) Observability:
   - Log timing with clear prefix: [Opinion][Markets], [Opinion][Token], [Opinion][User]
   - Add a debug mode (e.g. `?debug=1`) returning:
     - total items processed
     - counts by marketType and status
     - sample IDs (parent + one child)

## Guardrails
- Never drop categorical markets accidentally.
- Never assume categorical parent status=Created means “not active” — it is expected behavior.
- Always keep parent/child thumbnail rule in mind.
- Never commit or log API keys.
- Be consistent with timestamps (ms) across the app.
- If API responses change, mark assumptions as [Chưa xác minh] and request a sample payload/log.

## Output expectations (when implementing changes)
- Provide code changes plus:
  - Example normalized object for 1 parent categorical + 2 child outcomes
  - Example for 1 binary market
  - Debug output example (counts + sample IDs)
