import { startSmartMoneyHub } from "@/lib/smartMoneyHub";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 20 };

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "smart-money-warm",
    RATE_LIMIT_OPTS,
    "Too many smart money warm-up requests. Please slow down."
  );
  if (limited) return limited;

  startSmartMoneyHub();

  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
