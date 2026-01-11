import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export async function GET(req) {
  const { searchParams } = new URL(req.url);

  const status = searchParams.get("status") || "activated";
  const sortBy = Number(searchParams.get("sortBy") || "5");
  const limit = Number(searchParams.get("limit") || "20");
  const marketType = Number(searchParams.get("marketType") || "2"); // 0=binary, 1=categorical, 2=all

  const data = await opinionFetch("/market", {
    params: { status, sortBy, limit, marketType },
  });

  return NextResponse.json(data);
}
