import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 90 };

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "opinion-token-trades",
    RATE_LIMIT_OPTS,
    "Too many trade history requests. Please slow down."
  );
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const token_id = searchParams.get("token_id");
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit") || "200"), 200));

  if (!token_id) {
    return NextResponse.json({ errno: -1, errormsg: "missing_token_id", result: null }, { status: 400 });
  }

  let r = await opinionFetch("/token/trades", { params: { token_id, limit } });

  const ok =
    (typeof r?.errno === "number" && r.errno === 0) ||
    (typeof r?.code === "number" && r.code === 0);

  if (!ok) {
    const r2 = await opinionFetch("/token/trade", { params: { token_id, limit } });
    const ok2 =
      (typeof r2?.errno === "number" && r2.errno === 0) ||
      (typeof r2?.code === "number" && r2.code === 0);

    if (!ok2) {
      return NextResponse.json(
        { errno: -1, errormsg: "trades_failed", result: null },
        { status: 502 }
      );
    }

    r = r2;
  }

  const result = r?.result ?? r;
  return NextResponse.json({ errno: 0, errormsg: "", result }, { status: 200 });
}
