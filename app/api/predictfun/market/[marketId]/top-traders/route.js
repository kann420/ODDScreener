import { NextResponse } from "next/server";
import { getPredictFunTopTraders } from "@/lib/predictfunDetail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req, { params }) {
  const { marketId } = params;
  if (!marketId) {
    return NextResponse.json({ error: "missing marketId" }, { status: 400 });
  }

  try {
    const traders = await getPredictFunTopTraders(marketId, { maxEvents: 500 });
    return NextResponse.json({
      marketId: String(marketId),
      traders,
      count: traders.length,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.error(`[PF TopTraders] Error for ${marketId}:`, err?.message);
    return NextResponse.json({
      marketId: String(marketId),
      traders: [],
      error: err?.message || "predictfun_top_traders_failed",
    }, { status: 500 });
  }
}
