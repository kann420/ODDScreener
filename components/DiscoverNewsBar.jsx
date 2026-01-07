"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function toTimeAgo(dateStrOrMs) {
  const t = typeof dateStrOrMs === "number" ? dateStrOrMs : Date.parse(dateStrOrMs || "");
  if (!t || Number.isNaN(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function normalizeToken(s) {
  return String(s || "")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-zA-Z0-9$% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// MVP heuristic: build keyword pool based on high 24h volume markets (HOT-like)
function buildHotKeywordPool(markets, maxMarkets = 20) {
  if (!Array.isArray(markets) || markets.length === 0) return [];

  const sorted = [...markets].sort((a, b) => {
    const av = Number(a?.volume24h ?? a?.volume_24h ?? a?.volume24H ?? 0) || 0;
    const bv = Number(b?.volume24h ?? b?.volume_24h ?? b?.volume24H ?? 0) || 0;
    return bv - av;
  });

  const picked = sorted.slice(0, maxMarkets);

  const hardMap = [
    ["BTC", "Bitcoin"],
    ["ETH", "Ethereum"],
    ["SOL", "Solana"],
    ["ENA", "Ethena"],
    ["USDT", "USDT"],
    ["HYPE", "Hyperliquid"],
    ["GOLD", "gold"],
    ["FOMC", "FOMC"],
    ["FED", "Fed"],
    ["CPI", "CPI"],
    ["PCE", "PCE"],
  ];

  const hardSet = new Map(hardMap.map(([k, v]) => [k, v]));
  const freq = new Map();

  for (const m of picked) {
    const titleRaw = m?.title ?? m?.marketTitle ?? m?.market_title ?? "";
    const t = normalizeToken(titleRaw);

    const uppers = (t.match(/\b[A-Z]{2,6}\b/g) || []).slice(0, 30);
    for (const u of uppers) {
      if (hardSet.has(u)) {
        const kw = hardSet.get(u);
        freq.set(kw, (freq.get(kw) || 0) + 3);
      } else if (["ETF", "SEC", "FOMC", "CPI", "PCE", "GDP", "BOJ", "ECB"].includes(u)) {
        freq.set(u, (freq.get(u) || 0) + 2);
      }
    }

    const lower = t.toLowerCase();
    const phraseChecks = [
      ["bitcoin", "Bitcoin"],
      ["ethereum", "Ethereum"],
      ["solana", "Solana"],
      ["hyperliquid", "Hyperliquid"],
      ["ethena", "Ethena"],
      ["tether", "USDT"],
      ["gold", "gold"],
      ["federal reserve", "Fed"],
      ["interest rate", "rates"],
      ["rate cut", "rate cut"],
      ["inflation", "inflation"],
      ["cpi", "CPI"],
      ["fomc", "FOMC"],
    ];
    for (const [needle, kw] of phraseChecks) {
      if (lower.includes(needle)) freq.set(kw, (freq.get(kw) || 0) + 2);
    }
  }

  // ensure core topics exist
  for (const [, kw] of hardMap) freq.set(kw, (freq.get(kw) || 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .filter(Boolean)
    .slice(0, 18);
}

function buildQueryFromPool(pool) {
  // NOTE: /api/news hiện tại chỉ support q=... để lọc title đơn giản,
  // nên mình dùng dạng text gọn (không cần OR/quote phức tạp)
  const safe = (pool || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 6); // giới hạn cho gọn URL
  return safe.join(" ");
}

export default function DiscoverNewsBar({ initialMarkets = [] }) {
  const scrollerRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const keywordPool = useMemo(() => buildHotKeywordPool(initialMarkets, 20), [initialMarkets]);
  const query = useMemo(() => buildQueryFromPool(keywordPool), [keywordPool]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);

        // ✅ FIX: dùng /api/news (endpoint bạn đã làm và test OK)
        const url = `/api/news`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();

        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      } catch (e) {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const scrollByAmount = (dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.max(240, Math.floor(el.clientWidth * 0.75));
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  return (
    <div className="panel" style={{ padding: 12, position: "relative" }}>
      {/* arrows outside the panel */}
      <button
        type="button"
        aria-label="Previous news"
        onClick={() => scrollByAmount(-1)}
        style={{
          position: "absolute",
          left: -44,
          top: "50%",
          transform: "translateY(-50%)",
          width: 34,
          height: 34,
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,.12)",
          background: "rgba(0,0,0,.35)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        ‹
      </button>

      <button
        type="button"
        aria-label="Next news"
        onClick={() => scrollByAmount(1)}
        style={{
          position: "absolute",
          right: -44,
          top: "50%",
          transform: "translateY(-50%)",
          width: 34,
          height: 34,
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,.12)",
          background: "rgba(0,0,0,.35)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        ›
      </button>

      <div
        ref={scrollerRef}
        className="news-scroller"
        style={{
          display: "flex",
          gap: 10,
          overflowX: "hidden",
          scrollBehavior: "smooth",
        }}
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                minWidth: 280,
                maxWidth: 280,
                display: "flex",
                gap: 10,
                alignItems: "center",
                padding: 10,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.08)",
                background: "rgba(255,255,255,.03)",
              }}
            >
              <div className="skeleton" style={{ width: 46, height: 46, borderRadius: 12 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ height: 12, width: "92%", borderRadius: 8 }} />
                <div className="skeleton" style={{ height: 10, width: "70%", borderRadius: 8, marginTop: 8 }} />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="muted" style={{ padding: 8 }}>
            No news right now.
          </div>
        ) : (
          items.map((it, idx) => {
            const title = it?.title || "";
            const href = it?.url || it?.link || "#";
            const source = it?.source || "Source";
            const when = it?.publishedAt ? toTimeAgo(it.publishedAt) : "";
            const img = it?.image || null;

            return (
              <a
                key={`${href}-${idx}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={title}
                style={{
                  minWidth: 280,
                  maxWidth: 280,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,.08)",
                  background: "rgba(255,255,255,.03)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "rgba(255,255,255,.06)",
                    flex: "0 0 auto",
                  }}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      loading="lazy"
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%" }} />
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 12.5,
                      lineHeight: 1.2,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {title}
                  </div>

                  <div
                    className="muted"
                    style={{
                      fontSize: 11,
                      marginTop: 6,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {source}
                    {when ? ` · ${when}` : ""}
                  </div>
                </div>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}
