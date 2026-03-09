import { getSmartMoneyHubStatus, startSmartMoneyHub } from "@/lib/smartMoneyHub";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 20 };

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "smart-money-status",
    RATE_LIMIT_OPTS,
    "Too many smart money status requests. Please slow down."
  );
  if (limited) return limited;

  startSmartMoneyHub();
  const status = getSmartMoneyHubStatus();

  return Response.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
