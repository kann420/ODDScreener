import { NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  getPredictFunLastSale,
  getPredictFunOrderbookData,
  getPredictFunPriceHistory,
} from "@/lib/predictfun";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const _pfRowMetricsCache =
  globalThis.__PF_DISCOVER_ROW_METRICS_CACHE__ ??
  (globalThis.__PF_DISCOVER_ROW_METRICS_CACHE__ = new Map());
const ROW_METRICS_TTL = 60_000;
const MAX_IDS = 20;

function getCachedRowMetrics(marketId) {
  const cached = _pfRowMetricsCache.get(String(marketId));
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > ROW_METRICS_TTL) {
    _pfRowMetricsCache.delete(String(marketId));
    return null;
  }
  return cached.data;
}

function setCachedRowMetrics(marketId, data) {
  _pfRowMetricsCache.set(String(marketId), {
    data,
    fetchedAt: Date.now(),
  });

  if (_pfRowMetricsCache.size > 500) {
    const oldestKey = _pfRowMetricsCache.keys().next().value;
    _pfRowMetricsCache.delete(oldestKey);
  }
}

function computeMidFromOrderbook(obData) {
  const bestBid = Number(obData?.bestBid ?? 0);
  const bestAsk = Number(obData?.bestAsk ?? 0);

  if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;
  if (bestBid > 0) return bestBid;
  if (bestAsk > 0) return bestAsk;
  return 0;
}

async function buildRowMetrics(marketId) {
  const cached = getCachedRowMetrics(marketId);
  if (cached) return cached;

  const [obData, history] = await Promise.all([
    getPredictFunOrderbookData(marketId).catch(() => null),
    getPredictFunPriceHistory(marketId, { limit: 50 }).catch(() => []),
  ]);

  let mid = computeMidFromOrderbook(obData);
  if (mid <= 0) {
    const lastSale = await getPredictFunLastSale(marketId).catch(() => null);
    const lastPrice = Number(lastSale?.priceInCurrency ?? 0);
    if (Number.isFinite(lastPrice) && lastPrice > 0 && lastPrice <= 1) {
      mid = lastPrice;
    }
  }

  const data = {
    marketId: String(marketId),
    mid,
    totalLiquidity: obData?.totalLiquidity ?? null,
    sparkPts: Array.isArray(history) ? history.slice(-50) : [],
  };
  setCachedRowMetrics(marketId, data);
  return data;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get("ids") || "";
    const ids = idsParam
      .split(",")
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, MAX_IDS);

    if (!ids.length) {
      return NextResponse.json({ rows: {}, count: 0 }, { status: 400 });
    }

    const rows = {};
    const results = await mapWithConcurrency(
      ids,
      async (marketId) => buildRowMetrics(marketId),
      { concurrency: 6 }
    );

    for (const row of results) {
      if (!row?.marketId) continue;
      rows[row.marketId] = row;
    }

    return NextResponse.json(
      {
        rows,
        count: Object.keys(rows).length,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40",
        },
      }
    );
  } catch (err) {
    console.error("[PF Discover RowMetrics] Error:", err?.message || err);
    return NextResponse.json({ rows: {}, error: err?.message }, { status: 500 });
  }
}
