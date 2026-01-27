import { NextResponse } from "next/server";
import { fetchAllOpinionMarkets, fetchAllPolymarketEvents } from "@/lib/arbitageAutoMatcher";

export const dynamic = "force-dynamic";

/**
 * GET /api/arbitage/debug-markets
 * Debug endpoint to see what markets are being fetched from both exchanges
 */
export async function GET() {
  try {
    console.log("\n=== DEBUG: Fetching markets ===");
    
    // Fetch a small sample from both exchanges (more pages for Poly due to filtering)
    const [opinionMarkets, polyEvents] = await Promise.all([
      fetchAllOpinionMarkets({ limit: 20, maxPages: 1 }),
      fetchAllPolymarketEvents({ limit: 100, maxPages: 5 }),  // More pages since many get filtered
    ]);

    console.log(`Opinion markets: ${opinionMarkets.length}`);
    console.log(`Poly events: ${polyEvents.length}`);

    // Extract titles
    const opinionTitles = opinionMarkets.slice(0, 15).map((m) => ({
      id: m.marketId,
      title: m.marketTitle || m.tittle || m.title,
      type: m.isCategorical ? "categorical" : "binary",
    }));

    const polyTitles = polyEvents.slice(0, 15).map((e) => ({
      slug: e.slug,
      title: e.title,
      marketsCount: e.markets?.length || 0,
      marketTitles: (e.markets || []).slice(0, 3).map((m) => m.question || m.title),
    }));

    // Log to console
    console.log("\n--- Opinion Markets ---");
    opinionTitles.forEach((o, i) => console.log(`${i + 1}. [${o.type}] ${o.title}`));

    console.log("\n--- Polymarket Events ---");
    polyTitles.forEach((p, i) => {
      console.log(`${i + 1}. ${p.title}`);
      p.marketTitles.forEach((mt, j) => console.log(`   ${j + 1}. ${mt}`));
    });

    return NextResponse.json({
      opinion: {
        count: opinionMarkets.length,
        sample: opinionTitles,
      },
      polymarket: {
        count: polyEvents.length,
        sample: polyTitles,
      },
    });
  } catch (err) {
    console.error("[debug-markets] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
