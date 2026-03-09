import Parser from "rss-parser";
import { enforceIpRateLimit } from "@/lib/apiRouteProtection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_OPTS = { windowMs: 60_000, maxRequests: 30 };

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
      ["enclosure", "enclosure"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

function pickRssImage(item) {
  const mc = item?.mediaContent;
  if (mc) {
    const arr = Array.isArray(mc) ? mc : [mc];
    const url = arr?.[0]?.$?.url || arr?.[0]?.url;
    if (url) return url;
  }

  const mt = item?.mediaThumbnail;
  if (mt) {
    const arr = Array.isArray(mt) ? mt : [mt];
    const url = arr?.[0]?.$?.url || arr?.[0]?.url;
    if (url) return url;
  }

  const enc = item?.enclosure;
  if (enc?.url) return enc.url;
  if (enc?.$?.url) return enc.$.url;

  const html = item?.contentEncoded || item?.content || "";
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m?.[1]) return m[1];

  return null;
}

function normalize(source, item) {
  return {
    source,
    title: item?.title || "",
    link: item?.link || "",
    publishedAt: item?.isoDate || item?.pubDate || "",
    image: pickRssImage(item),
  };
}

export async function GET(req) {
  const limited = enforceIpRateLimit(
    req,
    "news-feed",
    RATE_LIMIT_OPTS,
    "Too many news feed requests. Please slow down."
  );
  if (limited) return limited;

  // Optional: support q=... để lọc phía server theo title
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  const SOURCES = [
    { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
    { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  ];

  const all = [];

  for (const src of SOURCES) {
    try {
      const feed = await parser.parseURL(src.url);
      const items = (feed.items || []).map((it) => normalize(src.name, it));
      all.push(...items);
    } catch (e) {
      console.error("RSS error:", src.name, e?.message);
    }
  }

  let out = all
    .filter((x) => x.title && x.link)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // nếu có q thì lọc theo title (đơn giản, đủ dùng)
  if (q) {
    out = out.filter((x) => x.title.toLowerCase().includes(q));
  }

  // limit số lượng tin
  out = out.slice(0, 30);

  return Response.json(
    { items: out },
    {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}
