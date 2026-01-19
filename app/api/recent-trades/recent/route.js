import { NextResponse } from "next/server";
import { queryRecentTradesForMarket } from "@/lib/recentTradesDb";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const marketId = searchParams.get("marketId");
  const rootMarketId = searchParams.get("rootMarketId");
  const limit = Number(searchParams.get("limit") || "200");

  const rows = queryRecentTradesForMarket({
    marketId: marketId != null ? Number(marketId) : null,
    rootMarketId: rootMarketId != null ? Number(rootMarketId) : null,
    hours: 24,
    limit,
  });

  return NextResponse.json({ ok: true, rows });
}
