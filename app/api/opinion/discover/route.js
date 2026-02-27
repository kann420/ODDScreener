import { NextResponse } from "next/server";
import { fetchMarkets } from "@/app/MarketsContent";

/**
 * GET /api/opinion/discover
 *
 * Returns the full Discover market dataset (same as SSR fetchMarkets).
 * Used by the client for progressive loading: SSR sends a quick initial
 * batch, then the client fetches the complete set via this route.
 */
export async function GET() {
  try {
    const { error, filtered, bonusIdsFromList } = await fetchMarkets();

    if (error) {
      return NextResponse.json(
        { error: true, filtered: [], bonusIdsFromList: [] },
        { status: 502 }
      );
    }

    return NextResponse.json({
      error: false,
      filtered,
      bonusIdsFromList,
      ts: Date.now(),
    });
  } catch (err) {
    console.error("[API /discover] Failed:", err.message);
    return NextResponse.json(
      { error: true, message: err.message },
      { status: 500 }
    );
  }
}
