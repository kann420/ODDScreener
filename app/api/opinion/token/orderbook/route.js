import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export const runtime = "nodejs";

// A1: Orderbook changes fast -> shorter cache
const TTL_MS = 20_000;

// global cache (per server instance)
const CACHE = globalThis.__ODD_CACHE__ ?? (globalThis.__ODD_CACHE__ = new Map());

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;

  // hit = { t: <ms>, v: <payload> }
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
      // Help CDNs/proxies too; local dev may ignore this, but our in-memory cache still works
      "Cache-Control": "public, s-maxage=20, stale-while-revalidate=20",
      "x-cache": cacheStatus, // HIT | MISS
    },
  });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token_id = searchParams.get("token_id");

    if (!token_id) {
      return json({ errno: -1, errormsg: "missing_token_id", result: null }, "MISS");
    }

    const key = `orderbook:${token_id}`;

    const cached = cacheGet(key);
    if (cached) return json(cached, "HIT");

    const r = await opinionFetch("/token/orderbook", { params: { token_id } });

    const ok =
      (typeof r?.errno === "number" && r.errno === 0) ||
      (typeof r?.code === "number" && r.code === 0);

    if (!ok) {
      // do NOT cache failures
      return json(
        { errno: -1, errormsg: "orderbook_failed", result: null, debug: r },
        "MISS"
      );
    }

    const payload = { errno: 0, errormsg: "", result: r?.result ?? r };
    cacheSet(key, payload);
    return json(payload, "MISS");
  } catch (e) {
    // never crash the route
    return NextResponse.json(
      { errno: -1, errormsg: "orderbook_route_error", result: null },
      { status: 200, headers: { "x-cache": "MISS" } }
    );
  }
}
