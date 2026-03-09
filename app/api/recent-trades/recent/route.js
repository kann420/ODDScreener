import { NextResponse } from "next/server";
import { queryRecentTradesForMarket } from "@/lib/recentTradesDb";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 60 };

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "recent-trades-recent",
    RATE_LIMIT_OPTS,
    "Too many recent trade requests. Please slow down."
  );
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const marketId = searchParams.get("marketId");
  const rootMarketId = searchParams.get("rootMarketId");
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit") || "200"), 200));

  const rows = queryRecentTradesForMarket({
    marketId: marketId != null ? Number(marketId) : null,
    rootMarketId: rootMarketId != null ? Number(rootMarketId) : null,
    hours: 24,
    limit,
  });

  return NextResponse.json({ ok: true, rows });
}
