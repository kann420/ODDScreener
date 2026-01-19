"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* =========================
   Smart Money Thumbnail (20px)
========================= */
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

export default function SmartMoneyPage() {
  const [minAmount, setMinAmount] = useState(200);
  const [rows, setRows] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState("1000");

  // ✅ restore Search by Market Title
  const [query, setQuery] = useState("");

  // ✅ Sorting (Trade / Amount / Outcome)
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  // ✅ Pagination (server-driven)
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTrades, setTotalTrades] = useState(0);

  const toggleSort = (key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      // cycle: asc -> desc -> none
      if (prev.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: "asc" };
    });
  };

  const sortIcon = (key) => {
    if (sort.key !== key) return "↕";
    return sort.dir === "asc" ? "↑" : "↓";
  };

  // marketId -> thumbnailUrl cache
  const thumbByIdRef = useRef(new Map());

  // keep a stable interval ref
  const pollRef = useRef(null);

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
    const ids = new Set(
      (trades || [])
        .map((t) => Number(t?.marketId))
        .filter((x) => Number.isFinite(x) && x > 0)
    );

    const missing = [];
    ids.forEach((id) => {
      if (!thumbByIdRef.current.has(id)) missing.push(id);
    });

    // Fetch sequentially to be gentle
    for (const id of missing.slice(0, 25)) {
      // eslint-disable-next-line no-await-in-loop
      await fetchThumb(id);
    }
  }

  async function refresh({ targetPage = page } = {}) {
    try {
      const res = await fetch(
        `/api/smart-money/history?hours=24&minAmount=${minAmount}&page=${targetPage}&pageSize=${PAGE_SIZE}`,
        { cache: "no-store" }
      );
      const json = await res.json();

      const data = json?.rows || [];
      setRows(data);

      // ✅ server tells us total pages (dynamic, not limited)
      setTotalPages(Number(json?.totalPages || 1));
      setTotalTrades(Number(json?.total || 0));

      await ensureThumbs(data);
    } catch {
      // ignore
    }
  }

  // initial + whenever minAmount changes => reset to page 1
  useEffect(() => {
    setPage(1);
    refresh({ targetPage: 1 });

    if (pollRef.current) clearInterval(pollRef.current);

    // ✅ auto-refresh only when user is on page 1 (realtime view)
    pollRef.current = setInterval(() => {
      if (page === 1) refresh({ targetPage: 1 });
    }, 12_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minAmount]);

  // When page changes, fetch that page (no waiting)
  useEffect(() => {
    refresh({ targetPage: page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const thumbById = thumbByIdRef.current;

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const title = String(r?.marketTitle ?? "").toLowerCase();
      const id = String(r?.marketId ?? "");
      return title.includes(q) || id.includes(q);
    });
  }, [rows, query]);

  const displayedRows = useMemo(() => {
    const arr = [...filteredRows];

    if (!sort.key) return arr;

    const normSide = (v) => {
      const s = String(v || "").toLowerCase();
      if (s.includes("sell")) return 1;
      if (s.includes("buy")) return 0;
      return 2;
    };

    const normOutcome = (v) => {
      const o = String(v || "").toLowerCase();
      if (o === "no" || o.includes("no")) return 1;
      if (o === "yes" || o.includes("yes")) return 0;
      return 2;
    };

    arr.sort((a, b) => {
      let av = 0;
      let bv = 0;

      if (sort.key === "trade") {
        av = normSide(a.side);
        bv = normSide(b.side);
      } else if (sort.key === "amount") {
        av = Number(a.amount || 0);
        bv = Number(b.amount || 0);
      } else if (sort.key === "outcome") {
        av = normOutcome(a.outcome);
        bv = normOutcome(b.outcome);
      }

      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;

      // tie-breaker: newest first
      return Number(b.ts || 0) - Number(a.ts || 0);
    });

    return arr;
  }, [filteredRows, sort]);

  // Keep page within bounds when totalPages changes
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [page, totalPages]);

  // Optional: when user changes query/sort, go back to page 1
  // (because search/sort applies only to current page rows)
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort.key, sort.dir]);

  // Page number window (compact around current)
  const pageNums = useMemo(() => {
    const max = totalPages;
    const cur = page;
    const windowSize = 7;
    let start = Math.max(1, cur - Math.floor(windowSize / 2));
    let end = Math.min(max, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    const arr = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }, [page, totalPages]);

  const rangeText = useMemo(() => {
    if (totalTrades === 0) return "Showing 0 of 0 trades";
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, totalTrades);
    return `Showing ${from}-${to} of ${totalTrades} trades`;
  }, [totalTrades, page, PAGE_SIZE]);

  const PagerButton = ({ children, onClick, disabled, active }) => (
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
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ padding: 18 }}>
      <div style={{ opacity: 0.8, marginBottom: 10, fontSize: 13, color: "#f1c964" }}>
        Note: Last 24h trades only. Tracking up to 100 markets with recent smart flow (refreshed hourly).
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div style={{ flex: 1, display: "flex", gap: 10 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Market Title"
            style={{
              flex: 1,
              padding: "12px 12px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.1)",
              background: "rgba(0,0,0,.25)",
              color: "#fff",
              outline: "none",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,.1)",
            background: "rgba(0,0,0,.25)",
          }}
        >
          <div style={{ opacity: 0.8, fontSize: 13 }}>Min Trade Size</div>

          <button
            onClick={() => setMinAmount(200)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,.12)",
              background: minAmount === 200 ? "rgba(255,255,255,.12)" : "transparent",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            $200
          </button>
          <button
            onClick={() => setMinAmount(500)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,.12)",
              background: minAmount === 500 ? "rgba(255,255,255,.12)" : "transparent",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            $500
          </button>
          <button
            onClick={() => setMinAmount(1000)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,.12)",
              background: minAmount === 1000 ? "rgba(255,255,255,.12)" : "transparent",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            $1000
          </button>

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

      {/* ✅ Pager (top) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ opacity: 0.8, fontSize: 12 }}>{rangeText}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <PagerButton onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            ← Prev
          </PagerButton>

          {pageNums[0] > 1 && (
            <>
              <PagerButton onClick={() => setPage(1)} active={page === 1}>
                1
              </PagerButton>
              {pageNums[0] > 2 && <span style={{ opacity: 0.6, fontSize: 12 }}>…</span>}
            </>
          )}

          {pageNums.map((p) => (
            <PagerButton key={p} onClick={() => setPage(p)} active={p === page}>
              {p}
            </PagerButton>
          ))}

          {pageNums[pageNums.length - 1] < totalPages && (
            <>
              {pageNums[pageNums.length - 1] < totalPages - 1 && (
                <span style={{ opacity: 0.6, fontSize: 12 }}>…</span>
              )}
              <PagerButton onClick={() => setPage(totalPages)} active={page === totalPages}>
                {totalPages}
              </PagerButton>
            </>
          )}

          <PagerButton onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            Next →
          </PagerButton>
        </div>
      </div>

      <div
        style={{
          border: "1px solid rgba(255,255,255,.08)",
          borderRadius: 18,
          overflow: "hidden",
          background: "rgba(0,0,0,.25)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "120px 140px 1fr 140px 90px",
            padding: "10px 12px",
            background: "rgba(255,255,255,.03)",
            fontSize: 12,
            opacity: 0.8,
          }}
        >
          <div
            onClick={() => toggleSort("trade")}
            style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 6 }}
            title="Sort by Trade (Buy/Sell)"
          >
            Trade <span style={{ opacity: 0.7 }}>{sortIcon("trade")}</span>
          </div>
          <div
            onClick={() => toggleSort("amount")}
            style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 6 }}
            title="Sort by Amount"
          >
            Amount <span style={{ opacity: 0.7 }}>{sortIcon("amount")}</span>
          </div>
          <div>Market</div>
          <div
            onClick={() => toggleSort("outcome")}
            style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 6 }}
            title="Sort by Outcome (YES/NO)"
          >
            Outcome <span style={{ opacity: 0.7 }}>{sortIcon("outcome")}</span>
          </div>
          <div>Price</div>
        </div>

        {displayedRows.length === 0 ? (
          <div style={{ padding: 14, opacity: 0.7 }}>{rows.length === 0 ? "Loading…" : "No results."}</div>
        ) : (
          displayedRows.map((r, i) => {
            const isSell = String(r.side).toLowerCase().includes("sell");
            const outcome = String(r.outcome || "").toUpperCase();
            const isNO = outcome.includes("NO");

            const thumbUrl =
              r?.market?.thumbnailUrl ||
              r?.market?.coverUrl ||
              r?.thumbnailUrl ||
              (r?.marketId ? thumbById.get(r.marketId) : "");

            return (
              <div
                key={`${r.marketId}-${r.ts}-${i}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 140px 1fr 140px 90px",
                  padding: "10px 12px",
                  borderTop: "1px solid rgba(255,255,255,.06)",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: isSell ? "#ff6b6b" : "#35d07f", fontWeight: 800 }}>
                    {isSell ? "Sell" : "Buy"}
                  </span>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>{timeAgo(r.ts)}</span>
                </div>

                <div style={{ fontWeight: 800 }}>${fmtUsd(r.amount)}</div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
  <MarketThumbnailSM url={thumbUrl} size={20} />

  <a
    href={`/market/${r.marketId}`}
    target="_blank"
    rel="noopener noreferrer"
    title="Open market in new tab"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      minWidth: 0,
      overflow: "hidden",
      textDecoration: "none",
      color: "rgba(255,255,255,.95)",
      fontWeight: 800,
      cursor: "pointer",
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
      {r.marketTitle || r.marketId}
    </span>

    {/* icon báo hiệu mở tab mới */}
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
  style={{
    flex: "0 0 auto",
    opacity: 0.75,
  }}
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
                      background: isNO ? "rgba(239,68,68,.15)" : "rgba(53,208,127,.15)",
                      color: isNO ? "#ff6b6b" : "#35d07f",
                      fontWeight: 800,
                      fontSize: 12,
                    }}
                  >
                    {outcome || "—"}
                  </span>
                </div>

                <div style={{ opacity: 0.9 }}>{r.price || ""}</div>
              </div>
            );
          })
        )}
      </div>

      {/* ✅ Pager (bottom) */}
      {displayedRows.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <PagerButton onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              ← Prev
            </PagerButton>
            <div style={{ opacity: 0.85, fontSize: 12 }}>
              Page <b>{page}</b> / {totalPages}
            </div>
            <PagerButton onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next →
            </PagerButton>
          </div>
        </div>
      )}

      {/* custom modal (simple) */}
      {customOpen && (
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
            onClick={(e) => e.stopPropagation()}
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
              onChange={(e) => setCustomVal(e.target.value)}
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
                  const v = Math.max(0, Number(customVal || 0));
                  if (v > 0) setMinAmount(v);
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
      )}
    </div>
  );
}
