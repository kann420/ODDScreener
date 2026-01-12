"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

export default function SmartMoneyPage() {
  const [minAmount, setMinAmount] = useState(1); // ✅ keep default = 1 (for your testing)
  const [rows, setRows] = useState([]);
  const [hubStatus, setHubStatus] = useState(null);
  const [statusTick, setStatusTick] = useState(0);
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState("1000");

  // ✅ Search by market title or marketId
  const [query, setQuery] = useState("");

  // ✅ Prevent SSE snapshot from overwriting DB history
  const historyLoadedRef = useRef(false);

  const chips = useMemo(
    () => [
      { label: "200", value: 200 },
      { label: "500", value: 500 },
      { label: "1000", value: 1000 },
    ],
    []
  );

  // ✅ 1) Load history from DB first (so user sees old trades immediately)
  useEffect(() => {
    let cancelled = false;
    historyLoadedRef.current = false; // reset when minAmount changes

    (async () => {
      try {
        const res = await fetch(
          `/api/smart-money/history?hours=24&minAmount=${encodeURIComponent(minAmount)}&limit=200`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled && Array.isArray(j?.rows)) {
          historyLoadedRef.current = true; // ✅ mark history loaded
          setRows(j.rows);
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
      // keep as-is; next run will reset historyLoadedRef anyway
    };
  }, [minAmount]);

  // ✅ 2) SSE stream: realtime updates (do NOT wipe history)
  useEffect(() => {
    const es = new EventSource(`/api/smart-money/stream?minAmount=${encodeURIComponent(minAmount)}`);

    es.addEventListener("snapshot", (e) => {
      try {
        const data = JSON.parse(e.data);

        // ✅ Once DB history has loaded, ignore snapshot completely
        // Snapshot is from in-memory hub.latest and can be empty/short after restart.
        if (historyLoadedRef.current) return;

        // ✅ Only use snapshot as fallback when history hasn't loaded yet
        if (Array.isArray(data) && data.length > 0) {
          setRows(data);
        }
      } catch {}
    });

    es.addEventListener("trade", (e) => {
      try {
        const obj = JSON.parse(e.data);
        setRows((prev) => {
          const next = [obj, ...(Array.isArray(prev) ? prev : [])];

          // optional de-dupe (avoid duplicates when history + live overlap)
          const seen = new Set();
          const deduped = [];
          for (const t of next) {
            const key = `${t.marketId}-${t.ts}-${t.side}-${t.amount}-${t.outcome}-${t.price}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(t);
            if (deduped.length >= 200) break;
          }
          return deduped;
        });
      } catch {}
    });

    es.onerror = () => {
      // EventSource auto-retry
    };

    return () => es.close();
  }, [minAmount]);

  // ✅ status poll (không ảnh hưởng hiển thị history)
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const res = await fetch("/api/smart-money/status", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (alive) setHubStatus(j);
      } catch {}
    };
    run();
    const id = setInterval(() => {
      setStatusTick((v) => v + 1);
    }, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/smart-money/status", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        setHubStatus(j);
      } catch {}
    })();
  }, [statusTick]);

  // ✅ Filter rows by market title OR marketId
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;

    const idMatch = q.match(/\b(\d{3,})\b/);
    const qId = idMatch ? idMatch[1] : null;

    return (rows || []).filter((r) => {
      const title = String(r?.marketTitle ?? "").toLowerCase();
      const id = String(r?.marketId ?? "");
      if (qId && id.includes(qId)) return true;
      return title.includes(q) || id.includes(q);
    });
  }, [rows, query]);

  return (
    <div style={{ padding: 18 }}>
      {/* Note line */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, opacity: 0.85 }}>
        <div style={{ fontSize: 12 }}>
          Note:
          <span style={{ marginLeft: 8, fontWeight: 800, color: hubStatus?.wsReady ? "#d06b35" : "#ffb020" }}>
            {hubStatus?.wsReady
              ? "Due to data limitations, this feature only displays trades made within the last 24 hours."
              : "Starting…"}
          </span>
        </div>
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
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.10)",
              background: "rgba(255,255,255,.03)",
              color: "#fff",
              outline: "none",
            }}
          />

          <div style={{ display: "flex", gap: 10 }}>
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
          <div style={{ padding: 14, opacity: 0.7 }}>
            {rows.length === 0
              ? "No whale trades yet…"
              : query.trim()
              ? "No trades match your search."
              : "No whale trades yet…"}
          </div>
        ) : (
          filteredRows.map((r, i) => (
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
                <span
                  style={{
                    color: String(r.side).toLowerCase().includes("sell") ? "#ff6b6b" : "#35d07f",
                    fontWeight: 800,
                  }}
                >
                  {String(r.side).toLowerCase().includes("sell") ? "Sell" : "Buy"}
                </span>
                <span style={{ opacity: 0.7, fontSize: 12 }}>{timeAgo(r.ts)}</span>
              </div>

              <div style={{ fontWeight: 800 }}>${fmtUsd(r.amount)}</div>

              <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.marketTitle || r.marketId}
              </div>

              <div>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 10,
                    background: "rgba(53,208,127,.15)",
                    color: "#35d07f",
                    fontWeight: 800,
                    fontSize: 12,
                  }}
                >
                  {r.outcome || "—"}
                </span>
              </div>

              <div style={{ opacity: 0.9 }}>{r.price || ""}</div>
            </div>
          ))
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
                outline: "none",
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
