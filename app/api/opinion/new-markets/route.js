import { NextResponse } from "next/server";
import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 60 };

/**
 * ✅ API endpoint to fetch NEWEST markets (sortBy=1)
 * This is optimized for the "New" tab to get recently created markets
 * 
 * Query params:
 * - limit: number of markets to fetch (default: 50, max: 100)
 * - status: market status filter (default: "activated")
 * - marketType: 0=binary, 1=categorical, 2=all (default: 2)
 */
export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "opinion-new-markets",
    RATE_LIMIT_OPTS,
    "Too many new market requests. Please slow down."
  );
  if (limited) return limited;

  const { searchParams } = new URL(req.url);

  const status = searchParams.get("status") || "activated";
  const limit = Math.min(Number(searchParams.get("limit") || "50"), 100);
  const marketType = Number(searchParams.get("marketType") || "2");

  // ✅ sortBy=1 means sort by NEWEST (createdAt DESC)
  const data = await opinionFetch("/market", {
    params: { 
      status, 
      sortBy: 1, // ← Key difference: sort by new
      limit, 
      marketType 
    },
  });

  if (data?.errno !== 0) {
    return NextResponse.json(data, { status: 500 });
  }

  // Normalize the response
  const { total, list } = normalizeMarketList(data);

  return NextResponse.json({
    errno: 0,
    result: {
      total,
      list,
    },
  });
}
