import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 90 };

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "opinion-markets",
    RATE_LIMIT_OPTS,
    "Too many market list requests. Please slow down."
  );
  if (limited) return limited;

  const { searchParams } = new URL(req.url);

  const status = searchParams.get("status") || "activated";
  const sortBy = Number(searchParams.get("sortBy") || "5");
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit") || "20"), 50));
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const rawMarketType = Number(searchParams.get("marketType") || "2"); // 0=binary, 1=categorical, 2=all
  const marketType = [0, 1, 2].includes(rawMarketType) ? rawMarketType : 2;

  const data = await opinionFetch("/market", {
    params: { status, sortBy, limit, page, marketType },
  });

  return NextResponse.json(data);
}
