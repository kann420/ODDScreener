import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token_id = searchParams.get("token_id");
  const limit = Number(searchParams.get("limit") || "200");

  if (!token_id) {
    return NextResponse.json({ errno: -1, errormsg: "missing_token_id", result: null }, { status: 200 });
  }

  let r = await opinionFetch("/token/trades", { params: { token_id, limit } });

  const ok =
    (typeof r?.errno === "number" && r.errno === 0) ||
    (typeof r?.code === "number" && r.code === 0);

  if (!ok) {
    const r2 = await opinionFetch("/token/trade", { params: { token_id, limit } });
    const ok2 =
      (typeof r2?.errno === "number" && r2.errno === 0) ||
      (typeof r2?.code === "number" && r2.code === 0);

    if (!ok2) {
      return NextResponse.json(
        { errno: -1, errormsg: "trades_failed", result: null },
        { status: 200 }
      );
    }

    r = r2;
  }

  const result = r?.result ?? r;
  return NextResponse.json({ errno: 0, errormsg: "", result }, { status: 200 });
}
