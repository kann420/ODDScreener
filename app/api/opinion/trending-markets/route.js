import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 45 };

/**
 * GET /api/opinion/trending-markets
 *
 * Returns top markets sorted by volume24h (sortBy=5).
 * Docs: https://docs.opinion.trade/developer-guide/opinion-open-api/market
 *
 * Single API call: /market?status=activated&sortBy=5&limit=10&page=1
 * No marketType filter — returns whatever has the highest volume24h.
 *
 * Query params:
 * - limit: number of markets to return (default: 10, max: 50)
 */
export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "opinion-trending-markets",
    RATE_LIMIT_OPTS,
    "Too many trending market requests. Please slow down."
  );
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || "10"), 50);

  try {
    // Fetch with retry (single retry after 2s on transient upstream errors)
    const fetchTrending = async (attempt = 0) => {
      const data = await opinionFetch("/market", {
        params: {
          status: "activated",
          sortBy: 5, // volume24h desc
          limit,
          page: 1,
          // No marketType filter — docs say just sortBy=5&limit=10
        },
      });

      if (data?.errno !== 0) {
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 2000));
          return fetchTrending(attempt + 1);
        }
        return null;
      }

      return data;
    };

    const data = await fetchTrending();

    if (!data) {
      return NextResponse.json({
        errno: -1,
        errormsg: "upstream_unavailable",
        markets: [],
      });
    }

    // The API already filters by status=activated, so result.list is clean.
    // Just pass through — the volume24h ordering from the API is authoritative.
    const list = data?.result?.list || [];

    return NextResponse.json({
      errno: 0,
      markets: list,
      total: list.length,
    });
  } catch (err) {
    console.error("[trending-markets] Error:", err);
    return NextResponse.json({
      errno: -1,
      errormsg: "Internal error",
      markets: [],
    });
  }
}
