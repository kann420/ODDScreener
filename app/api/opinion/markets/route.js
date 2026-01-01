// app/api/opinion/markets/route.js
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

  // log ra terminal để bạn chụp cho mình
  if (data?.code === -1) {
    console.error("[Opinion markets error]", data);
  }

  return NextResponse.json(data);
}
