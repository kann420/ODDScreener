import { NextResponse } from "next/server";
import { getPolyOrderbook } from "@/lib/polymarket";
import { opinionFetch } from "@/lib/opinion";
import { fetchProbableOrderbook } from "@/lib/probable";
import { getPredictFunDisplayOrderbook } from "@/lib/predictfun";

export const runtime = "nodejs";

const TTL_MS = 15_000;
const CACHE = globalThis.__ARB_OB_CACHE__ ?? (globalThis.__ARB_OB_CACHE__ = new Map());
const MAX_CACHE_SIZE = 2000;

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
  if (CACHE.size >= MAX_CACHE_SIZE) {
    const oldest = CACHE.keys().next().value;
    CACHE.delete(oldest);
  }
  CACHE.set(key, { t: Date.now(), v: value });
}

function mapOpinionSide(levels) {
  return (Array.isArray(levels) ? levels : []).map((row) => {
    let price;
    let shares;

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

    return {
      price,
      shares,
      total: price * shares,
    };
  });
}

/**
 * GET /api/arbitage/orderbook?platform=poly|opinion|probable|predictfun&token_id=...
 * Returns normalized orderbook { bids: [{ price, shares, total }], asks: [{ price, shares, total }] }
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get("platform");
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

    let result = null;

    if (platform === "poly") {
      let ob = await getPolyOrderbook(tokenId);
      if (ob && (ob.bids || []).length === 0 && (ob.asks || []).length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        ob = await getPolyOrderbook(tokenId);
      }

      if (!ob) {
        return NextResponse.json({ ok: false, error: "poly_orderbook_failed" }, { status: 200 });
      }

      result = {
        ok: true,
        bids: (ob.bids || [])
          .map((bid) => ({ price: bid.price, shares: bid.size, total: bid.price * bid.size }))
          .sort((a, b) => b.price - a.price),
        asks: (ob.asks || [])
          .map((ask) => ({ price: ask.price, shares: ask.size, total: ask.price * ask.size }))
          .sort((a, b) => a.price - b.price),
      };
    } else if (platform === "opinion") {
      const response = await opinionFetch("/token/orderbook", { params: { token_id: tokenId } });
      const data = response?.result ?? response ?? {};
      const rawBids = data?.bids ?? data?.buy ?? data?.bid ?? [];
      const rawAsks = data?.asks ?? data?.sell ?? data?.ask ?? [];

      result = {
        ok: true,
        bids: mapOpinionSide(rawBids).sort((a, b) => b.price - a.price),
        asks: mapOpinionSide(rawAsks).sort((a, b) => a.price - b.price),
      };
    } else if (platform === "probable") {
      const ob = await fetchProbableOrderbook(tokenId);
      if (!ob) {
        return NextResponse.json({ ok: false, error: "probable_orderbook_failed" }, { status: 200 });
      }

      result = {
        ok: true,
        bids: (ob.bids || [])
          .map((bid) => ({
            price: Number(bid.price ?? bid.p ?? 0),
            shares: Number(bid.size ?? bid.shares ?? bid.amount ?? 0),
            total: Number(bid.price ?? bid.p ?? 0) * Number(bid.size ?? bid.shares ?? bid.amount ?? 0),
          }))
          .sort((a, b) => b.price - a.price),
        asks: (ob.asks || [])
          .map((ask) => ({
            price: Number(ask.price ?? ask.p ?? 0),
            shares: Number(ask.size ?? ask.shares ?? ask.amount ?? 0),
            total: Number(ask.price ?? ask.p ?? 0) * Number(ask.size ?? ask.shares ?? ask.amount ?? 0),
          }))
          .sort((a, b) => a.price - b.price),
      };
    } else if (platform === "predictfun") {
      const ob = await getPredictFunDisplayOrderbook(String(tokenId));
      if (!ob) {
        return NextResponse.json({ ok: false, error: "predictfun_orderbook_failed" }, { status: 200 });
      }

      result = {
        ok: true,
        bids: ob.bids,
        asks: ob.asks,
      };
    } else {
      return NextResponse.json({ ok: false, error: "invalid platform" }, { status: 400 });
    }

    cacheSet(key, result);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=15", "x-cache": "MISS" },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || "orderbook_error") },
      { status: 200 }
    );
  }
}
