import { NextResponse } from "next/server";
import { getPredictFunMarketEnrich } from "@/lib/predictfunDetail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req, { params }) {
  const { marketId } = params;
  if (!marketId) {
    return NextResponse.json({ error: "missing marketId" }, { status: 400 });
  }

  try {
    const detail = await getPredictFunMarketEnrich(marketId);
    if (!detail) {
      return NextResponse.json({ error: "market_not_found" }, { status: 404 });
    }

    return NextResponse.json(detail, {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    console.error(`[PF Enrich] Error for ${marketId}:`, err?.message);
    return NextResponse.json({ error: err?.message || "predictfun_enrich_failed" }, { status: 500 });
  }
}
