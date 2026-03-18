import { NextResponse } from "next/server";
import { getPredictFunMarketHolders } from "@/lib/predictfunDetail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseLimit(searchParams) {
  const raw = Number(searchParams.get("limit") || 20);
  if (!Number.isFinite(raw)) return 20;
  return Math.min(50, Math.max(5, Math.round(raw)));
}

export async function GET(req, { params }) {
  const { marketId } = params;
  if (!marketId) {
    return NextResponse.json({ error: "missing marketId" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const limitPerOutcome = parseLimit(searchParams);
  const afterCursor = searchParams.get("cursor") || null;
  const outcomeId = searchParams.get("outcomeId") || null;

  try {
    const outcomes = await getPredictFunMarketHolders(marketId, {
      limitPerOutcome,
      afterCursor,
      outcomeId,
    });
    const loadedCount = outcomes.reduce((sum, outcome) => {
      const holders = Array.isArray(outcome?.holders) ? outcome.holders.length : 0;
      return sum + holders;
    }, 0);

    return NextResponse.json({
      marketId: String(marketId),
      limitPerOutcome,
      outcomeId,
      cursor: afterCursor,
      loadedCount,
      outcomes,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40",
      },
    });
  } catch (err) {
    console.error(`[PF Holders] Error for ${marketId}:`, err?.message);
    return NextResponse.json({
      marketId: String(marketId),
      limitPerOutcome,
      outcomeId,
      cursor: afterCursor,
      outcomes: [],
      error: err?.message || "predictfun_holders_failed",
    }, { status: 500 });
  }
}
