import { getSmartMoneyPlatformAdapter, normalizeSmartMoneyPlatform } from "@/lib/smartMoneyPlatform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const platform = normalizeSmartMoneyPlatform(searchParams.get("platform"));
  const adapter = getSmartMoneyPlatformAdapter(platform);
  await adapter.start();
  const status = adapter.getStatus();

  return Response.json({ platform, ...status }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
