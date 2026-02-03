---

name: opinion-ws-market-streams

description: Opinion websocket subscriptions for market.last.trade / market.last.price / market.depth.diff with categorical rootMarketId rules, reconnect, and dedupe.

---



\## When to use

\- Recent trades stream

\- Live last price

\- Fix unsubscribe/reconnect loops



\## Key rule (categorical)

\- For categorical markets:

&nbsp; - Subscribe market.last.trade and market.last.price using rootMarketId (one subscription covers all outcomes).

&nbsp; - market.depth.diff is per child marketId (subscribe each outcome marketId).

\- For binary markets: use marketId normally.



\## Workflow

1\) Determine market type and IDs to subscribe (binary vs categorical).

2\) Implement reconnect:

&nbsp;  - exponential backoff (cap at 30s)

&nbsp;  - re-subscribe on reconnect

3\) Dedupe events:

&nbsp;  - keep a small LRU set of recent trade IDs or (ts, price, size, side) signature.

4\) Emit typed events to the app:

&nbsp;  - onLastTrade

&nbsp;  - onLastPrice

&nbsp;  - onDepthDiff



\## Guardrails

\- Never assume websocket provides history/backfill unless explicitly confirmed.

\- Ensure ts is ms. If you detect seconds, convert and log a warning.



\## Output

\- Provide a minimal “subscription builder” function that returns the correct subscriptions for a market object.



