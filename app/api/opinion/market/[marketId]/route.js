import { NextResponse } from "next/server";
import { getMultiOutcomeMarkets } from "@/lib/opinionAnalytics";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const data = await getMultiOutcomeMarkets();

  if (!data.success) {
    return NextResponse.json({ 
      success: false, 
      error: data.error || { message: "Failed to fetch multi-outcome markets" } 
    });
  }

  return NextResponse.json({
    success: true,
    data: data.data,
    total: data.total,
  });
}
