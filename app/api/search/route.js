import { NextResponse } from "next/server";
import { opinionFetch, normalizeMarketList } from "@/lib/opinion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/search?q=...&platform=opinion|predictfun&type=market|wallet
 *
 * Unified search endpoint for markets across platforms.
 * - platform=opinion → searches Opinion markets via their API
 * - platform=predictfun → searches Predict.fun markets via their API
 * - type=wallet → validates wallet address format only (actual lookup is client-side redirect)
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") || "").trim();
  const platform = searchParams.get("platform") || "predictfun";
  const type = searchParams.get("type") || "market";

  if (!query) {
    return NextResponse.json({ results: [], total: 0 });
  }

  // Wallet type: just validate format, client handles redirect
  if (type === "wallet") {
    const isValid = /^0x[a-fA-F0-9]{40}$/i.test(query);
    return NextResponse.json({
      isValidWallet: isValid,
      wallet: isValid ? query : null,
      platform,
    });
  }

  try {
    if (platform === "opinion") {
      return await searchOpinion(query);
    } else {
      return await searchPredictFun(query);
    }
  } catch (err) {
    console.error("[search] Error:", err.message);
    return NextResponse.json({ results: [], total: 0, error: err.message });
  }
}

async function searchOpinion(query) {
  // Opinion API doesn't have a text search endpoint,
  // so we fetch activated markets sorted by volume and filter client-side.
  // Fetch up to 5 pages to get a good pool for searching.
  const pages = await Promise.all(
    [1, 2, 3, 4, 5].map((page) =>
      opinionFetch("/market", {
        params: { status: "activated", sortBy: 5, limit: 20, page, marketType: 0 },
      }).catch(() => null)
    )
  );

  const allMarkets = [];
  for (const data of pages) {
    if (data?.errno === 0) {
      const { list } = normalizeMarketList(data);
      allMarkets.push(...list);
    }
  }

  // Dedup by marketId
  const seen = new Set();
  const unique = allMarkets.filter((m) => {
    const id = String(m.marketId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Filter by search query
  const q = query.toLowerCase();
  const filtered = unique.filter((m) => {
    const title = String(m.title || m.marketTitle || m.tittle || "").toLowerCase();
    const id = String(m.marketId || "");
    return title.includes(q) || id.includes(q);
  });

  return NextResponse.json({
    results: filtered.slice(0, 20),
    total: filtered.length,
    platform: "opinion",
  });
}

async function searchPredictFun(query) {
  // Use the predict.fun discover cache if available, or fetch fresh
  const { fetchAllPredictFunMarkets } = await import("@/lib/predictfun");
  const { getPredictFunDisplayTitleText } = await import("@/lib/predictfunDisplay");

  let markets = [];

  // Try to use the cached discover data first
  try {
    const cacheModule = globalThis.__PF_MARKETS_CACHE__;
    if (cacheModule?.data && Array.isArray(cacheModule.data) && cacheModule.data.length > 0) {
      markets = cacheModule.data;
    }
  } catch {}

  // Fallback: fetch fresh if cache is empty
  if (markets.length === 0) {
    try {
      markets = await fetchAllPredictFunMarkets({ pageSize: 50, maxMarkets: 500 });
    } catch (err) {
      console.error("[search] PF fetch failed:", err.message);
    }
  }

  const q = query.toLowerCase();
  const filtered = markets.filter((m) => {
    const title = getPredictFunDisplayTitleText(m).toLowerCase();
    const catTitle = String(m?._categoryTitle ?? "").toLowerCase();
    const slug = String(m?.categorySlug ?? "").toLowerCase();
    const id = String(m?.id ?? "");
    return title.includes(q) || catTitle.includes(q) || slug.includes(q) || id.includes(q);
  });

  return NextResponse.json({
    results: filtered.slice(0, 20),
    total: filtered.length,
    platform: "predictfun",
  });
}
