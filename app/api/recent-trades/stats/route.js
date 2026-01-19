import { NextResponse } from "next/server";
import { countRecentTrades, getRecentTradesDbPath } from "@/lib/recentTradesDb";
import fs from "fs";

export async function GET() {
  const dbPath = getRecentTradesDbPath();
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(dbPath).size;
  } catch {}

  return NextResponse.json({
    ok: true,
    dbPath,
    sizeBytes,
    count24h: countRecentTrades({ hours: 24 }),
  });
}
