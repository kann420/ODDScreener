import { NextResponse } from "next/server";
import { getRecentTradesForMarket } from "@/lib/recentTradesDb";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const marketId = searchParams.get("marketId");

    if (!marketId) {
      return NextResponse.json(
        { ok: false, error: "missing marketId" },
        { status: 400 }
      );
    }

    const trades = await getRecentTradesForMarket(Number(marketId));

    return NextResponse.json({
      ok: true,
      marketId: Number(marketId),
      trades,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
