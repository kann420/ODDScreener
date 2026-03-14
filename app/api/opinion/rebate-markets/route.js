import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/opinion/rebate-markets
 *
 * Returns markets with the most smart-money activity in the last 4 hours.
 * Driven purely by SmartMoney DB (min $100/trade), enriched with Opinion API
 * market details + latest price.
 *
 * Supports both binary (marketType 0) and categorical (marketType 1) markets.
 * Cached in-memory for 1 hour.
 */

// In-memory cache
const _rebateCache = globalThis.__REBATE_SM_CACHE_V2__ ?? {
  data: null,
  fetchedAt: 0,
  building: null,
  TTL: 60 * 60 * 1000, // 1 hour
};
if (!globalThis.__REBATE_SM_CACHE_V2__) globalThis.__REBATE_SM_CACHE_V2__ = _rebateCache;

/**
 * Query SmartMoney DB for Opinion markets with recent whale activity.
 * Groups by COALESCE(rootMarketId, marketId) so categorical children
 * roll up to their parent.
 */
function getSmartMoneyMarkets() {
  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const fs = require("fs");

    const DEFAULT_DB = path.join(process.cwd(), "data", "smartmoney.sqlite");
    const DB_PATH = process.env.SMART_MONEY_DB_PATH || DEFAULT_DB;

    if (!fs.existsSync(DB_PATH)) {
      console.warn("[RebateMarkets] SmartMoney DB not found at", DB_PATH);
      return [];
    }

    const db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");

    const cutoff = Date.now() - 4 * 60 * 60 * 1000; // 4 hours ago

    const rows = db.prepare(`
      SELECT
        COALESCE(rootMarketId, marketId) AS groupKey,
        MIN(marketId)                    AS sampleMarketId,
        MAX(rootMarketId)                AS rootMarketId,
        MAX(marketTitle)                 AS marketTitle,
        MAX(marketImageUrl)              AS thumbnailUrl,
        COUNT(*)                         AS tradeCount,
        SUM(amount)                      AS totalAmount,
        COUNT(DISTINCT signer)           AS uniqueWallets,
        MAX(ts)                          AS lastTradeTs
      FROM trades
      WHERE platform = 'opinion'
        AND ts >= ?
        AND amount >= 100
      GROUP BY groupKey
      ORDER BY tradeCount DESC
      LIMIT 30
    `).all(cutoff);

    db.close();
    return rows;
  } catch (err) {
    console.error("[RebateMarkets] Error reading SmartMoney DB:", err.message);
    return [];
  }
}

/**
 * Fetch market detail from Opinion API for a given marketId.
 * For categorical parents use /market/categorical/{id}, for binary use /market/{id}.
 */
async function fetchMarketDetail(marketId, isParent) {
  try {
    if (isParent) {
      const data = await opinionFetch(`/market/categorical/${marketId}`);
      return data?.result?.data || null;
    }
    const data = await opinionFetch(`/market/${marketId}`);
    return data?.result?.data || null;
  } catch {
    return null;
  }
}

async function buildRebateMarkets() {
  // Step 1: Get smart money hotspots
  const smRows = getSmartMoneyMarkets();
  console.log(`[RebateMarkets] Smart money: ${smRows.length} markets with recent $100+ trades`);

  if (smRows.length === 0) return [];

  // Step 2: Enrich each market with Opinion API data + price
  const BATCH = 6;
  const enriched = [];

  for (let i = 0; i < smRows.length; i += BATCH) {
    const batch = smRows.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const isParent = !!row.rootMarketId;
        const fetchId = isParent ? row.rootMarketId : row.sampleMarketId;
        const market = await fetchMarketDetail(fetchId, isParent);
        if (!market) return null;

        // For categorical parents, get a child market's yesTokenId to fetch price
        let yesTokenId = market.yesTokenId;
        let price = null;

        if (isParent && !yesTokenId) {
          // Fetch one child to get a representative price
          const childData = await opinionFetch(`/market/${row.sampleMarketId}`);
          const child = childData?.result?.data;
          yesTokenId = child?.yesTokenId;
        }

        if (yesTokenId) {
          try {
            const priceData = await opinionFetch("/token/latest-price", {
              params: { token_id: yesTokenId },
            });
            price = Number(priceData?.result?.price || 0) || null;
          } catch {}
        }

        return {
          marketId: isParent ? row.rootMarketId : row.sampleMarketId,
          marketTitle: market.marketTitle || market.title || row.marketTitle || "",
          marketType: isParent ? 1 : (market.marketType ?? 0),
          rootMarketId: row.rootMarketId || null,
          yesTokenId: market.yesTokenId || yesTokenId || null,
          noTokenId: market.noTokenId || null,
          volume: market.volume || "0",
          volume24h: market.volume24h || "0",
          volume7d: market.volume7d || "0",
          conditionId: market.conditionId || "",
          questionId: market.questionId || "",
          quoteToken: market.quoteToken || "",
          chainId: market.chainId || "56",
          createdAt: market.createdAt || 0,
          cutoffAt: market.cutoffAt || 0,
          resolvedAt: market.resolvedAt || 0,
          status: market.status,
          statusEnum: market.statusEnum,
          thumbnailUrl: market.thumbnailUrl || row.thumbnailUrl || null,
          // Smart money metrics
          price,
          smTradeCount: row.tradeCount,
          smTotalAmount: row.totalAmount,
          smUniqueWallets: row.uniqueWallets,
          smLastTradeTs: row.lastTradeTs,
        };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        enriched.push(r.value);
      }
    }
  }

  // Already sorted by tradeCount (DESC) from the SQL query
  return enriched;
}

export async function GET(req) {
  try {
    const now = Date.now();

    // Return cached if fresh
    if (_rebateCache.data && (now - _rebateCache.fetchedAt) < _rebateCache.TTL) {
      return NextResponse.json({
        errno: 0,
        markets: _rebateCache.data,
        total: _rebateCache.data.length,
        cached: true,
        cacheAge: Math.round((now - _rebateCache.fetchedAt) / 1000),
      });
    }

    // Dedup concurrent builds
    if (_rebateCache.building) {
      const result = await _rebateCache.building;
      return NextResponse.json({
        errno: 0,
        markets: result,
        total: result.length,
        cached: false,
      });
    }

    _rebateCache.building = buildRebateMarkets()
      .then((result) => {
        _rebateCache.data = result;
        _rebateCache.fetchedAt = Date.now();
        _rebateCache.building = null;
        return result;
      })
      .catch((err) => {
        _rebateCache.building = null;
        console.error("[RebateMarkets] Build failed:", err.message);
        return _rebateCache.data || [];
      });

    const markets = await _rebateCache.building;

    return NextResponse.json({
      errno: 0,
      markets,
      total: markets.length,
      cached: false,
    });
  } catch (err) {
    console.error("[rebate-markets] Error:", err);
    return NextResponse.json({
      errno: -1,
      errormsg: "Internal error",
      markets: [],
    });
  }
}
