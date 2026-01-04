import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.OPINION_API_KEY || "";
  
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }
  
  // Return only the WebSocket URL with API key embedded
  // This keeps the key on server-side but allows client to connect
  return NextResponse.json({ 
    wsUrl: `wss://ws.opinion.trade?apikey=${apiKey}` 
  });
}
