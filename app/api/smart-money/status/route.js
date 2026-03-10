import { getSmartMoneyHubStatus, startSmartMoneyHub } from "@/lib/smartMoneyHub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  startSmartMoneyHub();
  const status = getSmartMoneyHubStatus();

  return Response.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
