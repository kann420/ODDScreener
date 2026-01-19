import { startSmartMoneyHub } from "@/lib/smartMoneyHub";

export const runtime = "nodejs";

export async function GET() {
  // Start WS hub as early as possible (triggered by a tiny hidden image request)
  startSmartMoneyHub();
  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
