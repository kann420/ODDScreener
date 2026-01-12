import { getSmartMoneyHubStatus, startSmartMoneyHub } from "@/lib/smartMoneyHub";

export const runtime = "nodejs";

export async function GET() {
  startSmartMoneyHub();
  const status = getSmartMoneyHubStatus();
  return Response.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
