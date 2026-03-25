/**
 * API Route: GET /api/opinion/wallet/[wallet]/positions
 *
 * Proxy for Opinion OpenAPI positions endpoint.
 * Fetches wallet positions without exposing API key to client.
 * Enriches positions with market thumbnail images.
 */

import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidWallet(address) {
  if (!address || typeof address !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

const thumbnailCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
let cacheRefreshPromise = null;
let lastRefreshStart = 0;

function getThumbnail(marketId) {
  if (!marketId) return null;
  const cached = thumbnailCache.get(String(marketId));
  if (cached && (Date.now() - cached.time) < CACHE_TTL) {
    return cached.url;
  }
  return null;
}

function startThumbnailCacheRefresh() {
  const now = Date.now();
  if (cacheRefreshPromise || (now - lastRefreshStart < 60000 && thumbnailCache.size > 0)) {
    return;
  }

  lastRefreshStart = now;

  cacheRefreshPromise = (async () => {
    try {
      console.log("[thumbnailCache] Starting cache refresh...");

      for (const status of ["activated", "resolved"]) {
        let page = 1;
        while (page <= 10) {
          const data = await opinionFetch("/market", {
            params: { status, limit: 20, page, marketType: 2 },
          });

          if (data?.errno !== 0 || !data.result?.list?.length) break;

          for (const market of data.result.list) {
            if (market.thumbnailUrl) {
              thumbnailCache.set(String(market.marketId), {
                url: market.thumbnailUrl,
                time: Date.now(),
              });
            }
          }

          if (data.result.list.length < 20) break;
          page++;
        }
      }

      let page = 1;
      while (page <= 20) {
        const data = await opinionFetch("/market", {
          params: { limit: 20, page, marketType: 1 },
        });

        if (data?.errno !== 0 || !data.result?.list?.length) break;

        for (const market of data.result.list) {
          if (market.thumbnailUrl) {
            thumbnailCache.set(String(market.marketId), {
              url: market.thumbnailUrl,
              time: Date.now(),
            });
          }
        }

        if (data.result.list.length < 20) break;
        page++;
      }

      console.log(`[thumbnailCache] Loaded ${thumbnailCache.size} markets`);
    } catch (error) {
      console.error("[thumbnailCache] Error:", error?.message || error);
    } finally {
      cacheRefreshPromise = null;
    }
  })();
}

async function fetchThumbnailsOnDemand(marketIds) {
  const result = new Map();
  if (!marketIds.length) return result;

  await Promise.all(
    marketIds.map(async (id) => {
      try {
        const data = await opinionFetch(`/market/categorical/${id}`);
        const thumb = data?.result?.data?.thumbnailUrl;
        if (thumb) {
          result.set(id, thumb);
          thumbnailCache.set(id, { url: thumb, time: Date.now() });
        }
      } catch (error) {
        console.error("[thumbnailCache] onDemand fetch failed:", error?.message || error);
      }
    }),
  );

  return result;
}

export async function GET(request, { params }) {
  try {
    const { wallet } = await params;

    if (!isValidWallet(wallet)) {
      return NextResponse.json(
        { code: -1, msg: "Invalid wallet address format", result: null },
        { status: 400 },
      );
    }

    if (!process.env.OPINION_API_KEY) {
      return NextResponse.json(
        { code: -1, msg: "API key not configured", result: null },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const chainId = searchParams.get("chainId") || "56";
    const page = searchParams.get("page") || "1";
    const limit = Math.min(Number(searchParams.get("limit") || "20"), 20);

    startThumbnailCacheRefresh();

    const data = await opinionFetch(`/positions/user/${wallet}`, {
      params: { chainId, page, limit },
    });

    if (data?.errno !== 0) {
      return NextResponse.json(
        { code: -1, msg: data?.errormsg || "Upstream error", result: null },
        { status: 502 },
      );
    }

    if (data.result?.list?.length > 0) {
      data.result.list = data.result.list.map((pos) => {
        const mainTitle = pos.rootMarketTitle || "";
        const outcomeName = pos.marketTitle || pos.outcome || "";

        const displayTitle =
          mainTitle && outcomeName && mainTitle !== outcomeName
            ? `${mainTitle} - ${outcomeName}`
            : mainTitle || outcomeName || "Unknown";

        const thumbnailUrl = getThumbnail(pos.rootMarketId) || getThumbnail(pos.marketId);

        return {
          ...pos,
          thumbnailUrl,
          displayTitle,
          fullMarketTitle: mainTitle,
          outcomeName,
        };
      });

      const missingIds = [...new Set(
        data.result.list
          .filter((p) => !p.thumbnailUrl && (p.rootMarketId || p.marketId))
          .map((p) => String(p.rootMarketId || p.marketId)),
      )];

      if (missingIds.length > 0) {
        const fetched = await fetchThumbnailsOnDemand(missingIds);
        if (fetched.size > 0) {
          data.result.list = data.result.list.map((pos) => {
            if (pos.thumbnailUrl) return pos;
            const id = String(pos.rootMarketId || pos.marketId);
            const url = fetched.get(id) || null;
            return url ? { ...pos, thumbnailUrl: url } : pos;
          });
        }
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[wallet/positions] Error:", error);
    return NextResponse.json(
      { code: -1, msg: "Internal server error", result: null },
      { status: 500 },
    );
  }
}
