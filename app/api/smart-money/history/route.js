import { getSmartMoneyPlatformAdapter, normalizeSmartMoneyPlatform } from "@/lib/smartMoneyPlatform";
import { countTrades, queryTradesPaged } from "@/lib/smartMoneyDb";
import { fetchPredictFunAccountInfo } from "@/lib/predictfunHiddenGraphql";
import {
  buildPredictFunSmartMoneyDisplayTitle,
  mapPredictFunQuoteTypeToTradeSide,
} from "@/lib/utils/predictfunSmartMoney";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREDICTFUN_ACCOUNT_CACHE_TTL_MS = 10 * 60 * 1000;
const predictFunSmartMoneyAccountCache =
  globalThis.__PREDICTFUN_SMART_MONEY_ACCOUNT_CACHE__ ||
  new Map();

globalThis.__PREDICTFUN_SMART_MONEY_ACCOUNT_CACHE__ =
  predictFunSmartMoneyAccountCache;

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

async function getCachedPredictFunAccountInfo(address) {
  const normalizedAddress = String(address || "").trim();
  if (!isWalletAddress(normalizedAddress)) return null;

  const cacheKey = normalizedAddress.toLowerCase();
  const cached = predictFunSmartMoneyAccountCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PREDICTFUN_ACCOUNT_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const account = await fetchPredictFunAccountInfo(normalizedAddress);
    predictFunSmartMoneyAccountCache.set(cacheKey, {
      data: account || null,
      fetchedAt: Date.now(),
    });
    return account || null;
  } catch (err) {
    console.warn("[SmartMoney][PredictFun] account enrich failed:", err?.message || err);
    predictFunSmartMoneyAccountCache.set(cacheKey, {
      data: null,
      fetchedAt: Date.now(),
    });
    return null;
  }
}

async function enrichPredictFunRowsWithAccountInfo(rows) {
  const baseRows = Array.isArray(rows) ? rows : [];
  if (!baseRows.length) return [];

  const addresses = [
    ...new Set(
      baseRows
        .map((row) => String(row?.signer || "").trim())
        .filter((address) => isWalletAddress(address))
    ),
  ];

  if (!addresses.length) return baseRows;

  const settled = await Promise.allSettled(
    addresses.map(async (address) => {
      const account = await getCachedPredictFunAccountInfo(address);
      return [address.toLowerCase(), account];
    })
  );

  const accountsByAddress = new Map();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const [addressKey, account] = result.value || [];
    if (!addressKey || !account) continue;
    accountsByAddress.set(addressKey, account);
  }

  return baseRows.map((row) => {
    const addressKey = String(row?.signer || "").trim().toLowerCase();
    const account = accountsByAddress.get(addressKey);
    if (!account?.name) return row;

    return {
      ...row,
      accountName: account.name,
    };
  });
}

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
  const normalizedRows = queryTradesPaged({ hours, minAmount, limit: pageSize, offset, platform }).map((row) => {
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
  const rows =
    platform === "predictfun"
      ? await enrichPredictFunRowsWithAccountInfo(normalizedRows)
      : normalizedRows;

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
