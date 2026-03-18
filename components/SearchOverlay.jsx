"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OptimizedThumbnail } from "@/components/OptimizedImage";
import { getPredictFunDisplayTitleText } from "@/lib/predictfunDisplay";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtUsdCompact(v) {
  const n = num(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function fmtChance(p01) {
  if (!p01 || p01 <= 0) return "—";
  const pct = Math.max(0, Math.min(100, num(p01) * 100));
  const s = pct.toFixed(1).replace(/\.0$/, "");
  return `${s}%`;
}

/* ── Mini Thumbnail: reuse OptimizedThumbnail which handles static.predict.fun ── */

/* ── Mini Market Row ── */
function MiniRow({ market, platform, onClose }) {
  const isPF = platform === "predictfun";
  const id = isPF ? market?.id : market?.marketId;

  const title = isPF
    ? getPredictFunDisplayTitleText(market)
    : (market?.title || market?.marketTitle || market?.tittle || "");

  const imageUrl = isPF
    ? market?.imageUrl
    : (market?.thumbnailUrl || market?.logo || market?.icon || null);

  const vol24h = isPF
    ? num(market?.stats?.volume24hUsd)
    : num(market?.volume24h || market?.vol24h);

  const liqFromData = isPF ? num(market?.stats?.totalLiquidityUsd) : 0;

  const [chance, setChance] = useState(null);
  const [liq, setLiq] = useState(liqFromData > 0 ? liqFromData : null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !id) return;
    fetchedRef.current = true;

    if (isPF) {
      fetch(`/api/predictfun/market/${id}/last-sale`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.mid) setChance(d.mid);
          if (d?.totalLiquidity > 0 && !liqFromData) setLiq(d.totalLiquidity);
        })
        .catch(() => {});
    } else {
      fetch(`/api/opinion/market/${id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const det = d?.result || d;
          const ob = det?.orderbook;
          if (ob) {
            const bids = ob?.YES?.bids || ob?.yes?.bids || [];
            const asks = ob?.YES?.asks || ob?.yes?.asks || [];
            const bestBid = num(bids[0]?.price ?? bids[0]?.p);
            const bestAsk = num(asks[0]?.price ?? asks[0]?.p);
            let mid = 0;
            if (bestBid > 0 && bestAsk > 0) mid = (bestBid + bestAsk) / 2;
            else if (bestBid > 0) mid = bestBid;
            else if (bestAsk > 0) mid = bestAsk;
            if (mid > 0) setChance(mid > 1 ? mid / 100 : mid);
          }
          const detLiq = num(det?.liquidity || det?.totalLiquidity);
          if (detLiq > 0) setLiq(detLiq);
        })
        .catch(() => {});
    }
  }, [id, isPF, liqFromData]);

  const detailUrl = isPF ? `/predictfun/market/${id}` : `/market/${id}`;

  return (
    <Link
      href={detailUrl}
      prefetch={false}
      onClick={onClose}
      className="search-mini-row"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <OptimizedThumbnail url={imageUrl} size={32} radius={7} />
        <span className="search-mini-title">{title}</span>
      </div>
      <div className="mono" style={{ fontSize: 12, fontWeight: 700, textAlign: "right" }}>
        {chance ? fmtChance(chance) : "—"}
      </div>
      <div className="mono" style={{ fontSize: 11, textAlign: "right" }}>
        {fmtUsdCompact(vol24h)}
      </div>
      <div className="mono" style={{ fontSize: 11, textAlign: "right" }}>
        {liq ? fmtUsdCompact(liq) : "—"}
      </div>
    </Link>
  );
}

/* ══════════════════════════════════════════════════
   Search Overlay – triggered via sidebar icon
   ══════════════════════════════════════════════════ */
export default function SearchOverlay() {
  const router = useRouter();
  const inputRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState("predictfun");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Trending
  const [trendingPF, setTrendingPF] = useState([]);
  const [trendingOpinion, setTrendingOpinion] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const trendingFetchedRef = useRef(false);
  const searchTimerRef = useRef(null);

  /* ── Toggle via custom event from sidebar ── */
  useEffect(() => {
    const handler = (e) => {
      const plat = e.detail?.platform;
      if (plat) setPlatform(plat);
      setOpen((prev) => !prev);
    };
    window.addEventListener("toggle-search-overlay", handler);
    return () => window.removeEventListener("toggle-search-overlay", handler);
  }, []);

  /* ── ESC to close ── */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  /* ── Auto-focus input ── */
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  /* ── Lock body scroll ── */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  /* ── Fetch trending on first open ── */
  useEffect(() => {
    if (!open || trendingFetchedRef.current) return;
    trendingFetchedRef.current = true;
    setTrendingLoading(true);

    Promise.all([
      fetch("/api/predictfun/discover", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/opinion/trending-markets?limit=10", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([pf, op]) => {
      if (pf?.markets && Array.isArray(pf.markets)) {
        setTrendingPF(
          [...pf.markets]
            .sort((a, b) => num(b?.stats?.volume24hUsd) - num(a?.stats?.volume24hUsd))
            .slice(0, 10)
        );
      }
      if (op?.markets && Array.isArray(op.markets)) {
        setTrendingOpinion(
          op.markets.map((m) => ({
            ...m,
            title: m.title || m.marketTitle || m.tittle || "",
            volume24h: Number(m.volume24h || m.vol24h || 0),
          })).slice(0, 10)
        );
      }
      setTrendingLoading(false);
    });
  }, [open]);

  /* ── Helpers ── */
  const close = useCallback(() => setOpen(false), []);

  const doSearch = useCallback(async (q, plat) => {
    if (!q.trim()) { setResults([]); setHasSearched(false); return; }

    setSearching(true); setHasSearched(true);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}&platform=${plat}&type=market`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("fail");
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (val.trim().length >= 2) {
      searchTimerRef.current = setTimeout(() => doSearch(val, platform), 400);
    } else {
      setResults([]); setHasSearched(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    doSearch(query, platform);
  };

  const handlePlatformChange = (plat) => {
    setPlatform(plat);
    setResults([]); setHasSearched(false);
    if (query.trim().length >= 2) {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => doSearch(query, plat), 300);
    }
  };

  const trending = platform === "predictfun" ? trendingPF : trendingOpinion;
  const showTrending = !hasSearched && !query.trim();
  const displayList = hasSearched ? results : trending;
  const platformLabel = platform === "predictfun" ? "Predict.fun" : "Opinion";

  if (!open) return null;

  const platBtnBase = {
    padding: "5px 12px", borderRadius: 7, border: "1px solid",
    cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "all 0.2s",
    display: "flex", alignItems: "center", gap: 6, lineHeight: 1.2,
  };

  return (
    <div className="search-overlay-backdrop" onClick={close}>
      <div className="search-overlay-panel" onClick={(e) => e.stopPropagation()}>

        {/* ── Top Row: Platform Toggles ── */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 6 }}>
            <button
              onClick={() => handlePlatformChange("predictfun")}
              style={{
                ...platBtnBase,
                borderColor: platform === "predictfun" ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.10)",
                background: platform === "predictfun" ? "rgba(139,92,246,0.14)" : "transparent",
                color: platform === "predictfun" ? "#A78BFA" : "rgba(255,255,255,0.55)",
              }}
            >
              <img src="/predictfun_logo.svg" alt="" width={15} height={15} style={{ display: "block" }} />
              Predict.fun
            </button>
            <button
              onClick={() => handlePlatformChange("opinion")}
              style={{
                ...platBtnBase,
                borderColor: platform === "opinion" ? "rgba(255,136,0,0.5)" : "rgba(255,255,255,0.10)",
                background: platform === "opinion" ? "rgba(255,136,0,0.12)" : "transparent",
                color: platform === "opinion" ? "#ff8800" : "rgba(255,255,255,0.55)",
              }}
            >
              <img src="/2logo-opinion.webp" alt="" width={15} height={15} style={{ display: "block", borderRadius: 3 }} />
              Opinion
            </button>
        </div>

        {/* ── Search Input ── */}
        <form onSubmit={handleSubmit} style={{ position: "relative", marginBottom: 10 }}>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", pointerEvents: "none" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder={`Search ${platformLabel} markets...`}
            className="search-overlay-input"
            style={{
              width: "100%", padding: "10px 36px 10px 38px",
              borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)", color: "#fff",
              outline: "none", fontSize: 13, fontWeight: 500, boxSizing: "border-box",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setResults([]); setHasSearched(false); inputRef.current?.focus(); }}
              style={{
                position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                background: "rgba(255,255,255,0.08)", border: "none", color: "rgba(255,255,255,0.45)",
                cursor: "pointer", borderRadius: 4, width: 22, height: 22,
                display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
              }}
              aria-label="Clear"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </form>

        {/* ── Status / Trending Label ── */}
        {hasSearched && !searching && (
          <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>
            {results.length} result{results.length !== 1 ? "s" : ""} found
          </div>
        )}
        {searching && (
          <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>
            Searching...
          </div>
        )}
        {showTrending && !trendingLoading && trending.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#00ff88" }}>
              <polyline points="23,6 13.5,15.5 8.5,10.5 1,18" />
              <polyline points="17,6 23,6 23,12" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#00ff88" }}>Top 10 Trending</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>by 24h Vol · {platformLabel}</span>
          </div>
        )}

        {/* ── Column Header ── */}
        <div className="search-col-header">
          <div>Market</div>
          <div style={{ textAlign: "right" }}>Chance</div>
          <div style={{ textAlign: "right" }}>Volume (24h)</div>
          <div style={{ textAlign: "right" }}>Liquidity</div>
        </div>

        {/* ── Results / Trending List ── */}
        <div className="search-overlay-list">
          {trendingLoading && showTrending ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 42, borderRadius: 8 }} />
              ))}
            </div>
          ) : displayList.length === 0 && hasSearched && !searching ? (
            <div className="muted" style={{ textAlign: "center", padding: 24, fontSize: 12 }}>
              No markets found. Try a different term.
            </div>
          ) : (
            displayList.map((m, i) => (
              <MiniRow
                key={(platform === "predictfun" ? m.id : m.marketId) || i}
                market={m}
                platform={platform}
                onClose={close}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
