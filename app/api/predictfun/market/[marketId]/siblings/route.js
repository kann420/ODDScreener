import { NextResponse } from "next/server";
import { getPredictFunSiblings } from "@/lib/predictfunDetail";

export async function GET(req, { params }) {
  const { marketId } = params;
  if (!marketId) {
    return NextResponse.json({ error: "missing marketId" }, { status: 400 });
  }

  try {
    const siblings = await getPredictFunSiblings(marketId);
    return NextResponse.json({ siblings }, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.error(`[PF Siblings] Error for ${marketId}:`, err?.message);
    return NextResponse.json({ error: err?.message || "siblings_fetch_failed" }, { status: 500 });
  }
}
