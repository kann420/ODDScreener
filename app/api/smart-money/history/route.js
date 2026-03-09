import { startSmartMoneyHub } from "@/lib/smartMoneyHub";
import { countTrades, queryTradesPaged } from "@/lib/smartMoneyDb";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 60 };

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "smart-money-history",
    RATE_LIMIT_OPTS,
    "Too many smart money history requests. Please slow down."
  );
  if (limited) return limited;

  startSmartMoneyHub();

  const { searchParams } = new URL(req.url);
  const hours = Number(searchParams.get("hours") || 24);
  const minAmount = Number(searchParams.get("minAmount") || 200);
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || 50)));

  const total = countTrades({ hours, minAmount });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const rows = queryTradesPaged({ hours, minAmount, limit: pageSize, offset });

  return Response.json(
    {
      ok: true,
      hours,
      minAmount,
      page: safePage,
      pageSize,
      total,
      totalPages,
      rows,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
