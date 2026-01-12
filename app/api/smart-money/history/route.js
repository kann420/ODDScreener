// app/api/smart-money/history/route.js
import { queryTrades } from "@/lib/smartMoneyDb";
import { startSmartMoneyHub } from "@/lib/smartMoneyHub";

export const runtime = "nodejs";

export async function GET(req) {
  // đảm bảo hub chạy (nếu server mới boot)
  startSmartMoneyHub();

  const { searchParams } = new URL(req.url);
  const hours = Number(searchParams.get("hours") || 24);
  const minAmount = Number(searchParams.get("minAmount") || 200);
  const limit = Number(searchParams.get("limit") || 200);

  const rows = queryTrades({ hours, minAmount, limit });

  return Response.json(
    { ok: true, hours, minAmount, limit, rows },
    { headers: { "Cache-Control": "no-store" } }
  );
}
