import { NextResponse } from "next/server";
import { countRecentTrades, getRecentTradesDbPath } from "@/lib/recentTradesDb";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";
import fs from "fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 20 };

export async function GET(request) {
  const limited = enforceIpRateLimit(
    request,
    "recent-trades-stats",
    RATE_LIMIT_OPTS,
    "Too many recent trade stats requests. Please slow down."
  );
  if (limited) return limited;

  const dbPath = getRecentTradesDbPath();
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(dbPath).size;
  } catch (error) {
    console.error("[RecentTradesStats] Failed to read DB size:", error.message);
  }

  return NextResponse.json({
    ok: true,
    sizeBytes,
    count24h: countRecentTrades({ hours: 24 }),
  });
}
