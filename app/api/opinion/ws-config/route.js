import { NextResponse } from "next/server";

// DEPRECATED: This endpoint is no longer needed.
// Trades are now proxied through SSE at /api/opinion/token/trades/stream
// This keeps the API key secure on the server side.
export async function GET() {
  return NextResponse.json({ 
    error: "This endpoint has been deprecated for security reasons. Use /api/opinion/token/trades/stream instead.",
    deprecated: true
  }, { status: 410 });
}
