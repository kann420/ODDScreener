import { NextResponse } from "next/server";
import { getMultiOutcomeMarkets } from "@/lib/opinionAnalytics";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 30 };

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "analytics-markets",
    RATE_LIMIT_OPTS,
    "Too many analytics market requests. Please slow down."
  );
  if (limited) return limited;

  const data = await getMultiOutcomeMarkets();

  if (!data.success) {
    return NextResponse.json({ 
      success: false, 
      error: data.error || { message: "Failed to fetch multi-outcome markets" } 
    });
  }

  return NextResponse.json({
    success: true,
    data: data.data,
    total: data.total,
  });
}
