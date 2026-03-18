import { getSmartMoneyPlatformAdapter, normalizeSmartMoneyPlatform } from "@/lib/smartMoneyPlatform";
import { countTrades, queryTradesPaged } from "@/lib/smartMoneyDb";
import {
  buildPredictFunSmartMoneyDisplayTitle,
  mapPredictFunQuoteTypeToTradeSide,
} from "@/lib/utils/predictfunSmartMoney";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const platform = normalizeSmartMoneyPlatform(searchParams.get("platform"));
  const adapter = getSmartMoneyPlatformAdapter(platform);
  await adapter.start();
  const hours = Number(searchParams.get("hours") || 24);
  const minAmount = Number(searchParams.get("minAmount") || 200);
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || 50)));

  const total = countTrades({ hours, minAmount, platform });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const rows = queryTradesPaged({ hours, minAmount, limit: pageSize, offset, platform }).map((row) => {
    if (platform !== "predictfun") return row;

    const marketMeta = adapter.getMarketMeta?.(row.marketId);
    return {
      ...row,
      side: mapPredictFunQuoteTypeToTradeSide(row.side) || row.side,
      marketTitle: buildPredictFunSmartMoneyDisplayTitle({
        rawTitle: row.marketTitle || marketMeta?.marketTitle || null,
        question: marketMeta?.marketQuestion || null,
        categorySlug: row.categorySlug || marketMeta?.categorySlug || null,
        categoryTitle: marketMeta?.categoryTitle || null,
      }),
      marketUrl: row.marketUrl || marketMeta?.marketUrl || null,
      marketImageUrl: row.marketImageUrl || marketMeta?.marketImageUrl || null,
    };
  });

  return Response.json(
    {
      ok: true,
      platform,
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
