import { opinionFetch } from "@/lib/opinion";

export const runtime = "nodejs";

export async function GET(_req, { params }) {
  try {
    const marketId = params?.marketId;
    if (!marketId) {
      return new Response(JSON.stringify({ errno: -1, errormsg: "missing_marketId", result: null }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Try binary endpoint first
    let payload = await opinionFetch(`/market/${marketId}`);
    const d = payload?.result?.data;

    // If it's categorical (marketType === 1) OR binary payload looks invalid, use categorical endpoint
    if (!d || typeof d !== "object" || d.marketType === 1) {
      const cat = await opinionFetch(`/market/categorical/${marketId}`);
      if (cat?.result?.data) payload = cat;
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ errno: -1, errormsg: "proxy_exception", result: null }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
