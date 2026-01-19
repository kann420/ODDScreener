import { startSmartMoneyHub } from "@/lib/smartMoneyHub";

export const runtime = "nodejs";

export async function GET() {
  // Start WS hub as early as possible
  startSmartMoneyHub();

  // ✅ must NOT use 204 with body (can crash on some runtimes)
  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
