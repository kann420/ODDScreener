import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";

export async function GET(req) {
  const { searchParams } = new URL(req.url);

  const status = searchParams.get("status") || "activated";
  const sortBy = Number(searchParams.get("sortBy") || "5");
  const limit = Number(searchParams.get("limit") || "20");

  const data = await opinionFetch("/market", {
    params: { status, sortBy, limit },
  });

  return NextResponse.json(data);
}
