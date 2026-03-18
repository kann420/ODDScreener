import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 30_000;
const CACHE = globalThis.__OPINION_MARKET_DETAIL_CACHE__ ?? (globalThis.__OPINION_MARKET_DETAIL_CACHE__ = new Map());
const MAX_CACHE_SIZE = 2000;

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  // LRU promotion: move to end so eviction targets least-recently-used
  CACHE.delete(key);
  CACHE.set(key, hit);
  return hit.v;
}

function cacheSet(key, value) {
  CACHE.delete(key);
  if (CACHE.size >= MAX_CACHE_SIZE) {
    const lruKey = CACHE.keys().next().value;
    CACHE.delete(lruKey);
  }
  CACHE.set(key, { t: Date.now(), v: value });
}

export async function GET(req, { params }) {
  try {
    const marketId = params?.marketId;
    if (!marketId) {
      return NextResponse.json({ errno: -1, errormsg: "missing_marketId", result: null }, { status: 400 });
    }

    const cached = cacheGet(String(marketId));
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30", "x-cache": "HIT" },
      });
    }

    // Try binary endpoint first
    let payload = await opinionFetch(`/market/${marketId}`);
    const d = payload?.result?.data;

    // If it's categorical (marketType === 1) OR binary payload looks invalid, use categorical endpoint
    if (!d || typeof d !== "object" || d.marketType === 1) {
      const cat = await opinionFetch(`/market/categorical/${marketId}`);
      if (cat?.result?.data) payload = cat;
    }

    cacheSet(String(marketId), payload);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
        "x-cache": "MISS",
      },
    });
  } catch (e) {
    return NextResponse.json({ errno: -1, errormsg: "proxy_exception", result: null }, { status: 500 });
  }
}
