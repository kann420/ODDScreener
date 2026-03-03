import { NextResponse } from "next/server";
import { getPolyOrderbook } from "@/lib/polymarket";
import { opinionFetch } from "@/lib/opinion";

export const runtime = "nodejs";

const TTL_MS = 15_000;
const CACHE = globalThis.__ARB_OB_CACHE__ ?? (globalThis.__ARB_OB_CACHE__ = new Map());

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.v;
}

const MAX_CACHE_SIZE = 2000;

function cacheSet(key, value) {
  if (CACHE.size >= MAX_CACHE_SIZE) {
    const oldest = CACHE.keys().next().value;
    CACHE.delete(oldest);
  }
  CACHE.set(key, { t: Date.now(), v: value });
}

/**
 * GET /api/arbitage/orderbook?platform=poly|opinion&token_id=...
 * Returns normalised orderbook { bids: [{price, shares, total}], asks: [{price, shares, total}] }
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get("platform"); // "poly" or "opinion"
    const tokenId = searchParams.get("token_id");

    if (!platform || !tokenId) {
      return NextResponse.json({ ok: false, error: "missing params" }, { status: 400 });
    }

    const key = `arb-ob:${platform}:${tokenId}`;
    const cached = cacheGet(key);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "public, s-maxage=15", "x-cache": "HIT" },
      });
    }

    let result;

    if (platform === "poly") {
      // Poly CLOB sometimes returns empty arrays on first try — retry once
      let ob = await getPolyOrderbook(tokenId);
      if (ob && (ob.bids || []).length === 0 && (ob.asks || []).length === 0) {
        await new Promise((r) => setTimeout(r, 400));
        ob = await getPolyOrderbook(tokenId);
      }
      if (!ob) {
        return NextResponse.json({ ok: false, error: "poly_orderbook_failed" }, { status: 200 });
      }
      // Normalize: Poly CLOB bids are ASC (best bid = last), asks are DESC (best ask = last)
      // We want bids sorted highest first, asks sorted lowest first
      const bids = (ob.bids || [])
        .map((b) => ({ price: b.price, shares: b.size, total: b.price * b.size }))
        .sort((a, b) => b.price - a.price);
      const asks = (ob.asks || [])
        .map((a) => ({ price: a.price, shares: a.size, total: a.price * a.size }))
        .sort((a, b) => a.price - b.price);
      result = { ok: true, bids, asks };
    } else if (platform === "opinion") {
      const r = await opinionFetch("/token/orderbook", { params: { token_id: tokenId } });
      const data = r?.result ?? r ?? {};
      const rawBids = data?.bids ?? data?.buy ?? data?.bid ?? [];
      const rawAsks = data?.asks ?? data?.sell ?? data?.ask ?? [];

      const mapSide = (arr) =>
        (Array.isArray(arr) ? arr : []).map((row) => {
          let price, shares;
          if (Array.isArray(row) && row.length >= 2) {
            price = Number(row[0]);
            shares = Number(row[1]);
          } else if (row && typeof row === "object") {
            price = Number(row.price ?? row.p ?? row.rate ?? 0);
            shares = Number(row.shares ?? row.size ?? row.amount ?? row.qty ?? 0);
          } else {
            price = 0;
            shares = 0;
          }
          return { price, shares, total: price * shares };
        });

      const bids = mapSide(rawBids).sort((a, b) => b.price - a.price);
      const asks = mapSide(rawAsks).sort((a, b) => a.price - b.price);
      result = { ok: true, bids, asks };
    } else {
      return NextResponse.json({ ok: false, error: "invalid platform" }, { status: 400 });
    }

    cacheSet(key, result);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=15", "x-cache": "MISS" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || "orderbook_error") },
      { status: 200 }
    );
  }
}
