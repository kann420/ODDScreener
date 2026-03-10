import { startSmartMoneyHub } from "@/lib/smartMoneyHub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  startSmartMoneyHub();

  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
