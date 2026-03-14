"use client";

/**
 * RebateTab Component
 *
 * Displays maker rebate statistics for the Opinion Maker Rebates Program.
 * Shows: Yesterday Rebate, Today Est. Rebate, Total Rebate (since program start March 13 2026).
 * Below the summary cards, lists individual maker trades.
 */

import { useMemo, useState } from "react";
import { formatUSD, timeAgo, num } from "@/lib/walletTracker/format";
import { calculateRebateStats } from "@/lib/walletTracker/deriveClosed";
import OptimizedImage from "@/components/OptimizedImage";

/* ── Skeleton ──────────────────────────────────────────────────────── */

function CardSkeleton() {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      borderRadius: 12,
      padding: "20px 24px",
      flex: 1,
      minWidth: 140,
    }}>
      <div style={{ width: "50%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 10 }} />
      <div style={{ width: "70%", height: 24, borderRadius: 4, background: "rgba(255,255,255,0.08)" }} />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ flex: 1 }}>
        <div style={{ width: "60%", height: 14, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginBottom: 6 }} />
        <div style={{ width: "40%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
      </div>
      <div style={{ width: 60, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

/* ── Summary Card ──────────────────────────────────────────────────── */

function SummaryCard({ label, value, color = "#fff", isLoading }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12,
      padding: "18px 22px",
      flex: 1,
      minWidth: 140,
    }}>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, fontWeight: 500 }}>
        {label}
      </div>
      {isLoading ? (
        <div style={{ width: "60%", height: 22, borderRadius: 4, background: "rgba(255,255,255,0.08)" }} />
      ) : (
        <div style={{ fontSize: 22, fontWeight: 700, color }}>
          ${(value || 0).toFixed(6)}
        </div>
      )}
    </div>
  );
}

/* ── Maker Trade Row ───────────────────────────────────────────────── */

function MakerTradeRow({ trade }) {
  const date = new Date(trade.ts);
  const isToday = (() => {
    const now = new Date();
    return date.getUTCFullYear() === now.getUTCFullYear() &&
           date.getUTCMonth() === now.getUTCMonth() &&
           date.getUTCDate() === now.getUTCDate();
  })();
  const isYesterday = (() => {
    const yesterday = new Date(Date.now() - 86_400_000);
    return date.getUTCFullYear() === yesterday.getUTCFullYear() &&
           date.getUTCMonth() === yesterday.getUTCMonth() &&
           date.getUTCDate() === yesterday.getUTCDate();
  })();

  const pad2 = n => String(n).padStart(2, '0');
  const utcTime = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
  const utcDate = `${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${date.getUTCDate()}`;
  const dayLabel = isToday ? "Today" : isYesterday ? "Yesterday" : utcDate;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 0",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      {/* Thumbnail */}
      <div style={{ width: 36, height: 36, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.06)" }}>
        {trade.thumbnailUrl ? (
          <OptimizedImage
            src={trade.thumbnailUrl}
            alt=""
            width={36}
            height={36}
            style={{ objectFit: "cover", width: 36, height: 36 }}
          />
        ) : (
          <div style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "rgba(255,255,255,0.3)" }}>
            💰
          </div>
        )}
      </div>

      {/* Market info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {trade.marketTitle || `Market #${trade.marketId}`}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
          <span style={{ 
            color: trade.side === "buy" ? "#22c55e" : "#ef4444",
            fontWeight: 600,
            textTransform: "uppercase",
            marginRight: 6,
          }}>
            {trade.side}
          </span>
          {Number(trade.shares).toFixed(2)} shares @ {(trade.price * 100).toFixed(1)}¢
          <span style={{ margin: "0 6px", opacity: 0.3 }}>·</span>
          {dayLabel} {utcTime} UTC
        </div>
      </div>

      {/* Rebate amount */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa" }}>
          +${trade.rebate.toFixed(6)}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
          rebate
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────────── */

export default function RebateTab({ trades, isLoading }) {
  const [showAll, setShowAll] = useState(false);
  const INITIAL_SHOW = 20;

  const rebateStats = useMemo(() => {
    if (!trades || !trades.length) return { todayRebate: 0, yesterdayRebate: 0, totalRebate: 0, makerTrades: [] };
    return calculateRebateStats(trades);
  }, [trades]);

  const visibleTrades = showAll
    ? rebateStats.makerTrades
    : rebateStats.makerTrades.slice(0, INITIAL_SHOW);

  const hasMore = rebateStats.makerTrades.length > INITIAL_SHOW && !showAll;

  if (isLoading) {
    return (
      <div>
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
        {[...Array(5)].map((_, i) => <RowSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div>
      {/* Summary Cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <SummaryCard
          label="Yesterday Rebate"
          value={rebateStats.yesterdayRebate}
          color={rebateStats.yesterdayRebate > 0 ? "#a78bfa" : "#fff"}
          isLoading={isLoading}
        />
        <SummaryCard
          label="Today Est. Rebate"
          value={rebateStats.todayRebate}
          color={rebateStats.todayRebate > 0 ? "#22c55e" : "#fff"}
          isLoading={isLoading}
        />
        <SummaryCard
          label="Total Rebate"
          value={rebateStats.totalRebate}
          color={rebateStats.totalRebate > 0 ? "#f59e0b" : "#fff"}
          isLoading={isLoading}
        />
      </div>

      {/* Program note */}
      <div style={{
        fontSize: 12,
        color: "rgba(255,255,255,0.35)",
        marginBottom: 16,
        padding: "8px 12px",
        background: "rgba(255,255,255,0.02)",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.04)",
      }}>
        Maker Rebates Program started Mar 13, 2026. Rebate = shares × p × (1−p) × 4% × 50%. Only limit orders (maker fills) earn rebates.
      </div>

      {/* Maker Trades list */}
      {rebateStats.makerTrades.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "48px 24px",
          color: "rgba(255,255,255,0.4)",
          fontSize: 14,
        }}>
          No maker trades found since the program started.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>
            Maker Fills ({rebateStats.makerTrades.length})
          </div>
          {visibleTrades.map((t, i) => (
            <MakerTradeRow key={`${t.ts}-${t.marketId}-${i}`} trade={t} />
          ))}
          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              style={{
                display: "block",
                width: "100%",
                padding: "14px",
                marginTop: 8,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                color: "rgba(255,255,255,0.6)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
            >
              Show all {rebateStats.makerTrades.length} maker trades
            </button>
          )}
        </>
      )}
    </div>
  );
}
