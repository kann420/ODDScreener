#!/usr/bin/env node
// check-weekly-volume.mjs
// Query predictfun total volume for March 9-15 UTC

const GRAPHQL_URL = "https://graphql.predict.fun/graphql";
const REST_BASE = "https://api.predict.fun";
const API_KEY = process.env.PREDICTFUN_API_KEY;
if (!API_KEY) {
  console.error("Missing PREDICTFUN_API_KEY env variable");
  process.exit(1);
}

const START = new Date("2026-03-09T00:00:00.000Z");
const END   = new Date("2026-03-16T00:00:00.000Z"); // exclusive

console.log(`Period: ${START.toISOString()} → ${new Date("2026-03-15T23:59:59.999Z").toISOString()}`);

async function graphqlQuery(afterCursor) {
  const paginationArg = afterCursor
    ? `{ first: 100, after: "${afterCursor}" }`
    : `{ first: 100 }`;

  const query = `{ matchEventLog(pagination: ${paginationArg}) { pageInfo { hasNextPage endCursor } edges { node { timestamp amountFilled priceExecuted } } } }`;

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error("GQL err: " + json.errors.map(e => e.message).join("; "));
  return json.data?.matchEventLog;
}

async function restFetch(path, params = {}) {
  const url = new URL(path, REST_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { "x-api-key": API_KEY, "Accept": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`REST HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Strategy 2: REST markets (quick reference) ───────────────────────────────
async function getVolumeViaMarkets() {
  console.log("\n[Strategy 2] REST /v1/markets rolling volume (reference only)...");

  let allMarkets = [];
  let cursor = null;
  let page = 0;

  while (true) {
    page++;
    const params = { first: "200", status: "OPEN", includeStats: "true" };
    if (cursor) params.after = cursor;
    const res = await restFetch("/v1/markets", params);
    if (!res?.success || !Array.isArray(res.data)) {
      console.log("  Unexpected response:", JSON.stringify(res).slice(0, 200));
      break;
    }

    allMarkets.push(...res.data);
    process.stdout.write(`\r  page ${page}: ${allMarkets.length} markets`);

    cursor = res.cursor || null;
    if (!cursor || res.data.length < 200) break;
    if (page >= 50) break;
    await new Promise(r => setTimeout(r, 100));
  }
  process.stdout.write("\n");

  let vol7d = 0, vol24h = 0, volAll = 0;
  for (const m of allMarkets) {
    const s = m.stats || {};
    vol24h += Number(s.volume24hUsd  ?? 0);
    volAll += Number(s.volumeTotalUsd ?? 0);
    // Check if there's a 7-day field
    vol7d  += Number(s.volume7dUsd ?? s.volumeWeekUsd ?? 0);
  }

  // Show stat fields from first market
  const sample = allMarkets[0]?.stats;
  if (sample) {
    console.log("  Stats fields:", Object.keys(sample).join(", "));
  }

  return { totalMarkets: allMarkets.length, vol7d, vol24h, volAll };
}

// ── Strategy 1: matchEventLog (precise date range) ───────────────────────────
async function getVolumeViaMatchEventLog() {
  console.log("\n[Strategy 1] Paginating matchEventLog (newest→oldest)...");
  console.log("  Note: trades sorted newest first; stopping when oldest in page < Mar 9\n");

  let totalVolumeUsd = 0;
  let tradesInRange = 0;
  let tradesScanned = 0;
  let cursor = null;
  let page = 0;
  let stopEarly = false;

  while (!stopEarly) {
    page++;
    const result = await graphqlQuery(cursor);
    const edges = result?.edges ?? [];
    if (!edges.length) { console.log("  No edges — done"); break; }

    for (const edge of edges) {
      const node = edge.node;
      const ts = new Date(node.timestamp);
      tradesScanned++;

      if (ts >= END) continue;    // after our window (shouldn't happen since newest first, but safety)
      if (ts < START) {           // before our window — stop
        stopEarly = true;
        break;
      }

      // Within Mar 9-15
      tradesInRange++;
      const shares = Number(BigInt(node.amountFilled)) / 1e18;
      const price  = Number(BigInt(node.priceExecuted)) / 1e18;
      totalVolumeUsd += shares * price;
    }

    const lastTs = edges[edges.length - 1]?.node?.timestamp ?? "?";
    const vol = totalVolumeUsd.toLocaleString("en-US", { maximumFractionDigits: 0 });
    process.stdout.write(`\r  p${page} | scanned ${tradesScanned} | range ${tradesInRange} | vol $${vol} | oldest ${lastTs}   `);

    if (!result?.pageInfo?.hasNextPage || stopEarly) break;
    cursor = result.pageInfo.endCursor;
    if (!cursor) break;
    if (page >= 3000) { process.stdout.write("\n  [max pages]\n"); break; }

    await new Promise(r => setTimeout(r, 80));
  }
  process.stdout.write("\n");

  return { totalVolumeUsd, tradesInRange, tradesScanned, page };
}

async function main() {
  console.log("=== PredictFun Weekly Volume Check ===\n");

  // Strategy 2: quick reference
  try {
    const s2 = await getVolumeViaMarkets();
    const fmt = (v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    console.log(`  Total OPEN markets: ${s2.totalMarkets}`);
    console.log(`  Volume 24h (rolling): ${fmt(s2.vol24h)}`);
    if (s2.vol7d > 0) console.log(`  Volume 7d (rolling): ${fmt(s2.vol7d)}`);
    console.log(`  Volume all-time: ${fmt(s2.volAll)}`);
  } catch (err) {
    console.error("  Strategy 2 error:", err.message);
  }

  // Strategy 1: precise
  try {
    const s1 = await getVolumeViaMatchEventLog();
    const fmt = s1.totalVolumeUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    console.log(`\n  Pages fetched: ${s1.page}`);
    console.log(`  Total events scanned: ${s1.tradesScanned}`);
    console.log(`  Events in window (Mar 9-15 UTC): ${s1.tradesInRange}`);
    console.log(`\n╔═══════════════════════════════════════════════════════╗`);
    console.log(`║  TOTAL VOLUME Mar 9-15, 2026 UTC (matchEventLog)     ║`);
    console.log(`║  $${fmt.padStart(51)} ║`);
    console.log(`╚═══════════════════════════════════════════════════════╝`);
  } catch (err) {
    console.error("  Strategy 1 error:", err.message);
  }
}

main().catch(console.error);
