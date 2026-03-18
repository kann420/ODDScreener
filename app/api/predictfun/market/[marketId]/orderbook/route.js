import { NextResponse } from "next/server";
import { getPredictFunOrderbookData } from "@/lib/predictfun";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeMid(bestBid, bestAsk) {
  if (Number.isFinite(bestBid) && bestBid > 0 && Number.isFinite(bestAsk) && bestAsk > 0) {
    return (bestBid + bestAsk) / 2;
  }
  if (Number.isFinite(bestBid) && bestBid > 0) return bestBid;
  if (Number.isFinite(bestAsk) && bestAsk > 0) return bestAsk;
  return null;
}

function mapSide(side) {
  return {
    bestBid: numberOrNull(side?.bestBid),
    bestAsk: numberOrNull(side?.bestAsk),
    bestBidSize: numberOrNull(side?.bestBidSize),
    bestAskSize: numberOrNull(side?.bestAskSize),
    totalLiquidity: numberOrNull(side?.totalLiquidity),
    bidNotional: numberOrNull(side?.bidNotional),
    askNotional: numberOrNull(side?.askNotional),
    spread: Number.isFinite(side?.bestBid) && Number.isFinite(side?.bestAsk)
      ? side.bestAsk - side.bestBid
      : null,
    bids: Array.isArray(side?.bids) ? side.bids : [],
    asks: Array.isArray(side?.asks) ? side.asks : [],
  };
}

export async function GET(req, { params }) {
  const { marketId } = params;
  if (!marketId) {
    return NextResponse.json({ error: "missing marketId" }, { status: 400 });
  }

  try {
    const data = await getPredictFunOrderbookData(marketId);
    if (!data) {
      return NextResponse.json({ error: "orderbook_not_found" }, { status: 404 });
    }

    const yes = mapSide(data.yes);
    const no = mapSide(data.no);

    return NextResponse.json({
      marketId: String(marketId),
      decimalPrecision: data.decimalPrecision,
      updatedAtMs: data.orderbookUpdatedAtMs ?? null,
      midYes: computeMid(yes.bestBid, yes.bestAsk),
      midNo: computeMid(no.bestBid, no.bestAsk),
      yes,
      no,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
      },
    });
  } catch (err) {
    console.error(`[PF Orderbook] Error for ${marketId}:`, err?.message);
    return NextResponse.json({ error: err?.message || "predictfun_orderbook_failed" }, { status: 500 });
  }
}
