import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export async function GET(req, { params }) {
  const marketId = params?.marketId;

  const r = await opinionFetch(`/market/${marketId}`);

  const ok =
    (typeof r?.errno === "number" && r.errno === 0) ||
    (typeof r?.code === "number" && r.code === 0);

  if (!ok) {
    return NextResponse.json(
      { errno: -1, errormsg: "market_detail_failed", result: null },
      { status: 200 }
    );
  }

  const data = r?.result?.data ?? r?.result ?? r;

  return NextResponse.json({ errno: 0, errormsg: "", result: { data } });
}
