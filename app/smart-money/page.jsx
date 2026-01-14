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
        background: "rgba(255,255,255,.10)",
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-hidden="true"
    >
      {showImg ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
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
  return `${h}h ago`;
}

function fmtUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return x.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// tiny concurrency helper (avoid TPS spike)
async function runWithLimit(tasks, limit = 6) {
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const cur = idx++;
      try {
        await tasks[cur]();
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
}

export default function SmartMoneyPage() {
  const [minAmount, setMinAmount] = useState(200);
  const [rows, setRows] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState("1000");

  // ✅ restore Search by Market Title
  const [query, setQuery] = useState("");

  // ✅ cache thumbnailUrl by marketId
  const [thumbById, setThumbById] = useState(() => new Map());
  const inflightThumbRef = useRef(new Set()); // marketIds currently fetching
  const thumbTimerRef = useRef(null);

  const chips = useMemo(
    () => [
      { label: "200", value: 200 },
      { label: "500", value: 500 },
      { label: "1000", value: 1000 },
    ],
    []
  );

  useEffect(() => {
    setRows([]);
    const es = new EventSource(`/api/smart-money/stream?minAmount=${encodeURIComponent(minAmount)}`);

    es.addEventListener("snapshot", (e) => {
      try {
        const data = JSON.parse(e.data);
        setRows(data);
      } catch {}
    });

    es.addEventListener("trade", (e) => {
      try {
        const obj = JSON.parse(e.data);
        setRows((prev) => [obj, ...prev].slice(0, 200));
      } catch {}
    });

    es.onerror = () => {
      // EventSource auto-retry
    };

    return () => es.close();
  }, [minAmount]);

  // ✅ Enrich thumbnails for current rows (marketId -> /api/opinion/market/:id)
  useEffect(() => {
    if (!rows || rows.length === 0) return;

    if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);

    // debounce a bit so streaming doesn't spam
    thumbTimerRef.current = setTimeout(async () => {
      const need = [];
      for (const r of rows) {
        const id = r?.marketId;
        if (!id) continue;

        // if stream ever includes thumbnailUrl in future, cache it immediately
        const direct = r?.thumbnailUrl || r?.market?.thumbnailUrl;
        if (direct) {
          setThumbById((prev) => {
            if (prev.get(id) === direct) return prev;
            const next = new Map(prev);
            next.set(id, direct);
            return next;
          });
          continue;
        }

        if (thumbById.get(id)) continue;
        if (inflightThumbRef.current.has(id)) continue;

        inflightThumbRef.current.add(id);
        need.push(id);
      }

      if (need.length === 0) return;

      // limit batch size per wave
      const batch = need.slice(0, 60);

      const tasks = batch.map((id) => async () => {
        try {
          const res = await fetch(`/api/opinion/market/${encodeURIComponent(id)}`, { cache: "no-store" });
          const j = await res.json();
          const data = j?.result?.data || j?.result || j?.data || null;
          const url = data?.thumbnailUrl || data?.coverUrl || null;

          if (url) {
            setThumbById((prev) => {
              const next = new Map(prev);
              next.set(id, url);
              return next;
            });
          }
        } catch {
          // ignore
        } finally {
          inflightThumbRef.current.delete(id);
        }
      });

      await runWithLimit(tasks, 6);
    }, 250);

    return () => {
      if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // ✅ filter rows by market title (and marketId)
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const title = String(r?.marketTitle ?? "").toLowerCase();
      const id = String(r?.marketId ?? "");
      return title.includes(q) || id.includes(q);
    });
  }, [rows, query]);

  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div style={{ flex: 1, display: "flex", gap: 10 }}>
          {/* ✅ Search restored */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Market Title"
            style={{
              flex: 1,
              padding: "12px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.10)",
              background: "rgba(255,255,255,.03)",
              color: "#fff",
              outline: "none",
            }}
          />

          <div style={{ display: "flex", gap: 10 }}>
            {/* Top PNL (disabled / coming later) */}
            <button
              type="button"
              disabled
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.10)",
                background: "rgba(255,255,255,.02)",
                color: "rgba(255,255,255,.45)",
                cursor: "not-allowed",
                opacity: 0.75,
              }}
              title="Coming soon (API not available yet)"
            >
              Top PNL
            </button>

            {/* Volume (active/highlight) */}
            <button
              type="button"
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.14)",
                background: "rgba(255,255,255,.10)",
                color: "#fff",
                cursor: "default",
                fontWeight: 700,
              }}
              aria-current="true"
            >
              Volume
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ opacity: 0.75, fontSize: 12 }}>Min Trade Size</div>
          {chips.map((c) => (
            <button
              key={c.value}
              onClick={() => setMinAmount(c.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,.10)",
                background: minAmount === c.value ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.03)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              ${c.label}
            </button>
          ))}
          <button
            onClick={() => {
              setCustomVal(String(minAmount));
              setCustomOpen(true);
            }}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,.10)",
              background: "rgba(255,255,255,.03)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Edit
          </button>
        </div>
      </div>

      {/* table */}
      <div style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, overflow: "hidden" }}>
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
          <div>Trade</div>
          <div>Amount</div>
          <div>Market</div>
          <div>Outcome</div>
          <div>Price</div>
        </div>

        {filteredRows.length === 0 ? (
          <div style={{ padding: 14, opacity: 0.7 }}>{rows.length === 0 ? "Loading…" : "No results."}</div>
        ) : (
          filteredRows.map((r, i) => {
            const isSell = String(r.side).toLowerCase().includes("sell");
            const outcome = String(r.outcome || "").toUpperCase();
            const isNO = outcome === "NO";

            const thumbUrl = r?.thumbnailUrl || r?.market?.thumbnailUrl || (r?.marketId ? thumbById.get(r.marketId) : null);

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

                {/* ✅ Market cell: thumbnail 20px + title (ellipsis) */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <MarketThumbnailSM url={thumbUrl} size={20} />
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.marketTitle || r.marketId}
                  </div>
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

      {/* custom modal (simple) */}
      {customOpen && (
        <div
          onClick={() => setCustomOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.12)",
              background: "rgba(15,15,15,.95)",
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Set Min Trade Size</div>
            <input
              value={customVal}
              onChange={(e) => setCustomVal(e.target.value.replace(/[^\d]/g, ""))}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.10)",
                background: "rgba(255,255,255,.03)",
                color: "#fff",
              }}
              placeholder="e.g. 2500"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setCustomOpen(false)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,.10)",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const v = Math.max(1, Number(customVal || 1000));
                  setMinAmount(v);
                  setCustomOpen(false);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,.10)",
                  background: "rgba(255,255,255,.10)",
                  color: "#fff",
                  cursor: "pointer",
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
