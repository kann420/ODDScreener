"use client";

/**
 * PredictFun Wallet Tracker Page
 *
 * Route: /wallet/predictfun/[wallet]
 *
 * Displays wallet profile with:
 * - Header with account info (name, avatar from PredictFun) and stats
 * - Tabs: Positions and Activity
 * - Data fetched from Predict.fun API via our proxy routes
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  isValidWalletAddress,
  shortenAddress,
  formatUSD,
  formatUSDSigned,
  formatCents,
  formatShares,
  formatPercentSigned,
  formatCompact,
  timeAgo,
  num,
} from "@/lib/walletTracker/format";

/* ─── Shared small components ─── */

function TabButton({ active, onClick, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        background: "none",
        border: "none",
        padding: "14px 24px",
        fontSize: 15,
        fontWeight: 600,
        color: active ? "#fff" : hovered ? "#fff" : "rgba(255,255,255,0.5)",
        cursor: "pointer",
        position: "relative",
        transition: "color 0.15s",
        borderBottom: active ? "2px solid #8b5cf6" : "2px solid transparent",
        marginBottom: -1,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

function Skeleton({ width, height, borderRadius = 4 }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background:
          "linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s infinite",
      }}
    />
  );
}

function ErrorState({ message, onRetry }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 20px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
      <div
        style={{
          color: "rgba(255,255,255,0.5)",
          fontSize: 14,
          maxWidth: 400,
          marginBottom: 20,
        }}
      >
        {message}
      </div>
      {onRetry && (
        <button
          style={{
            background: hovered
              ? "rgba(255,255,255,0.08)"
              : "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "10px 24px",
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onClick={onRetry}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          Try again
        </button>
      )}
    </div>
  );
}

/* ─── Navigation Bar ─── */
function NavigationBar({ onBack, onRefresh, isRefreshing }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
      }}
    >
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "8px 14px",
          color: "rgba(255,255,255,0.7)",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.1)";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "rgba(255,255,255,0.7)";
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5" />
          <polyline points="12,19 5,12 12,5" />
        </svg>
        Back
      </button>

      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "8px 14px",
          color: isRefreshing
            ? "rgba(255,255,255,0.4)"
            : "rgba(255,255,255,0.7)",
          fontSize: 13,
          fontWeight: 500,
          cursor: isRefreshing ? "not-allowed" : "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!isRefreshing) {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "#fff";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = isRefreshing
            ? "rgba(255,255,255,0.4)"
            : "rgba(255,255,255,0.7)";
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            animation: isRefreshing ? "spin 1s linear infinite" : "none",
          }}
        >
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );
}

/* ─── Info Tooltip ─── */
function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <div
      style={{ position: "relative", display: "inline-flex", cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
        style={{ color: "rgba(255,255,255,0.5)", transition: "color 0.2s", cursor: "pointer" }}
        onMouseEnter={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.9)"}
        onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.5)"}
      >
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15"/>
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="12" cy="8" r="1.2" fill="currentColor"/>
        <line x1="12" y1="11" x2="12" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      {show && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)", background: "rgba(20,22,28,0.98)",
          border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
          padding: "10px 12px", fontSize: 12, color: "rgba(255,255,255,0.85)",
          lineHeight: 1.5, width: 260, whiteSpace: "pre-wrap", zIndex: 100,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          {text}
          <div style={{
            position: "absolute", bottom: -6, left: "50%",
            transform: "translateX(-50%) rotate(45deg)", width: 10, height: 10,
            background: "rgba(20,22,28,0.98)",
            borderRight: "1px solid rgba(255,255,255,0.15)",
            borderBottom: "1px solid rgba(255,255,255,0.15)",
          }} />
        </div>
      )}
    </div>
  );
}

/* ─── PnL Sparkline ─── */
function PFPnLSparkline({ data, width = 220, height = 60, isLoading = false }) {
  const gradientId = useMemo(() => "pf-pnl-grad-" + Math.random().toString(36).slice(2), []);
  const { pathD, areaD, isPositive } = useMemo(() => {
    if (!data || data.length === 0) return { pathD: "", areaD: "", isPositive: true };
    const values = data.map(d => d.pnl);
    if (values.length === 1) values.push(values[0]);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;
    const effectiveRange = range === 0 ? 1 : range;
    const points = values.map((v, i) => ({
      x: (i / (values.length - 1)) * width,
      y: range === 0 ? height / 2 : height - 8 - ((v - minVal) / effectiveRange) * (height - 16),
    }));
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaPath = linePath + ` L ${width},${height} L 0,${height} Z`;
    return { pathD: linePath, areaD: areaPath, isPositive: values[values.length - 1] >= 0 };
  }, [data, width, height]);

  if (isLoading) return <Skeleton width={width} height={height} borderRadius={8} />;
  const color = isPositive ? "#22c55e" : "#ef4444";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {areaD && <path d={areaD} fill={`url(#${gradientId})`} />}
      {pathD && <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/* ─── Period Button ─── */
function PeriodButton({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "rgba(255,255,255,0.12)" : "transparent",
      border: "none", color: active ? "#fff" : "rgba(255,255,255,0.5)",
      fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 6,
      cursor: "pointer", transition: "all 0.15s",
    }}>
      {label}
    </button>
  );
}

/* ─── Weekly Volume helper (Tue 14:00 UTC cycle) ─── */
function getWeekBoundary(date) {
  const d = new Date(date);
  d.setUTCHours(14, 0, 0, 0);
  while (d.getUTCDay() !== 2 || d > date) {
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(14, 0, 0, 0);
  }
  return d.getTime();
}

function computeWeeklyVolume(trades) {
  if (!trades || !trades.length) return 0;
  const now = new Date();
  const weekStart = getWeekBoundary(now);
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;

  let vol = 0;
  for (const t of trades) {
    const ts = t.executedAtMs || (t.createdAt ? t.createdAt * 1000 : 0);
    if (ts >= weekStart && ts <= weekEnd) {
      vol += Math.abs(num(t.usdAmount || t.amount));
    }
  }
  return vol;
}

/* ─── Distribute a GraphQL total proportionally by weekly points share ───
 * Points on Predict.fun are derived from volume, so points proportion
 * is the best available proxy for volume share per week.
 * Works for all weeks regardless of how many trades the client fetched.
 */
function distributeByPointsShare(weeklyPointsHistory, totalValue) {
  if (!weeklyPointsHistory || !weeklyPointsHistory.length || totalValue == null) return {};
  const totalPts = weeklyPointsHistory.reduce((s, w) => s + Number(w.totalPoints || 0), 0);
  if (!totalPts) return {};
  const result = {};
  for (const w of weeklyPointsHistory) {
    const pts = Number(w.totalPoints || 0);
    if (pts > 0) {
      result[w.week] = (pts / totalPts) * totalValue;
    }
  }
  return result;
}

/* ─── Compute total fees paid ─── */
function computeTotalFees(trades) {
  if (!trades || !trades.length) return 0;
  let totalFees = 0;
  for (const t of trades) {
    totalFees += num(t.fee || 0);
  }
  return totalFees;
}

/* ─── Compute PnL by period
 * ALL = realizedPnlTotal from GraphQL (accurate).
 * Sub-periods = proportional to volume share (rough approximation).
 * Sparkline tracks cumulative volume progress scaled to final PnL.
 */
function computePnLByPeriod(trades, realizedPnlTotal) {
  if (!trades || !trades.length || realizedPnlTotal == null) {
    return { "1D": [], "1W": [], "1M": [], ALL: [] };
  }

  const now = Date.now();
  const cutoffs = {
    "1D": now - 1 * 24 * 60 * 60 * 1000,
    "1W": now - 7 * 24 * 60 * 60 * 1000,
    "1M": now - 30 * 24 * 60 * 60 * 1000,
    ALL: 0,
  };

  const sorted = [...trades].sort((a, b) => {
    const ta = a.executedAtMs || (a.createdAt ? a.createdAt * 1000 : 0);
    const tb = b.executedAtMs || (b.createdAt ? b.createdAt * 1000 : 0);
    return ta - tb;
  });

  const volAll = sorted.reduce((s, t) => s + Math.abs(num(t.usdAmount || t.amount)), 0);
  if (!volAll) return { "1D": [], "1W": [], "1M": [], ALL: [] };

  const result = {};
  for (const [period, cutoff] of Object.entries(cutoffs)) {
    const filtered = sorted.filter((t) => {
      const ts = t.executedAtMs || (t.createdAt ? t.createdAt * 1000 : 0);
      return ts >= cutoff;
    });
    if (!filtered.length) { result[period] = []; continue; }

    const volPeriod = filtered.reduce((s, t) => s + Math.abs(num(t.usdAmount || t.amount)), 0);
    // ALL uses exact realizedPnl; sub-periods scale proportionally
    const periodPnL = period === "ALL"
      ? realizedPnlTotal
      : realizedPnlTotal * (volPeriod / volAll);

    // Day-by-day cumulative, scaled to periodPnL at the end
    const daily = new Map();
    for (const t of filtered) {
      const ts = t.executedAtMs || (t.createdAt ? t.createdAt * 1000 : 0);
      const day = new Date(ts).toISOString().split("T")[0];
      daily.set(day, (daily.get(day) || 0) + Math.abs(num(t.usdAmount || t.amount)));
    }

    const days = [...daily.keys()].sort();
    let cumVol = 0;
    result[period] = days.map((d) => {
      cumVol += daily.get(d);
      return { day: d, pnl: volPeriod > 0 ? (cumVol / volPeriod) * periodPnL : 0 };
    });
  }
  return result;
}

/* ─── PredictFun Wallet Header ─── */
function PFWalletHeader({ wallet, account, stats, trades, isLoading }) {
  const [selectedPeriod, setSelectedPeriod] = useState("1W");
  const displayName = account?.name || shortenAddress(wallet);
  const avatarUrl = account?.imageUrl || null;
  const avatarText = wallet ? wallet.slice(2, 4).toUpperCase() : "??";
  const pfProfileUrl = `https://predict.fun/portfolio/${wallet}`;

  const weeklyVolume = useMemo(() => computeWeeklyVolume(trades), [trades]);
  const totalFeesPaid = useMemo(() => computeTotalFees(trades), [trades]);
  const pnlByPeriod = useMemo(() => computePnLByPeriod(trades, stats?.realizedPnl), [trades, stats?.realizedPnl]);
  const currentPnLData = useMemo(() => pnlByPeriod[selectedPeriod] || [], [pnlByPeriod, selectedPeriod]);
  const chartPnL = useMemo(() => {
    if (!currentPnLData.length) return 0;
    return currentPnLData[currentPnLData.length - 1]?.pnl || 0;
  }, [currentPnLData]);
  const isPositive = chartPnL >= 0;
  const periodLabels = { "1D": "Past Day", "1W": "Past Week", "1M": "Past Month", ALL: "All Time" };

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(30,32,40,0.95) 0%, rgba(20,22,28,0.98) 100%)",
        border: "1px solid rgba(139,92,246,0.2)",
        borderRadius: 16,
        padding: "24px 28px",
        display: "flex",
        gap: 24,
        alignItems: "stretch",
        flexWrap: "wrap",
      }}
    >
      {/* Left: Profile + Stats */}
      <div style={{ flex: 1, minWidth: 300 }}>
        {/* Profile Row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} style={{
              width: 52, height: 52, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
              boxShadow: "0 4px 12px rgba(139, 92, 246, 0.3)", border: "2px solid rgba(139,92,246,0.5)",
            }} onError={(e) => { e.target.style.display = "none"; }} />
          ) : (
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #3b82f6 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 700, color: "#fff", flexShrink: 0,
              boxShadow: "0 4px 12px rgba(139, 92, 246, 0.3)",
            }}>
              {avatarText}
            </div>
          )}

          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: account?.name ? "#a78bfa" : "#fff", letterSpacing: "0.5px" }}>
                {displayName}
              </span>
              <span style={{
                background: "linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(167,139,250,0.15) 100%)",
                color: "#a78bfa", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.5px",
              }}>
                PREDICT.FUN
              </span>
              <a href={pfProfileUrl} target="_blank" rel="noopener noreferrer" title="View on Predict.fun"
                style={{ color: "rgba(255,255,255,0.4)", transition: "color 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#8b5cf6")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15,3 21,3 21,9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
            {account?.name && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>
                {shortenAddress(wallet, 6, 4)}
              </div>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="pf-stats-row" style={{
          display: "flex", gap: 24, paddingTop: 16,
          borderTop: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap",
        }}>
          <div className="pf-hstat-posval">
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Positions Value</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={90} height={24} /> : formatUSD(stats?.positionsValue || 0)}
            </div>
          </div>
          <div className="pf-hstat-right">
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Unrealized PnL</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: (stats?.totalPnl || 0) >= 0 ? "#22c55e" : "#ef4444" }}>
              {isLoading ? <Skeleton width={80} height={24} /> : formatUSDSigned(stats?.totalPnl || 0)}
            </div>
          </div>
          <div className="pf-hstat-3 pf-hstat-positions">
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Positions</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={50} height={24} /> : String(stats?.positionsCount || 0)}
            </div>
          </div>
          <div className="pf-hstat-3 pf-hstat-trades">
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Total Trades</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={50} height={24} /> : String(stats?.tradesCount || 0)}
            </div>
          </div>
          <div className="pf-hstat-3 pf-hstat-feepaid pf-hstat-right">
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Fee Paid</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={70} height={24} /> : formatUSD(totalFeesPaid)}
            </div>
          </div>
          <div className="pf-hstat-totvol">
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Total Volume</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={70} height={24} /> : formatUSD(stats?.volume || 0)}
            </div>
          </div>
          <div className="pf-hstat-right pf-hstat-weeklyvol" style={{ position: "relative" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <span>Weekly Volume</span>
              <InfoTooltip text="Weekly Volume is calculated from 14:00 UTC last Tuesday → 14:00 UTC this Tuesday." />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              {isLoading ? <Skeleton width={70} height={24} /> : formatUSD(weeklyVolume)}
            </div>
          </div>
          <div className="pf-hstat-right pf-hstat-points">
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Points</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              {isLoading ? (
                <Skeleton width={70} height={24} />
              ) : (
                Math.abs(stats?.points || 0) >= 10000
                  ? formatCompact(stats?.points || 0)
                  : Number(stats?.points || 0).toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    })
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
          .pf-hstat-3 { /* no change on desktop */ }
        @media (max-width: 768px) {
          .pf-stats-row {
            display: grid !important;
            grid-template-columns: 1fr 1fr;
            gap: 16px 0;
          }
          .pf-hstat-trades {
            display: none;
          }
          .pf-hstat-right {
            padding-left: 28px;
          }
          /* Explicit order: row1=1,2 | row2=3,4 | row3=5,6 | row4=7 */
          .pf-hstat-posval    { order: 1; }
          .pf-hstat-right:not(.pf-hstat-feepaid):not(.pf-hstat-weeklyvol) { order: 2; }
          .pf-hstat-totvol    { order: 3; }
          .pf-hstat-weeklyvol { order: 4; }
          .pf-hstat-positions { order: 5; }
          .pf-hstat-feepaid   { order: 6; }
          .pf-hstat-points    { order: 7; }
          :global(.pf-hstat-right > div:last-child) {
            font-size: 22px !important;
          }
          :global(.pf-hstat-right > div:first-child) {
            font-size: 13px !important;
          }
        }
      `}</style>

      {/* Divider */}
      <div style={{ width: 1, background: "rgba(255,255,255,0.08)", alignSelf: "stretch" }} />

      {/* Right: PnL Chart */}
      <div style={{ minWidth: 280, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: isPositive ? "#22c55e" : "#ef4444", fontSize: 12 }}>
              {isPositive ? "\u25B2" : "\u25BC"}
            </span>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 500 }}>Profit/Loss</span>
          </div>
          <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.05)", padding: 2, borderRadius: 8 }}>
            {["1D", "1W", "1M", "ALL"].map((p) => (
              <PeriodButton key={p} label={p} active={selectedPeriod === p} onClick={() => setSelectedPeriod(p)} />
            ))}
          </div>
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, color: isPositive ? "#22c55e" : "#ef4444", lineHeight: 1.1, marginBottom: 4 }}>
          {isLoading ? <Skeleton width={120} height={40} /> : formatUSDSigned(chartPnL)}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
          {periodLabels[selectedPeriod]}
        </div>
        <div style={{ marginTop: "auto" }}>
          <PFPnLSparkline data={currentPnLData} width={260} height={55} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}

/* ─── Position Row (Desktop) ─── */
function PositionRowDesktop({ position }) {
  const [hovered, setHovered] = useState(false);
  const avgPrice = num(position.avgEntryPrice);
  const currentPrice = num(position.currentPrice || position.avgEntryPrice);
  const value = num(position.currentValueInQuoteToken);
  const pnl = num(position.unrealizedPnl);
  const pnlPercent = num(position.unrealizedPnlPercent);
  const isPositive = pnl >= 0;
  const outcomeDisplay = position.outcome || position.outcomeSideEnum || "Yes";
  const isYes = position.outcomeSide === 1;
  const marketImage = position.thumbnailUrl || position.imageUrl || null;
  const displayTitle = position.displayTitle || position.marketTitle || "Unknown";

  return (
    <div
      className="pf-position-row"
      style={{ background: hovered ? "rgba(139,92,246,0.04)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="pf-market-cell">
        <div
          className="pf-icon"
          style={{
            background: marketImage
              ? "transparent"
              : "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
          }}
        >
          {marketImage ? (
            <img
              src={marketImage}
              alt=""
              className="pf-icon-img"
              onError={(e) => {
                e.target.style.display = "none";
                e.target.parentElement.style.background =
                  "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)";
                e.target.parentElement.textContent =
                  displayTitle?.charAt(0) || "?";
              }}
            />
          ) : (
            displayTitle?.charAt(0) || "?"
          )}
        </div>
        <div className="pf-info">
          <div className="pf-title" title={displayTitle}>
            {displayTitle}
          </div>
          <div className="pf-meta">
            <span className={`pf-badge-${isYes ? "yes" : "no"}`}>
              {outcomeDisplay}
            </span>
            <span className="pf-shares">
              {formatShares(position.sharesOwned)} at {formatCents(avgPrice)}
            </span>
          </div>
        </div>
      </div>
      <div className="pf-price">{formatCents(avgPrice)}</div>
      <div className="pf-price">{formatCents(currentPrice)}</div>
      <div className="pf-value">
        <div className="pf-value-amount">{formatUSD(value)}</div>
        <div className={`pf-pnl ${isPositive ? "positive" : "negative"}`}>
          {formatUSDSigned(pnl)} ({formatPercentSigned(pnlPercent)})
        </div>
      </div>
    </div>
  );
}

/* ─── Position Card (Mobile) ─── */
function PositionCardMobile({ position }) {
  const avgPrice = num(position.avgEntryPrice);
  const value = num(position.currentValueInQuoteToken);
  const pnl = num(position.unrealizedPnl);
  const pnlPercent = num(position.unrealizedPnlPercent);
  const isPositive = pnl >= 0;
  const outcomeDisplay = position.outcome || position.outcomeSideEnum || "Yes";
  const isYes = position.outcomeSide === 1;
  const marketImage = position.thumbnailUrl || position.imageUrl || null;
  const displayTitle = position.displayTitle || position.marketTitle || "Unknown";

  return (
    <div className="pf-card-mobile">
      <div className="pf-card-row">
        <div
          className="pf-icon"
          style={{
            width: 44,
            height: 44,
            background: marketImage
              ? "transparent"
              : "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
          }}
        >
          {marketImage ? (
            <img
              src={marketImage}
              alt=""
              className="pf-icon-img"
              onError={(e) => {
                e.target.style.display = "none";
                e.target.parentElement.style.background =
                  "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)";
                e.target.parentElement.textContent =
                  displayTitle?.charAt(0) || "?";
              }}
            />
          ) : (
            displayTitle?.charAt(0) || "?"
          )}
        </div>
        <div className="pf-card-info">
          <div className="pf-card-title">{displayTitle}</div>
          <div className="pf-card-meta">
            <span className={`pf-badge-${isYes ? "yes" : "no"}`}>
              {outcomeDisplay}
            </span>
            <span className="pf-shares-m">
              {formatShares(position.sharesOwned)} at {formatCents(avgPrice)}
            </span>
          </div>
        </div>
        <div className="pf-card-value">
          <div className="pf-value-amount">{formatUSD(value)}</div>
          <div className={`pf-pnl ${isPositive ? "positive" : "negative"}`}>
            {formatUSDSigned(pnl)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Activity Row (Desktop) ─── */
function ActivityRowDesktop({ trade }) {
  const [hovered, setHovered] = useState(false);
  const price = num(trade.price);
  const shares = num(trade.shares);
  const amount = num(trade.usdAmount || trade.amount);
  const outcomeDisplay = trade.outcome || trade.outcomeSideEnum || "Yes";
  const isYes = trade.outcomeSide === 1;
  const sideUpper = (trade.side || "").toUpperCase();
  const isBuy = sideUpper === "BUY";
  const badgeClass = isBuy ? "buy" : "sell";
  const badgeLabel = isBuy ? "Buy" : "Sell";
  const marketImage = trade.thumbnailUrl || null;
  const displayTitle = trade.displayTitle || trade.marketTitle || "Unknown";
  const createdAtDate = trade.executedAtMs
    ? new Date(trade.executedAtMs)
    : trade.createdAt
    ? new Date(trade.createdAt * 1000)
    : null;
  const txHash = trade.txHash;
  const txUrl = txHash
    ? `https://bscscan.com/tx/${txHash}`
    : null;

  return (
    <div
      className="pf-activity-row"
      style={{ background: hovered ? "rgba(139,92,246,0.04)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div>
        <span className={`pf-trade-badge-${badgeClass}`}>{badgeLabel}</span>
      </div>
      <div className="pf-market-cell">
        <div
          className="pf-icon"
          style={{
            background: marketImage
              ? "transparent"
              : "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
          }}
        >
          {marketImage ? (
            <img
              src={marketImage}
              alt=""
              className="pf-icon-img"
              onError={(e) => {
                e.target.style.display = "none";
                e.target.parentElement.style.background =
                  "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)";
                e.target.parentElement.textContent =
                  displayTitle?.charAt(0) || "?";
              }}
            />
          ) : (
            displayTitle?.charAt(0) || "?"
          )}
        </div>
        <div className="pf-info">
          <div className="pf-title" title={displayTitle}>
            {displayTitle}
          </div>
          <div className="pf-meta">
            <span className={`pf-badge-${isYes ? "yes" : "no"}`}>
              {outcomeDisplay}
            </span>
            <span className="pf-shares">
              {formatCents(price)} · {formatShares(shares)}
            </span>
          </div>
        </div>
      </div>
      <div className="pf-activity-amount">
        <div className="pf-value-amount">{formatUSD(amount)}</div>
        <div className="pf-time">{createdAtDate ? timeAgo(createdAtDate) : ""}</div>
      </div>
      {txUrl ? (
        <a
          href={txUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="pf-tx-link"
          title="View on BaseScan"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15,3 21,3 21,9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      ) : (
        <div style={{ width: 32 }} />
      )}
    </div>
  );
}

/* ─── Activity Card (Mobile) ─── */
function ActivityCardMobile({ trade }) {
  const price = num(trade.price);
  const shares = num(trade.shares);
  const amount = num(trade.usdAmount || trade.amount);
  const outcomeDisplay = trade.outcome || trade.outcomeSideEnum || "Yes";
  const isYes = trade.outcomeSide === 1;
  const sideUpper = (trade.side || "").toUpperCase();
  const isBuy = sideUpper === "BUY";
  const badgeClass = isBuy ? "buy" : "sell";
  const badgeLabel = isBuy ? "Buy" : "Sell";
  const marketImage = trade.thumbnailUrl || null;
  const displayTitle = trade.displayTitle || trade.marketTitle || "Unknown";
  const createdAtDate = trade.executedAtMs
    ? new Date(trade.executedAtMs)
    : trade.createdAt
    ? new Date(trade.createdAt * 1000)
    : null;

  return (
    <div className="pf-card-mobile">
      <div className="pf-card-row">
        <div
          className="pf-icon"
          style={{
            width: 44,
            height: 44,
            background: marketImage
              ? "transparent"
              : "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
          }}
        >
          {marketImage ? (
            <img
              src={marketImage}
              alt=""
              className="pf-icon-img"
              onError={(e) => {
                e.target.style.display = "none";
                e.target.parentElement.style.background =
                  "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)";
                e.target.parentElement.textContent =
                  displayTitle?.charAt(0) || "?";
              }}
            />
          ) : (
            displayTitle?.charAt(0) || "?"
          )}
        </div>
        <div className="pf-card-info">
          <div className="pf-card-title">{displayTitle}</div>
          <div className="pf-card-meta">
            <span className={`pf-trade-badge-${badgeClass}`}>{badgeLabel}</span>
            <span className={`pf-badge-${isYes ? "yes" : "no"}`}>
              {outcomeDisplay}
            </span>
          </div>
        </div>
        <div className="pf-card-value">
          <div className="pf-value-amount">{formatUSD(amount)}</div>
          <div className="pf-time">{createdAtDate ? timeAgo(createdAtDate) : ""}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Search Input ─── */
function SearchInput({ value, onChange, placeholder }) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "rgba(255, 255, 255, 0.03)",
        border: focused
          ? "1px solid rgba(139,92,246,0.3)"
          : "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: "10px 14px",
        flex: 1,
        maxWidth: 320,
        transition: "border-color 0.15s",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          background: "none",
          border: "none",
          outline: "none",
          color: "#fff",
          fontSize: 13,
          width: "100%",
        }}
      />
    </div>
  );
}

/* ─── Main Page ─── */
export default function PredictFunWalletPage() {
  const params = useParams();
  const router = useRouter();
  const wallet = params?.wallet || "";

  const [activeTab, setActiveTab] = useState("positions");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [positionsSortBy, setPositionsSortBy] = useState("value"); // "value" or "-value"

  // Data state
  const [positions, setPositions] = useState([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [positionsError, setPositionsError] = useState(null);

  const [trades, setTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesError, setTradesError] = useState(null);

  // Points state
  const [weeklyPoints, setWeeklyPoints] = useState([]);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState(null);
  const [pointsFetched, setPointsFetched] = useState(false);

  // Account info from PredictFun
  const [account, setAccount] = useState(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 900);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Fetch positions
  const fetchPositions = useCallback(async () => {
    if (!isValidWalletAddress(wallet)) return;
    setPositionsLoading(true);
    setPositionsError(null);
    try {
      const res = await fetch(`/api/predictfun/wallet/${wallet}/positions`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to fetch positions");
      setPositions(data.positions || []);
      if (data.account) setAccount((prev) => prev || data.account);
    } catch (err) {
      console.error("[PFWallet] Positions error:", err);
      setPositionsError(err.message);
    } finally {
      setPositionsLoading(false);
    }
  }, [wallet]);

  // Fetch trades
  const fetchTrades = useCallback(async () => {
    if (!isValidWalletAddress(wallet)) return;
    setTradesLoading(true);
    setTradesError(null);
    try {
      const first = 200;
      const maxPages = 5;
      let cursor = null;
      const allTrades = [];
      const seen = new Set();

      for (let page = 0; page < maxPages; page += 1) {
        const params = new URLSearchParams({ first: String(first) });
        if (cursor) params.set("after", cursor);

        const res = await fetch(
          `/api/predictfun/wallet/${wallet}/trades?${params.toString()}`
        );
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to fetch trades");

        if (data.account) setAccount((prev) => prev || data.account);

        const batch = Array.isArray(data.trades) ? data.trades : [];
        for (const trade of batch) {
          const dedupeKey = [
            trade?.txHash || "",
            trade?.createdAt || "",
            trade?.marketId || "",
            trade?.outcome || "",
            trade?.side || "",
            trade?.shares || "",
          ].join(":");
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          allTrades.push(trade);
        }

        cursor = data.cursor || null;
        if (!cursor || batch.length < first) break;
      }

      setTrades(allTrades);
    } catch (err) {
      console.error("[PFWallet] Trades error:", err);
      setTradesError(err.message);
    } finally {
      setTradesLoading(false);
    }
  }, [wallet]);

  // Fetch points
  const fetchPoints = useCallback(async () => {
    if (!isValidWalletAddress(wallet)) return;
    setPointsLoading(true);
    setPointsError(null);
    try {
      const res = await fetch(`/api/predictfun/wallet/${wallet}/points`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to fetch points");
      setWeeklyPoints(data.weeklyPointsHistory || []);
      setPointsFetched(true);
    } catch (err) {
      console.error("[PFWallet] Points error:", err);
      setPointsError(err.message);
    } finally {
      setPointsLoading(false);
    }
  }, [wallet]);

  // Initial load
  useEffect(() => {
    if (isValidWalletAddress(wallet)) {
      fetchPositions();
      fetchTrades();
    }
  }, [wallet, fetchPositions, fetchTrades]);

  // Fetch points when tab is first opened
  useEffect(() => {
    if (activeTab === "points" && !pointsFetched && !pointsLoading) {
      fetchPoints();
    }
  }, [activeTab, pointsFetched, pointsLoading, fetchPoints]);

  // Stats – merge client-side position data with GraphQL account statistics
  const stats = useMemo(() => {
    let positionsValue = 0;
    let totalPnl = 0;
    for (const p of positions) {
      positionsValue += num(p.currentValueInQuoteToken);
      totalPnl += num(p.unrealizedPnl);
    }
    const gql = account?.statistics || {};
    return {
      positionsValue: gql.positionsValueUsd ?? positionsValue,
      totalPnl,
      realizedPnl: gql.pnlUsd ?? null,
      volume: gql.volumeUsd ?? null,
      positionsCount: positions.length,
      tradesCount: trades.length,
      points: Number(account?.points ?? account?.leaderboard?.totalPoints ?? 0),
    };
  }, [positions, trades, account]);

  // Filtered positions
  const displayPositions = useMemo(() => {
    if (!positions) return [];
    let filtered = positions;
    if (searchQuery?.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = positions.filter((p) =>
        (p.displayTitle || p.marketTitle || "").toLowerCase().includes(q)
      );
    }
    // Sort by value (ascending or descending based on positionsSortBy)
    const isDescending = positionsSortBy === "value";
    return [...filtered].sort((a, b) => {
      const aVal = num(a.currentValueInQuoteToken);
      const bVal = num(b.currentValueInQuoteToken);
      return isDescending ? bVal - aVal : aVal - bVal;
    });
  }, [positions, searchQuery, positionsSortBy]);

  // Filtered trades
  const displayTrades = useMemo(() => {
    if (!trades) return [];
    if (!searchQuery?.trim()) return trades;
    const q = searchQuery.toLowerCase();
    return trades.filter((t) =>
      (t.displayTitle || t.marketTitle || "").toLowerCase().includes(q)
    );
  }, [trades, searchQuery]);

  const handleBack = useCallback(() => {
    router.replace("/wallet?tab=predictfun");
  }, [router]);

  // Weekly volumes & PnL for points tab (distributed by points share from GraphQL)
  const weeklyVolumes = useMemo(
    () => distributeByPointsShare(weeklyPoints, stats?.volume),
    [weeklyPoints, stats?.volume]
  );
  const weeklyPnLs = useMemo(
    () => distributeByPointsShare(weeklyPoints, stats?.realizedPnl),
    [weeklyPoints, stats?.realizedPnl]
  );

  // Merged points + volume + pnl rows, sorted desc by week
  const pointsRows = useMemo(() => {
    if (!weeklyPoints || !weeklyPoints.length) return [];
    return [...weeklyPoints]
      .sort((a, b) => (b.week || 0) - (a.week || 0))
      .map((wp) => ({
        week: wp.week,
        points: Number(wp.totalPoints || 0),
        referralPoints: Number(wp.referralPoints || 0),
        volume: weeklyVolumes[wp.week] || 0,
        pnl: weeklyPnLs[wp.week] || 0,
        calculated: wp.calculated,
      }));
  }, [weeklyPoints, weeklyVolumes, weeklyPnLs]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const tasks = [fetchPositions(), fetchTrades()];
      if (pointsFetched) {
        setPointsFetched(false);
        tasks.push(fetchPoints());
      }
      await Promise.all(tasks);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, fetchPositions, fetchTrades, fetchPoints, pointsFetched]);

  if (!isValidWalletAddress(wallet)) {
    return (
      <div className="container">
        <ErrorState message={`Invalid wallet address: "${wallet}"`} />
      </div>
    );
  }

  const isDataLoading = positionsLoading || tradesLoading;

  return (
    <div className="container wallet-container">
      <div className="wallet-page-wrapper">
        <NavigationBar
          onBack={handleBack}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />

        {/* Header */}
        <PFWalletHeader
          wallet={wallet}
          account={account}
          stats={stats}
          trades={trades}
          isLoading={isDataLoading}
        />

        {/* Main Tabs */}
        <div style={{ marginBottom: 20, marginTop: 20 }}>
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <TabButton
              active={activeTab === "positions"}
              onClick={() => setActiveTab("positions")}
            >
              Positions ({positions.length})
            </TabButton>
            <TabButton
              active={activeTab === "activity"}
              onClick={() => setActiveTab("activity")}
            >
              Activity ({trades.length})
            </TabButton>
            <TabButton
              active={activeTab === "points"}
              onClick={() => setActiveTab("points")}
            >
              Points
            </TabButton>
          </div>
        </div>

        {/* Search (hidden on points tab) */}
        {activeTab !== "points" && (
          <div style={{ marginBottom: 16 }}>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search markets..."
            />
          </div>
        )}

        {/* Positions Tab */}
        {activeTab === "positions" && (
          <div>
            {positionsError ? (
              <ErrorState message={positionsError} onRetry={fetchPositions} />
            ) : (
              <>
                {/* Desktop Table */}
                <div className="pf-table-desktop">
                  <div className="pf-table-header">
                    <div>MARKET</div>
                    <div style={{ textAlign: "center" }}>AVG</div>
                    <div style={{ textAlign: "center" }}>CURRENT</div>
                    <div
                      suppressHydrationWarning
                      style={{
                        textAlign: "right",
                        cursor: "pointer",
                        userSelect: "none",
                        display: "flex",
                        justifyContent: "flex-end",
                        alignItems: "center",
                        gap: 6,
                      }}
                      onClick={() =>
                        setPositionsSortBy(
                          positionsSortBy === "value" ? "-value" : "value"
                        )
                      }
                    >
                      VALUE
                      <span style={{ fontSize: 12, opacity: 0.7 }}>
                        {positionsSortBy === "value" ? "↓" : "↑"}
                      </span>
                    </div>
                  </div>
                  <div className="pf-table-body">
                    {positionsLoading ? (
                      <>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div key={i} className="pf-position-row">
                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                              <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ width: "70%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 6 }} />
                                <div style={{ width: "50%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
                              </div>
                            </div>
                            <div style={{ width: 40, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", margin: "0 auto" }} />
                            <div style={{ width: 40, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", margin: "0 auto" }} />
                            <div style={{ width: 70, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
                          </div>
                        ))}
                      </>
                    ) : displayPositions.length > 0 ? (
                      displayPositions.map((p, idx) => (
                        <PositionRowDesktop
                          key={`${p.marketId}-${p.outcomeSide}-${idx}`}
                          position={p}
                        />
                      ))
                    ) : (
                      <div className="pf-empty">
                        {searchQuery
                          ? "No positions match your search"
                          : "No active positions found"}
                      </div>
                    )}
                  </div>
                </div>

                {/* Mobile Cards */}
                <div className="pf-mobile-list">
                  {positionsLoading ? (
                    <>
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="pf-card-mobile">
                          <div style={{ display: "flex", gap: 12 }}>
                            <div style={{ width: 44, height: 44, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ width: "80%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 8 }} />
                              <div style={{ width: "60%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : displayPositions.length > 0 ? (
                    displayPositions.map((p, idx) => (
                      <PositionCardMobile
                        key={`m-${p.marketId}-${p.outcomeSide}-${idx}`}
                        position={p}
                      />
                    ))
                  ) : (
                    <div className="pf-empty">
                      {searchQuery
                        ? "No positions match your search"
                        : "No active positions found"}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === "activity" && (
          <div>
            {tradesError ? (
              <ErrorState message={tradesError} onRetry={fetchTrades} />
            ) : (
              <>
                {/* Desktop */}
                <div className="pf-table-desktop">
                  <div className="pf-activity-header">
                    <div>TYPE</div>
                    <div>MARKET</div>
                    <div style={{ textAlign: "right" }}>AMOUNT</div>
                    <div></div>
                  </div>
                  <div className="pf-table-body">
                    {tradesLoading ? (
                      <>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div key={i} className="pf-activity-row">
                            <div style={{ width: 40, height: 24, borderRadius: 6, background: "rgba(255,255,255,0.06)" }} />
                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                              <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ width: "60%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
                              </div>
                            </div>
                            <div style={{ width: 70, height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
                            <div style={{ width: 32 }} />
                          </div>
                        ))}
                      </>
                    ) : displayTrades.length > 0 ? (
                      displayTrades.map((t, idx) => (
                        <ActivityRowDesktop
                          key={`${t.txHash}-${idx}`}
                          trade={t}
                        />
                      ))
                    ) : (
                      <div className="pf-empty">No trade activity found</div>
                    )}
                  </div>
                </div>

                {/* Mobile */}
                <div className="pf-mobile-list">
                  {tradesLoading ? (
                    <>
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="pf-card-mobile">
                          <div style={{ display: "flex", gap: 12 }}>
                            <div style={{ width: 44, height: 44, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ width: "80%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 8 }} />
                              <div style={{ width: "60%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : displayTrades.length > 0 ? (
                    displayTrades.map((t, idx) => (
                      <ActivityCardMobile
                        key={`m-${t.txHash}-${idx}`}
                        trade={t}
                      />
                    ))
                  ) : (
                    <div className="pf-empty">No trade activity found</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Points Tab */}
        {activeTab === "points" && (
          <div>
            {pointsError ? (
              <ErrorState message={pointsError} onRetry={fetchPoints} />
            ) : (
              <>
                {/* Desktop */}
                <div className="pf-table-desktop">
                  <div className="pf-points-header">
                    <div>WEEK</div>
                    <div style={{ textAlign: "right" }}>PNL</div>
                    <div style={{ textAlign: "right" }}>VOLUME</div>
                    <div style={{ textAlign: "right" }}>POINTS</div>
                  </div>
                  <div className="pf-table-body">
                    {pointsLoading ? (
                      <>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div key={i} className="pf-points-row">
                            <div style={{ width: 80, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
                            <div style={{ width: 80, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
                            <div style={{ width: 90, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
                            <div style={{ width: 70, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginLeft: "auto" }} />
                          </div>
                        ))}
                      </>
                    ) : pointsRows.length > 0 ? (
                      pointsRows.map((row) => (
                        <div key={row.week} className="pf-points-row">
                          <div className="pf-points-week">
                            <span className="pf-points-week-label">Week {row.week}</span>
                            {!row.calculated && (
                              <span className="pf-points-pending">ongoing</span>
                            )}
                          </div>
                          <div className={`pf-points-pnl ${row.pnl >= 0 ? "positive" : "negative"}`}>{formatUSDSigned(row.pnl)}</div>
                          <div className="pf-points-volume">{formatUSD(row.volume)}</div>
                          <div className="pf-points-value">
                            {row.points >= 10000
                              ? formatCompact(row.points)
                              : Number(row.points).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="pf-empty">No points history found</div>
                    )}
                  </div>
                </div>

                {/* Mobile */}
                <div className="pf-mobile-list">
                  {pointsLoading ? (
                    <>
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="pf-card-mobile" style={{ padding: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <div style={{ width: 80, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
                            <div style={{ width: 70, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
                          </div>
                        </div>
                      ))}
                    </>
                  ) : pointsRows.length > 0 ? (
                    pointsRows.map((row) => (
                      <div key={row.week} className="pf-card-mobile" style={{ padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
                              Week {row.week}
                              {!row.calculated && (
                                <span style={{
                                  fontSize: 10, fontWeight: 500, color: "#f59e0b",
                                  background: "rgba(245,158,11,0.15)", padding: "2px 6px",
                                  borderRadius: 4, marginLeft: 8,
                                }}>ongoing</span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                              PnL: <span style={{ color: row.pnl >= 0 ? "#22c55e" : "#ef4444" }}>{formatUSDSigned(row.pnl)}</span>
                              {" · "}
                              Vol: {formatUSD(row.volume)}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "#a78bfa" }}>
                              {row.points >= 10000
                                ? formatCompact(row.points)
                                : Number(row.points).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>points</div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="pf-empty">No points history found</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        /* Desktop Table */
        .pf-points-header {
          display: grid;
          grid-template-columns: 1fr 120px 140px 140px;
          gap: 16px;
          padding: 12px 20px;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 11px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        :global(.pf-points-row) {
          display: grid;
          grid-template-columns: 1fr 120px 140px 140px;
          gap: 16px;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          align-items: center;
          transition: background 0.15s;
        }
        :global(.pf-points-row:hover) {
          background: rgba(139, 92, 246, 0.04);
        }
        :global(.pf-points-week) {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        :global(.pf-points-week-label) {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }
        :global(.pf-points-pending) {
          font-size: 10px;
          font-weight: 500;
          color: #f59e0b;
          background: rgba(245, 158, 11, 0.15);
          padding: 2px 6px;
          border-radius: 4px;
        }
        :global(.pf-points-pnl) {
          font-size: 14px;
          font-weight: 600;
          text-align: right;
        }
        :global(.pf-points-pnl.positive) {
          color: #22c55e;
        }
        :global(.pf-points-pnl.negative) {
          color: #ef4444;
        }
        :global(.pf-points-volume) {
          font-size: 14px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.8);
          text-align: right;
        }
        :global(.pf-points-value) {
          font-size: 15px;
          font-weight: 700;
          color: #a78bfa;
          text-align: right;
        }
        .pf-table-desktop {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(139, 92, 246, 0.15);
          border-radius: 12px;
          overflow: hidden;
        }
        .pf-table-header {
          display: grid;
          grid-template-columns: 1fr 70px 80px 120px;
          gap: 16px;
          padding: 12px 20px;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 11px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .pf-activity-header {
          display: grid;
          grid-template-columns: 70px 1fr 110px 40px;
          gap: 12px;
          padding: 12px 20px;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 11px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .pf-table-body {
          max-height: 600px;
          overflow-y: auto;
        }

        /* Position Row */
        :global(.pf-position-row) {
          display: grid;
          grid-template-columns: 1fr 70px 80px 120px;
          gap: 16px;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          align-items: center;
          transition: background 0.15s;
          cursor: pointer;
        }
        :global(.pf-activity-row) {
          display: grid;
          grid-template-columns: 70px 1fr 110px 40px;
          gap: 12px;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          align-items: center;
          transition: background 0.15s;
        }

        /* Shared cells */
        :global(.pf-market-cell) {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        :global(.pf-icon) {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 14px;
          color: white;
          overflow: hidden;
        }
        :global(.pf-icon-img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 8px;
        }
        :global(.pf-info) {
          min-width: 0;
          flex: 1;
        }
        :global(.pf-title) {
          font-size: 14px;
          font-weight: 500;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.4;
        }
        :global(.pf-meta) {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 3px;
        }
        :global(.pf-shares) {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.5);
        }
        :global(.pf-price) {
          font-size: 14px;
          color: #fff;
          text-align: center;
        }
        :global(.pf-value) {
          text-align: right;
        }
        :global(.pf-value-amount) {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }
        :global(.pf-pnl) {
          font-size: 12px;
          margin-top: 2px;
        }
        :global(.pf-pnl.positive) {
          color: #22c55e;
        }
        :global(.pf-pnl.negative) {
          color: #ef4444;
        }
        :global(.pf-activity-amount) {
          text-align: right;
        }
        :global(.pf-time) {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 2px;
        }
        :global(.pf-tx-link) {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          color: rgba(255, 255, 255, 0.5);
          transition: all 0.15s;
          text-decoration: none;
        }
        :global(.pf-tx-link:hover) {
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
        }

        /* Badges */
        :global(.pf-badge-yes) {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        :global(.pf-badge-no) {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }
        :global(.pf-trade-badge-buy) {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        :global(.pf-trade-badge-sell) {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }

        .pf-empty {
          padding: 60px 20px;
          text-align: center;
          color: rgba(255, 255, 255, 0.4);
          font-size: 14px;
        }

        /* Mobile */
        .pf-mobile-list {
          display: none;
        }
        :global(.pf-card-mobile) {
          background: linear-gradient(
            180deg,
            rgba(20, 24, 30, 0.92) 0%,
            rgba(13, 17, 23, 0.94) 100%
          );
          border: 1px solid rgba(139, 92, 246, 0.15);
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 10px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        }
        :global(.pf-card-row) {
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        :global(.pf-card-info) {
          flex: 1;
          min-width: 0;
        }
        :global(.pf-card-title) {
          font-size: 15px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.98);
          line-height: 1.35;
          margin-bottom: 6px;
        }
        :global(.pf-card-meta) {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        :global(.pf-shares-m) {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.74);
        }
        :global(.pf-card-value) {
          text-align: right;
          flex-shrink: 0;
        }

        @media (max-width: 640px) {
          .pf-table-desktop {
            display: none;
          }
          .pf-mobile-list {
            display: block;
          }
        }

        @media (min-width: 1800px) {
          :global(.pf-title) {
            font-size: 16px;
          }
          :global(.pf-value-amount) {
            font-size: 16px;
          }
          :global(.pf-pnl) {
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  );
}
