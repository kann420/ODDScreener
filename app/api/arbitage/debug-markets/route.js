import { NextResponse } from "next/server";
import { fetchAllOpinionMarkets, fetchAllPolymarketEvents } from "@/lib/arbitageAutoMatcher";

export const dynamic = "force-dynamic";

/**
 * GET /api/arbitage/debug-markets
 * Debug endpoint to see what markets are being fetched from both exchanges
 * 
 * Query params:
 * - mode: "quick" (default, maxTotalMarkets=100) or "full" (maxTotalMarkets=9999)
 * - search: comma-separated keywords to search for
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") || "quick";
    const searchQuery = searchParams.get("search") || "";
    const keywords = searchQuery ? searchQuery.split(",").map(k => k.trim().toLowerCase()) : [];
    
    const maxTotalMarkets = mode === "full" ? 9999 : 100;
    const maxPages = mode === "full" ? 100 : 10;
    
    console.log(`\n=== DEBUG: Fetching markets (mode=${mode}, maxTotalMarkets=${maxTotalMarkets}) ===`);
    
    // Fetch from both exchanges
    const [opinionMarkets, polyEvents] = await Promise.all([
      fetchAllOpinionMarkets({ limit: 20, maxPages, maxTotalMarkets }),
      fetchAllPolymarketEvents({ limit: 100, maxPages: mode === "full" ? 30 : 10 }),
    ]);

    console.log(`Opinion markets: ${opinionMarkets.length}`);
    console.log(`Poly events: ${polyEvents.length}`);

    // Flatten Opinion markets including child markets
    const allOpinionTitles = [];
    for (const m of opinionMarkets) {
      allOpinionTitles.push({
        id: m.marketId,
        title: m.marketTitle || m.tittle || m.title,
        type: m.isCategorical ? "categorical" : "binary",
      });
      // Include child markets for categorical
      if (m.childMarkets && m.isCategorical) {
        for (const c of m.childMarkets) {
          allOpinionTitles.push({
            id: c.marketId,
            title: c.marketTitle || c.tittle,
            type: "child",
            parentId: m.marketId,
            parentTitle: m.marketTitle,
          });
        }
      }
    }

    // Search for keywords if provided
    let searchResults = null;
    if (keywords.length > 0) {
      searchResults = {};
      for (const kw of keywords) {
        // Search in Opinion
        const opMatches = allOpinionTitles.filter(m => 
          m.title && m.title.toLowerCase().includes(kw)
        ).slice(0, 5).map(m => ({ id: m.id, title: m.title, type: m.type, parentTitle: m.parentTitle }));
        
        // Search in Polymarket
        const polyMatches = [];
        for (const e of polyEvents) {
          if (e.title && e.title.toLowerCase().includes(kw)) {
            polyMatches.push({ slug: e.slug, title: e.title, type: "event" });
          }
          for (const m of (e.markets || [])) {
            const mTitle = m.question || m.title || "";
            if (mTitle.toLowerCase().includes(kw)) {
              polyMatches.push({ title: mTitle, type: "market", eventSlug: e.slug });
            }
          }
        }
        
        searchResults[kw] = {
          opinion: opMatches,
          polymarket: polyMatches.slice(0, 5),
        };
      }
    }

    // Sample data for response
    const opinionSample = allOpinionTitles.slice(0, 20).map((o) => ({
      id: o.id,
      title: o.title,
      type: o.type,
    }));

    const polySample = polyEvents.slice(0, 20).map((e) => ({
      slug: e.slug,
      title: e.title,
      marketsCount: e.markets?.length || 0,
    }));

    return NextResponse.json({
      mode,
      maxTotalMarkets,
      opinion: {
        count: opinionMarkets.length,
        totalTitles: allOpinionTitles.length,
        sample: opinionSample,
      },
      polymarket: {
        count: polyEvents.length,
        sample: polySample,
      },
      searchResults,
    });
  } catch (err) {
    console.error("[debug-markets] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
