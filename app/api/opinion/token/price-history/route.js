import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export const runtime = "nodejs";

// A1: Price history changes slowly -> longer cache
const TTL_MS = 60_000;

// global cache (per server instance)
const CACHE = globalThis.__ODD_CACHE__ ?? (globalThis.__ODD_CACHE__ = new Map());

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.v;
}

function cacheSet(key, value) {
  CACHE.set(key, { t: Date.now(), v: value });
}

function json(resObj, cacheStatus) {
  return NextResponse.json(resObj, {
    status: 200,
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
      "x-cache": cacheStatus, // HIT | MISS
    },
  });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token_id = searchParams.get("token_id");
    const interval = searchParams.get("interval") || "1d"; // default daily

    if (!token_id) {
      return json({ errno: -1, errormsg: "missing_token_id", result: null }, "MISS");
    }

    const key = `price-history:${token_id}:${interval}`;
    const cached = cacheGet(key);
    if (cached) return json(cached, "HIT");

    const r = await opinionFetch("/token/price-history", { params: { token_id, interval } });

    const ok =
      (typeof r?.errno === "number" && r.errno === 0) ||
      (typeof r?.code === "number" && r.code === 0);

    if (!ok) {
      // do NOT cache failures
      return json(
        { errno: -1, errormsg: "price_history_failed", result: null, debug: r },
        "MISS"
      );
    }

    const payload = { errno: 0, errormsg: "", result: r?.result ?? r };
    cacheSet(key, payload);
    return json(payload, "MISS");
  } catch (e) {
    // never crash the route
    return NextResponse.json(
      { errno: -1, errormsg: "price_history_route_error", result: null },
      { status: 200, headers: { "x-cache": "MISS" } }
    );
  }
}
