/**
 * Quick script: calculate yesterday's maker rebate for a wallet
 * from Opinion API trades.
 *
 * Usage: node check-rebate.mjs [walletAddress]
 */
import "dotenv/config";

const WALLET = process.argv[2] || "0x5f68f040ce9c7e4980b3a4d3a5dde17ea9db9fb6";
const BASE_URL = (process.env.OPINION_OPENAPI_BASE || process.env.OPINION_BASE_URL || "https://proxy.opinion.trade:8443/openapi").replace(/\/+$/, "");
const API_KEY  = process.env.OPINION_API_KEY || "";

// ── Time range: yesterday UTC 00:00 → 23:59:59 ──────────────────────────────
const now   = new Date();
const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const yesterdayStart = new Date(todayUTC.getTime() - 86400_000);
const yesterdayEnd   = new Date(todayUTC.getTime() - 1);

console.log(`\n📅 Checking wallet : ${WALLET}`);
console.log(`📅 Yesterday UTC   : ${yesterdayStart.toISOString()} → ${yesterdayEnd.toISOString()}`);
console.log(`🔗 API base        : ${BASE_URL}\n`);

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

async function fetchTrades(page = 1) {
  const url = new URL(`${BASE_URL}/trade/user/${WALLET}`);
  url.searchParams.set("chainId", "56");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", "20");

  const res = await fetch(url.toString(), {
    headers: { apikey: API_KEY, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.errno !== 0) throw new Error(`API errno ${data.errno}: ${JSON.stringify(data)}`);
  return data.result; // { list, total, page }
}

async function main() {
  if (!API_KEY) {
    console.error("❌  OPINION_API_KEY not set in .env");
    process.exit(1);
  }

  let allTrades = [];
  let page = 1;
  let total = null;

  while (true) {
    const result = await fetchTrades(page);
    const list = result?.list ?? [];
    if (total === null) total = result?.total ?? 0;
    if (!list.length) break;

    allTrades = allTrades.concat(list);
    console.log(`  page ${page}: got ${list.length} trades (total so far: ${allTrades.length} / ${total})`);

    // Since trades are sorted newest-first, once we go past yesterday we can stop
    const oldest = list[list.length - 1];
    const oldestTs = num(oldest?.createdAt) * 1000;
    if (oldestTs < yesterdayStart.getTime()) break;
    if (list.length < 20) break;
    page++;
  }

  console.log(`\n  Total trades fetched: ${allTrades.length}`);

  // ── Filter to yesterday's trades ──────────────────────────────────────────
  const yesterdayTrades = allTrades.filter(t => {
    const ts = num(t.createdAt) * 1000;
    return ts >= yesterdayStart.getTime() && ts < todayUTC.getTime();
  });

  console.log(`  Trades in yesterday window: ${yesterdayTrades.length}`);

  if (!yesterdayTrades.length) {
    console.log("\n  ⚠️  No trades found for yesterday. Showing last 5 trades to check timestamps:\n");
    allTrades.slice(0, 5).forEach((t, i) => {
      const d = new Date(num(t.createdAt) * 1000);
      console.log(`    [${i+1}] createdAt: ${d.toISOString()} | fee: ${JSON.stringify(t.fee)} | amount: ${t.amount} | price: ${t.price} | side: ${t.side}`);
    });
    return;
  }

  // ── Categorize and calculate rebates ─────────────────────────────────────
  let totalRebate = 0;
  let makerCount  = 0;
  let takerCount  = 0;
  const makerTrades = [];

  for (const t of yesterdayTrades) {
    const feeRaw = t.fee;
    const fee    = num(feeRaw);
    const side   = (t.side || "").toLowerCase();

    const d = new Date(num(t.createdAt) * 1000);
    const p = num(t.price);
    const usdAmount = num(t.usdAmount);
    const amount = usdAmount > 1e10 ? usdAmount / 1e18 : num(t.amount);

    const isMaker = fee === 0;

    if (isMaker) {
      makerCount++;
      if (p > 0 && p < 1 && amount > 0) {
        // V = shares (contracts), NOT USDT amount
        const shares = num(t.shares) || (p > 0 ? amount / p : 0);
        const rebate = shares * p * (1 - p) * 0.04 * 0.50;
        totalRebate += rebate;
        makerTrades.push({
          time: d.toISOString(),
          side,
          market: t.displayTitle || t.rootMarketTitle || t.marketTitle || `#${t.marketId}`,
          shares: shares.toFixed(4),
          amount: amount.toFixed(4),
          price: p.toFixed(4),
          feeCurve: (p * (1 - p)).toFixed(6),
          rebate: rebate.toFixed(6),
          feeRaw,
        });
      }
    } else {
      takerCount++;
    }
  }

  // ── Print detail ─────────────────────────────────────────────────────────
  console.log(`\n  Maker trades: ${makerCount}  |  Taker trades: ${takerCount}`);
  if (makerTrades.length) {
    console.log("\n  ── Maker trade breakdown ──────────────────────────────────────────────────");
    makerTrades.forEach((mt, i) => {
      console.log(`  [${String(i+1).padStart(2)}] ${mt.time.slice(11,19)} UTC | side:${mt.side.padEnd(4)} | p=${mt.price} | shares=${mt.shares} | amount=$${mt.amount} | feeCurve=${mt.feeCurve} | rebate=$${mt.rebate}`);
      console.log(`       Market: ${mt.market}`);
    });
  }

  console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
  console.log(`  ║  Est. Yesterday Rebate: $${totalRebate.toFixed(6).padStart(14)}              ║`);
  console.log(`  ╚══════════════════════════════════════════════════════╝\n`);

  // Also show raw fee values for all yesterday trades for verification
  console.log("  ── Raw fee values (all yesterday trades) ───────────────────────────────");
  yesterdayTrades.forEach((t, i) => {
    const d = new Date(num(t.createdAt) * 1000);
    console.log(`  [${String(i+1).padStart(2)}] ${d.toISOString().slice(11,19)} | fee=${JSON.stringify(t.fee)} | amount=${t.amount} | price=${t.price} | usdAmount=${t.usdAmount}`);
  });
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
