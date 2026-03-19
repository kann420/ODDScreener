import { getTradesDebugSummary } from "@/lib/smartMoneyDb";
import { getSmartMoneyPlatformAdapter, normalizeSmartMoneyPlatform } from "@/lib/smartMoneyPlatform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not available" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const platform = normalizeSmartMoneyPlatform(searchParams.get("platform"));
  const adapter = getSmartMoneyPlatformAdapter(platform);
  await adapter.start();

  return Response.json(
    {
      ok: true,
      platform,
      hub: adapter.getStatus(),
      db: getTradesDebugSummary({ platform }),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
