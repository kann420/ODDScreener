import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 30 };

function googleNewsRssUrl(q) {
  const query = q && q.trim().length ? q.trim() : "Bitcoin OR Ethereum OR Solana OR gold";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function pickThumbnail(item) {
  const mc = item?.["media:content"];
  const mt = item?.["media:thumbnail"];

  const url1 = typeof mc === "object" ? mc?.["@_url"] : null;
  const url2 = typeof mt === "object" ? mt?.["@_url"] : null;

  return url1 || url2 || null;
}

function normalizeItems(rssItems) {
  const arr = Array.isArray(rssItems) ? rssItems : rssItems ? [rssItems] : [];
  return arr
    .map((it) => {
      const title = typeof it?.title === "string" ? it.title : "";
      const link = typeof it?.link === "string" ? it.link : "";
      const pubDate = it?.pubDate || it?.published || it?.updated || "";
      const source =
        typeof it?.source === "string"
          ? it.source
          : it?.source?.["#text"] || it?.source?.["__text"] || "";

      return {
        title,
        url: link,
        source: source || "Google News",
        publishedAt: pubDate,
        image: pickThumbnail(it),
      };
    })
    .filter((x) => x.title && x.url);
}

function dedup(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.url || it.title).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "news-hot",
    RATE_LIMIT_OPTS,
    "Too many hot news requests. Please slow down."
  );
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  try {
    const rssUrl = googleNewsRssUrl(q);

    const res = await fetch(rssUrl, {
      next: { revalidate: 300 }, // cache server 5 minutes
      headers: { "user-agent": "OddScreeners/1.0 (+https://oddscreeners.com)" },
    });

    if (!res.ok) return NextResponse.json({ items: [] }, { status: 200 });

    const xml = await res.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: false,
    });

    const parsed = parser.parse(xml);
    const channel = parsed?.rss?.channel;

    const items = normalizeItems(channel?.item);
    const cleaned = dedup(items).slice(0, 14); // trả nhiều hơn 4 để user bấm next

    return NextResponse.json({ items: cleaned }, { status: 200 });
  } catch (e) {
    console.error("[NewsHot] Failed to load news:", e?.message || e);
    return NextResponse.json({ items: [] }, { status: 200 });
  }
}
