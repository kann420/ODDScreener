import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 60_000;

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

const MAX_CACHE_SIZE = 5000;

function cacheSet(key, value) {
  if (CACHE.size >= MAX_CACHE_SIZE) {
    const oldest = CACHE.keys().next().value;
    CACHE.delete(oldest);
  }
  CACHE.set(key, { t: Date.now(), v: value });
}

function json(resObj, cacheStatus) {
  return NextResponse.json(resObj, {
    status: 200,
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
      "x-cache": cacheStatus,
    },
  });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token_id = searchParams.get("token_id");
    const interval = searchParams.get("interval") || "1d";
    const start_at = searchParams.get("start_at") || "";
    const end_at = searchParams.get("end_at") || "";

    if (!token_id) {
      return json({ errno: -1, errormsg: "missing_token_id", result: null }, "MISS");
    }

    const key = `price-history:${token_id}:${interval}:${start_at}:${end_at}`;
    const cached = cacheGet(key);
    if (cached) return json(cached, "HIT");

    const params = { token_id, interval };
    if (start_at) params.start_at = start_at;
    if (end_at) params.end_at = end_at;

    const r = await opinionFetch("/token/price-history", { params });

    const ok =
      (typeof r?.errno === "number" && r.errno === 0) ||
      (typeof r?.code === "number" && r.code === 0);

    if (!ok) {
      return json(
        { errno: -1, errormsg: "price_history_failed", result: null },
        "MISS"
      );
    }

    const payload = { errno: 0, errormsg: "", result: r?.result ?? r };
    cacheSet(key, payload);
    return json(payload, "MISS");
  } catch (e) {
    return NextResponse.json(
      { errno: -1, errormsg: "price_history_route_error", result: null },
      { status: 200, headers: { "x-cache": "MISS" } }
    );
  }
}
