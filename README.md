## ODDScreeners — Prediction Markets Explorer
<p align="center"> <strong>Realtime price charts, orderbooks, smart money tracking, and cross-exchange arbitrage for prediction markets.</strong> </p> <p align="center"> <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" alt="Next.js 14" /> <img src="https://img.shields.io/badge/React-18-61dafb?logo=react" alt="React 18" /> <img src="https://img.shields.io/badge/WebSocket-realtime-brightgreen" alt="WebSocket" /> <img src="https://img.shields.io/badge/license-private-red" alt="Private" /> </p>
ODDScreeners is a prediction market dashboard that aggregates data from Opinion, Polymarket, Kalshi... into a single interface. It provides realtime charts, orderbooks, whale tracking, and arbitrage detection.

Website: www.oddscreeners.com

X: https://x.com/ODDScreeners

## Getting Started
Prerequisites
- Node.js 18+
- npm or yarn

Environment Variables
Create a .env.local file in the root:
```bash
# Opinion API
OPINION_API_KEY=your_opinion_api_key
OPINION_BASE_URL=https://openapi.opinion.trade/openapi
OPINION_WS_KEY=your_opinion_ws_key

# Access code system (Turso)
TURSO_DATABASE_URL=your_turso_url
TURSO_AUTH_TOKEN=your_turso_token
ADMIN_SECRET=your_admin_secret

# Optional
OPINION_WS_URL=wss://ws.opinion.trade
OPINION_OPENAPI_BASE=https://openapi.opinion.trade/openapi
```
```bash
⚠️ Never commit .env files. They are excluded via .gitignore.
```
Install & Run
```bash
npm install
npm run dev
```
Open http://localhost:3000.
Production Build
```bash
npm run build
npm start
```
