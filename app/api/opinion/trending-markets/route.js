import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

/**
 * GET /api/opinion/trending-markets
 * 
 * Returns top trending BINARY markets sorted by volume24h (sortBy=5)
 * 
 * NOTE: This endpoint only returns binary markets (marketType=0) because:
 * - Categorical parent markets (marketType=1) are NOT tradable directly
 * - Categorical child markets are fetched via /market/categorical/{id} and 
 *   don't have individual volume24h in the main market list
 * - For trending by volume, binary markets are the appropriate choice
 * 
 * Query params:
 * - limit: number of markets to return (default: 10, max: 50)
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  
  const limit = Math.min(Number(searchParams.get("limit") || "10"), 50);
  
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    
    // Helper to filter active markets
    const filterActive = (list) => {
      return (list || []).filter(m => {
        const statusNum = Number(m.status);
        if (statusNum >= 3 && statusNum !== 2) return false;
        if (m.resolvedAt && Number(m.resolvedAt) > 0) return false;
        if (m.cutoffAt && Number(m.cutoffAt) > 0 && Number(m.cutoffAt) <= nowSec) return false;
        return true;
      });
    };
    
    // Fetch only binary markets - they have real tradable volume24h
    const data = await opinionFetch("/market", {
      params: { 
        status: "activated", 
        sortBy: 5, // volume24h desc
        limit, 
        page: 1, 
        marketType: 0, // Binary only
      },
    });
    
    if (data?.errno !== 0) {
      return NextResponse.json({
        errno: data?.errno || -1,
        errormsg: data?.errormsg || "Failed to fetch trending markets",
        markets: [],
      });
    }
    
    const activeMarkets = filterActive(data?.result?.list);
    
    return NextResponse.json({
      errno: 0,
      markets: activeMarkets,
      total: activeMarkets.length,
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
