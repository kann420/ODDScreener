"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function MarketThumbnailSM({ url, size = 20, radius = 5 }) {
  const [errored, setErrored] = useState(false);
  const showImg = Boolean(url) && !errored;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: "hidden",
        background: "rgba(255,255,255,.06)",
        border: "1px solid rgba(255,255,255,.08)",
        flex: "0 0 auto",
      }}
      title={url ? "Market thumbnail" : "No thumbnail"}
    >
      {showImg ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          onError={() => setErrored(true)}
        />
      ) : null}
    </div>
  );
}

function timeAgo(ts) {
  const t = Number(ts) || Date.now();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtUsd(n) {
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function sanitizePredictFunMarketTitle(title, platform) {
  const normalizedPlatform = String(platform || "").toLowerCase();
  const normalizedTitle = String(title || "").trim().replace(/\s+/g, " ");
  if (normalizedPlatform !== "predictfun" || !normalizedTitle) return normalizedTitle;

  const parts = normalizedTitle.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
    return [parts[0], ...parts.slice(2)].join(" - ");
  }

  return normalizedTitle;
}

function getPlatformLabel(platform) {
  return String(platform || "").toLowerCase() === "predictfun" ? "Predict.fun" : "Opinion";
}

function getTradeMeta(row) {
  const platform = String(row?.platform || "opinion").toLowerCase();
  const rawSide = String(row?.side || "").trim();

  if (platform === "predictfun") {
    const normalizedSide = rawSide.toLowerCase();
    const isBuy = normalizedSide === "buy" || normalizedSide === "bid";
    const isSell = normalizedSide === "sell" || normalizedSide === "ask";
    return {
      label: isBuy ? "Buy" : isSell ? "Sell" : (rawSide || "Match"),
      mobileLabel: isBuy ? "bought" : isSell ? "sold" : (rawSide ? `matched ${rawSide}` : "matched"),
      color: isBuy ? "#35d07f" : isSell ? "#ff6b6b" : "#5ab0ff",
      sortValue: isSell ? 1 : 0,
    };
  }

  const isSell = rawSide.toLowerCase().includes("sell");
  return {
    label: isSell ? "Sell" : "Buy",
    mobileLabel: isSell ? "sold" : "bought",
    color: isSell ? "#ff6b6b" : "#35d07f",
    sortValue: isSell ? 1 : 0,
  };
}

function getMarketHref(row) {
  const platform = String(row?.platform || "opinion").toLowerCase();
  if (platform === "predictfun") {
    return row?.marketId ? `/predictfun/market/${row.marketId}` : "/predictfun";
  }
  return row?.marketId ? `/market/${row.marketId}` : "#";
}

function getThumbUrl(row, thumbById) {
  return (
    row?.marketImageUrl ||
    row?.market?.thumbnailUrl ||
    row?.market?.coverUrl ||
    row?.thumbnailUrl ||
    (row?.marketId ? thumbById.get(Number(row.marketId)) : "")
  );
}

function SortIcon({ active, direction }) {
  if (!active) {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.4 }}
      >
        <path d="M7 15l5 5 5-5" />
        <path d="M7 9l5-5 5 5" />
      </svg>
    );
  }

  if (direction === "desc") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: "rgba(255,180,50,1)" }}
      >
        <path d="M12 5v14" />
        <path d="M19 12l-7 7-7-7" />
      </svg>
    );
  }

  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "rgba(255,180,50,1)" }}
    >
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

function PagerButton({ children, onClick, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 30,
        padding: "0 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,.12)",
        background: active ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.18)",
        color: "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: active ? 900 : 800,
        opacity: disabled ? 0.45 : 0.95,
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      {children}
    </button>
  );
}

export default function SmartMoneyPage() {
  const [platform, setPlatform] = useState("predictfun");
  const [minAmount, setMinAmount] = useState(1000);
  const [rows, setRows] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState("1000");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTrades, setTotalTrades] = useState(0);

  const thumbByIdRef = useRef(new Map());
  const pollRef = useRef(null);
  const PAGE_SIZE = 50;

  const toggleSort = (key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: "asc" };
    });
  };

  async function fetchThumb(marketId) {
    try {
      const res = await fetch(`/api/opinion/market/${marketId}`, { cache: "no-store" });
      const json = await res.json();
      const url = json?.result?.data?.thumbnailUrl || "";
      thumbByIdRef.current.set(Number(marketId), url);
      return url;
    } catch {
      thumbByIdRef.current.set(Number(marketId), "");
      return "";
    }
  }

  async function ensureThumbs(trades) {
    if (platform === "predictfun") return;

    const ids = new Set(
      (trades || [])
        .map((trade) => Number(trade?.marketId))
        .filter((value) => Number.isFinite(value) && value > 0)
    );

    const missing = [];
    ids.forEach((id) => {
      if (!thumbByIdRef.current.has(id)) missing.push(id);
    });

    for (const id of missing.slice(0, 25)) {
      // eslint-disable-next-line no-await-in-loop
      await fetchThumb(id);
    }
  }

  async function refresh({ targetPage = page } = {}) {
    try {
      const res = await fetch(
        `/api/smart-money/history?platform=${platform}&hours=24&minAmount=${minAmount}&page=${targetPage}&pageSize=${PAGE_SIZE}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      const data = json?.rows || [];

      setRows(data);
      setTotalPages(Number(json?.totalPages || 1));
      setTotalTrades(Number(json?.total || 0));

      await ensureThumbs(data);
    } catch {}
  }

  useEffect(() => {
    setPage(1);
    refresh({ targetPage: 1 });

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (page === 1) refresh({ targetPage: 1 });
    }, 12_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, minAmount]);

  useEffect(() => {
    refresh({ targetPage: page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query, sort.key, sort.dir]);

  const thumbById = thumbByIdRef.current;

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const title = sanitizePredictFunMarketTitle(row?.marketTitle, row?.platform).toLowerCase();
      const id = String(row?.marketId ?? "");
      return title.includes(q) || id.includes(q);
    });
  }, [rows, query]);

  const displayedRows = useMemo(() => {
    const arr = [...filteredRows];
    if (!sort.key) return arr;

    arr.sort((a, b) => {
      let av = 0;
      let bv = 0;

      if (sort.key === "trade") {
        av = getTradeMeta(a).sortValue;
        bv = getTradeMeta(b).sortValue;
      } else if (sort.key === "amount") {
        av = Number(a.amount || 0);
        bv = Number(b.amount || 0);
      } else if (sort.key === "outcome") {
        av = String(a.outcome || "").toLowerCase();
        bv = String(b.outcome || "").toLowerCase();
      }

      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return Number(b.ts || 0) - Number(a.ts || 0);
    });

    return arr;
  }, [filteredRows, sort]);

  const pageNums = useMemo(() => {
    const max = totalPages;
    const cur = page;
    const windowSize = 7;
    let start = Math.max(1, cur - Math.floor(windowSize / 2));
    let end = Math.min(max, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    const result = [];
    for (let i = start; i <= end; i++) result.push(i);
    return result;
  }, [page, totalPages]);

  const rangeText = useMemo(() => {
    if (totalTrades === 0) return "Showing 0 of 0 trades";
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, totalTrades);
    return `Showing ${from}-${to} of ${totalTrades} trades`;
  }, [page, totalTrades]);

  const noteText =
    platform === "predictfun"
      ? "Note: Last 24h trades only. Tracking recent smart flow (refreshed hourly)."
      : "Note: Last 24h trades only. Tracking recent smart flow (refreshed hourly).";

  return (
    <div style={{ padding: 18 }} className="smart-money-page">
      <div className="sm-note" style={{ opacity: 0.8, marginBottom: 10, fontSize: 13, color: "#f1c964" }}>
        {noteText}
      </div>

      <div
        className="sm-mobile-title"
        style={{ fontWeight: 700, fontSize: 30, marginBottom: 12, color: "rgba(255,255,255,0.9)" }}
      >
        Smart Money
      </div>

      <div className="sm-controls" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: 6,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,.1)",
            background: "rgba(0,0,0,.25)",
          }}
        >
          {["opinion", "predictfun"].map((value) => {
            const active = platform === value;
            return (
              <button
                key={value}
                onClick={() => setPlatform(value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,.08)",
                  background: active ? "rgba(255,255,255,.12)" : "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: active ? 900 : 700,
                }}
              >
                {getPlatformLabel(value)}
              </button>
            );
          })}
        </div>

        <div className="sm-search-box" style={{ flex: 1, display: "flex", gap: 10 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${getPlatformLabel(platform)} by Market Title`}
              className="sm-search-input"
              style={{
                width: "100%",
                padding: "12px 12px 12px 40px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.1)",
                background: "rgba(0,0,0,.25)",
                color: "#fff",
                outline: "none",
              }}
            />
          </div>
        </div>

        <div
          className="sm-min-trade-box"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,.1)",
            background: "rgba(0,0,0,.25)",
            flexWrap: "wrap",
          }}
        >
          <div className="sm-min-trade-label" style={{ opacity: 0.8, fontSize: 13 }}>
            Min Trade Size
          </div>

          {[1000, 5000, 10000].map((value) => (
            <button
              key={value}
              className={`sm-filter-btn ${minAmount === value ? "sm-filter-active" : ""}`}
              onClick={() => setMinAmount(value)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,.12)",
                background: minAmount === value ? "rgba(255,255,255,.12)" : "transparent",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              ${value.toLocaleString()}
            </button>
          ))}

          <button
            onClick={() => setCustomOpen(true)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,.12)",
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Edit
          </button>
        </div>
      </div>

      <div
        className="sm-pager-top"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div className="sm-range-text" style={{ opacity: 0.8, fontSize: 12 }}>
          {rangeText}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <PagerButton onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span style={{ marginLeft: 4 }}>Prev</span>
          </PagerButton>

          {pageNums[0] > 1 ? (
            <>
              <PagerButton onClick={() => setPage(1)} active={page === 1}>
                1
              </PagerButton>
              {pageNums[0] > 2 ? <span style={{ opacity: 0.6, fontSize: 12 }}>...</span> : null}
            </>
          ) : null}

          {pageNums.map((value) => (
            <PagerButton key={value} onClick={() => setPage(value)} active={value === page}>
              {value}
            </PagerButton>
          ))}

          {pageNums[pageNums.length - 1] < totalPages ? (
            <>
              {pageNums[pageNums.length - 1] < totalPages - 1 ? (
                <span style={{ opacity: 0.6, fontSize: 12 }}>...</span>
              ) : null}
              <PagerButton onClick={() => setPage(totalPages)} active={page === totalPages}>
                {totalPages}
              </PagerButton>
            </>
          ) : null}

          <PagerButton onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page === totalPages}>
            <span style={{ marginRight: 4 }}>Next</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </PagerButton>
        </div>
      </div>

      <div
        className="sm-desktop-table"
        style={{
          border: "1px solid rgba(255,255,255,.18)",
          borderRadius: 18,
          overflow: "hidden",
          background: "linear-gradient(180deg, rgba(19,24,31,0.88) 0%, rgba(12,16,22,0.9) 100%)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "var(--smart-money-desktop-grid-columns, 120px 140px minmax(0, 1fr) 140px 90px)",
            padding: "10px 12px",
            background: "rgba(255,255,255,.08)",
            fontSize: 12,
            color: "rgba(255,255,255,0.9)",
            fontWeight: 700,
          }}
        >
          {[
            { key: "trade", label: "Trade", sortable: true },
            { key: "amount", label: "Amount", sortable: true },
            { key: "market", label: "Market", sortable: false },
            { key: "outcome", label: "Outcome", sortable: true },
            { key: "price", label: "Price", sortable: false },
          ].map((column) => {
            if (!column.sortable) return <div key={column.key}>{column.label}</div>;
            const active = sort.key === column.key;
            return (
              <div
                key={column.key}
                onClick={() => toggleSort(column.key)}
                style={{
                  cursor: "pointer",
                  userSelect: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: active ? "rgba(255,180,50,1)" : undefined,
                  fontWeight: active ? 800 : undefined,
                }}
              >
                {column.label}
                <SortIcon active={active} direction={sort.dir} />
              </div>
            );
          })}
        </div>

        {displayedRows.length === 0 ? (
          <div style={{ padding: 14, opacity: 0.7 }}>{rows.length === 0 ? "Loading..." : "No results."}</div>
        ) : (
          displayedRows.map((row, index) => {
            const tradeMeta = getTradeMeta(row);
            const outcome = String(row.outcome || "").toUpperCase();
            const isNo = outcome.includes("NO");
            const thumbUrl = getThumbUrl(row, thumbById);
            const marketHref = getMarketHref(row);
            const displayMarketTitle = sanitizePredictFunMarketTitle(row.marketTitle, row.platform);

            return (
              <div
                key={`${row.platform}-${row.marketId}-${row.ts}-${index}`}
                className={`sm-row-desktop ${String(row.platform || "").toLowerCase() === "predictfun" ? "sm-row-predictfun" : ""}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "var(--smart-money-desktop-grid-columns, 120px 140px minmax(0, 1fr) 140px 90px)",
                  padding: "10px 12px",
                  borderTop: "1px solid rgba(255,255,255,.12)",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: tradeMeta.color, fontWeight: 800 }}>{tradeMeta.label}</span>
                  <span style={{ color: "rgba(255,255,255,0.82)", fontSize: 12, fontWeight: 600 }}>{timeAgo(row.ts)}</span>
                </div>

                <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.98)" }}>${fmtUsd(row.amount)}</div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <MarketThumbnailSM url={thumbUrl} size={20} />
                  <a
                    href={marketHref}
                    title="Open market detail"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                      overflow: "hidden",
                      textDecoration: "none",
                      color: "rgba(255,255,255,0.99)",
                      fontWeight: 800,
                    }}
                  >
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {displayMarketTitle || row.marketId}
                    </span>
                    <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center" }}>
                      {String(row.platform || "").toLowerCase() === "predictfun" ? (
                        <img src="/predictfun_logo.svg" alt="Predict.fun" width="14" height="14" style={{ display: "block" }} />
                      ) : (
                        <img src="/logo-opinion.svg" alt="Opinion" width="14" height="14" style={{ display: "block" }} />
                      )}
                    </span>
                    <svg
                      aria-hidden
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flex: "0 0 auto", opacity: 0.75 }}
                    >
                      <path d="M14 3h7v7" />
                      <path d="M10 14L21 3" />
                      <path d="M21 14v7h-7" />
                      <path d="M3 10V3h7" />
                    </svg>
                  </a>
                </div>

                <div>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 10,
                      background: isNo ? "rgba(239,68,68,.22)" : "rgba(53,208,127,.22)",
                      border: `1px solid ${isNo ? "rgba(239,68,68,.38)" : "rgba(53,208,127,.36)"}`,
                      color: isNo ? "#ff6b6b" : "#35d07f",
                      fontWeight: 800,
                      fontSize: 12,
                    }}
                  >
                    {outcome || "-"}
                  </span>
                </div>

                <div style={{ color: "rgba(255,255,255,0.95)", fontWeight: 600 }}>{row.price || ""}</div>
              </div>
            );
          })
        )}
      </div>

      <div className="sm-mobile-list">
        {displayedRows.length === 0 ? (
          <div style={{ padding: 14, opacity: 0.7, textAlign: "center" }}>{rows.length === 0 ? "Loading..." : "No results."}</div>
        ) : (
          displayedRows.map((row, index) => {
            const tradeMeta = getTradeMeta(row);
            const outcome = String(row.outcome || "").toUpperCase();
            const isNo = outcome.includes("NO");
            const thumbUrl = getThumbUrl(row, thumbById);
            const marketHref = getMarketHref(row);
            const displayMarketTitle = sanitizePredictFunMarketTitle(row.marketTitle, row.platform);

            return (
              <a
                key={`mobile-${row.platform}-${row.marketId}-${row.ts}-${index}`}
                href={marketHref}
                className="sm-mobile-card"
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="sm-mobile-card-top">
                  <MarketThumbnailSM url={thumbUrl} size={32} radius={8} />
                  <div className="sm-mobile-card-title">
                    {displayMarketTitle || `Market #${row.marketId}`}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                      {String(row.platform || "").toLowerCase() === "predictfun" ? (
                        <img src="/predictfun_logo.svg" alt="Predict.fun" width="12" height="12" style={{ display: "block" }} />
                      ) : (
                        <img src="/logo-opinion.svg" alt="Opinion" width="12" height="12" style={{ display: "block" }} />
                      )}
                    </div>
                  </div>
                  <div className="sm-mobile-card-time">
                    {timeAgo(row.ts)}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </div>
                </div>
                <div className="sm-mobile-card-bottom">
                  <span className="sm-mobile-verb" style={{ color: tradeMeta.color, fontWeight: 700 }}>
                    {tradeMeta.mobileLabel}
                  </span>{" "}
                  <span className="sm-mobile-outcome" style={{ color: isNo ? "#ff6b6b" : "#35d07f", fontWeight: 700 }}>
                    {outcome || "-"}
                  </span>
                  <span className="sm-mobile-at"> at </span>
                  <span className="sm-mobile-price">{row.price || "-"}</span>{" "}
                  <span className="sm-mobile-amount">(${fmtUsd(row.amount)})</span>
                </div>
              </a>
            );
          })
        )}
      </div>

      {displayedRows.length > 0 ? (
        <div className="sm-pager-bottom" style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <PagerButton onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span style={{ marginLeft: 4 }}>Prev</span>
            </PagerButton>
            <div style={{ opacity: 0.85, fontSize: 12 }}>
              Page <b>{page}</b> / {totalPages}
            </div>
            <PagerButton onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page === totalPages}>
              <span style={{ marginRight: 4 }}>Next</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </PagerButton>
          </div>
        </div>
      ) : null}

      {customOpen ? (
        <div
          onClick={() => setCustomOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 380,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,.12)",
              background: "rgba(10,14,18,.95)",
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Custom Min Trade Size</div>
            <input
              value={customVal}
              onChange={(event) => setCustomVal(event.target.value)}
              placeholder="e.g. 1500"
              style={{
                width: "100%",
                padding: "12px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.12)",
                background: "rgba(0,0,0,.25)",
                color: "#fff",
                outline: "none",
                marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setCustomOpen(false)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,.12)",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const nextValue = Math.max(0, Number(customVal || 0));
                  if (nextValue > 0) setMinAmount(nextValue);
                  setCustomOpen(false);
                }}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,.12)",
                  background: "rgba(255,255,255,.12)",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
