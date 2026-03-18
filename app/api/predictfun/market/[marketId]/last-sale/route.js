import { NextResponse } from "next/server";
import { getPredictFunLastSale, getPredictFunOrderbookData } from "@/lib/predictfun";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/predictfun/market/[marketId]/last-sale
 * Returns chance (mid price) and last-sale for a Predict.fun market
 */
export async function GET(req, { params }) {
  const { marketId } = params;
  if (!marketId) {
    return NextResponse.json({ error: "missing marketId" }, { status: 400 });
  }

  try {
    const [lastSale, obData] = await Promise.all([
      getPredictFunLastSale(marketId).catch(() => null),
      getPredictFunOrderbookData(marketId).catch(() => null),
    ]);

    // Compute mid price from orderbook
    let mid = 0;
    if (obData) {
      const bestBid = obData.bestBid ?? 0;
      const bestAsk = obData.bestAsk ?? 0;
      if (bestBid > 0 && bestAsk > 0) {
        mid = (bestBid + bestAsk) / 2;
      } else if (bestBid > 0) {
        mid = bestBid;
      } else if (bestAsk > 0) {
        mid = bestAsk;
      }
    }

    // Fallback to last-sale price
    if (mid <= 0 && lastSale?.priceInCurrency != null) {
      const lastPrice = Number(lastSale.priceInCurrency);
      if (Number.isFinite(lastPrice) && lastPrice > 0 && lastPrice <= 1) {
        mid = lastPrice;
      }
    }

    return NextResponse.json({
      marketId,
      mid,
      lastPrice: lastSale?.priceInCurrency != null ? Number(lastSale.priceInCurrency) : null,
      lastOutcome: lastSale?.outcome ?? null,
      bestBid: obData?.bestBid ?? null,
      bestAsk: obData?.bestAsk ?? null,
      totalLiquidity: obData?.totalLiquidity ?? null,
    });
  } catch (err) {
    console.error(`[PF LastSale] Error for ${marketId}:`, err?.message);
    return NextResponse.json({ marketId, mid: 0, error: err?.message }, { status: 500 });
  }
}
