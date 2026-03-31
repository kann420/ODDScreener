"use client";

import { useEffect, useMemo, useState } from "react";
import {
  OPINION_REFERRAL_CODE,
  calculateArbPnlByShares,
  appendReferralCode,
  buildReferralDiscounts,
  resolveFeeMarketTitle,
} from "@/lib/utils/arbCalculator";
import { calculateArbDepthPnlByShares } from "@/lib/utils/arbDepthCalculator";
import { PREDICTFUN_REFERRAL_CODE } from "@/lib/utils/predictfunFee";
import { buildPredictFunSideSnapshot } from "@/lib/utils/predictfunOrderbook";

const PLATFORM_CONFIG = {
  polymarket: {
    label: "POLYMARKET",
    color: "rgba(80,160,255,1)",
    buttonBg: "rgba(80,160,255,0.92)",
    buttonLabel: "Polymarket",
  },
  opinion: {
    label: "OPINION",
    color: "rgba(255,140,50,1)",
    buttonBg: "rgba(181,83,56,0.92)",
    buttonLabel: "Opinion",
  },
  probable: {
    label: "PROBABLE",
    color: "rgba(168,85,247,1)",
    buttonBg: "rgba(130,60,210,0.92)",
    buttonLabel: "Probable",
  },
  predictfun: {
    label: "PREDICT.FUN",
    color: "rgba(99,102,241,1)",
    buttonBg: "rgba(79,70,229,0.92)",
    buttonLabel: "Predict.fun",
  },
};

function CalculatorIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="2" width="18" height="20" rx="3" fill="#FF9500"/>
      <rect x="5" y="4" width="14" height="5" rx="1" fill="#fff"/>
      <circle cx="7" cy="12" r="1.2" fill="#fff"/>
      <circle cx="12" cy="12" r="1.2" fill="#fff"/>
      <circle cx="17" cy="12" r="1.2" fill="#fff"/>
      <circle cx="7" cy="16" r="1.2" fill="#fff"/>
      <circle cx="12" cy="16" r="1.2" fill="#fff"/>
      <circle cx="17" cy="16" r="1.2" fill="#fff"/>
      <circle cx="7" cy="20" r="1.2" fill="#fff"/>
      <rect x="10.5" y="19" width="8" height="2.4" rx="1" fill="#fff"/>
    </svg>
  );
}

function CopyIcon({ copied }) {
  if (copied) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(80,200,120,1)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 5h5v5" />
      <path d="M10 14L19 5" />
      <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}

function formatCents(decimalPrice) {
  if (!Number.isFinite(decimalPrice)) return "0c";
  return `${(decimalPrice * 100).toFixed(1)}c`;
}

function getDisplayMarketTitle(row) {
  const candidates = [
    row?.parentTitle,
    row?.sideA?.title,
    row?.sideB?.title,
    row?.title,
  ].filter(Boolean);
  if (!candidates.length) return "Unknown Market";
  return candidates.sort((a, b) => String(b).length - String(a).length)[0];
}

function getDisplayOutcome(row) {
  return row?.outcome || row?.title || row?.sideB?.title || null;
}

function getStrategyLine(strategy, tag, fallbackIndex) {
  return strategy.find((line) => line.includes(`(${tag})`)) || strategy[fallbackIndex] || "";
}

function getStrategyAvgPrice(strategyLegs, targetLine, fallbackIndex) {
  if (!Array.isArray(strategyLegs) || strategyLegs.length === 0) return null;

  const matchedLeg =
    strategyLegs.find((leg) => String(leg?.label || "") === String(targetLine || "")) ||
    strategyLegs[fallbackIndex] ||
    null;
  const avgPriceCents = Number(matchedLeg?.avgPriceCents);

  return Number.isFinite(avgPriceCents) ? avgPriceCents / 100 : null;
}

function getPriceForSide(prices, buyYes, side) {
  if (side === "A") {
    return (buyYes ? prices.opYes : prices.opNo) || 0;
  }
  return (buyYes ? prices.polyYes : prices.polyNo) || 0;
}

function getLabelForSide(prices, buyYes, side) {
  if (side === "A") {
    return buyYes ? (prices.opYesLabel || "YES") : (prices.opNoLabel || "NO");
  }
  return buyYes ? (prices.polyYesLabel || "YES") : (prices.polyNoLabel || "NO");
}

function buildFeeRowLabel(labelPct, categoryLabel) {
  const baseLabel = labelPct ? `EST. FEE (${labelPct})` : "EST. FEE";
  return categoryLabel ? `${baseLabel} - ${categoryLabel}` : baseLabel;
}

function RowItem({ label, value, copyValue, highlight, bold }) {
  const [itemCopied, setItemCopied] = useState(false);

  const handleCopy = async () => {
    if (!copyValue) return;
    await navigator.clipboard.writeText(copyValue);
    setItemCopied(true);
    setTimeout(() => setItemCopied(false), 1500);
  };

  let valueColor = "rgba(255,255,255,0.9)";
  if (highlight === "green") valueColor = "rgba(80,200,120,1)";
  if (highlight === "orange") valueColor = "rgba(255,140,50,1)";

  return (
    <div className="arb-calc-row" style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      fontSize: 12,
      flexWrap: "wrap",
      gap: 4,
    }}>
      <span style={{
        color: highlight ? valueColor : "rgba(255,255,255,0.5)",
        fontWeight: highlight || bold ? 700 : 400,
        flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{
        color: valueColor,
        fontWeight: bold ? 800 : 600,
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        justifyContent: "flex-end",
        textAlign: "right",
      }}>
        {value}
        {copyValue && (
          <button
            onClick={handleCopy}
            style={{
              background: "transparent",
              border: "none",
              color: itemCopied ? "rgba(80,200,120,1)" : "rgba(255,255,255,0.4)",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              alignItems: "center",
            }}
            title="Copy"
            type="button"
          >
            <CopyIcon copied={itemCopied} />
          </button>
        )}
      </span>
    </div>
  );
}

function ReferralRow({ checked, onChange, label, code, copied, onCopy, tint }) {
  return (
    <div style={{
      padding: "14px 20px",
      borderTop: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.02)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          <span style={{ fontSize: 15, color: "rgb(255, 255, 255)" }}>
            {label}
          </span>
        </div>
        <button
          onClick={onCopy}
          type="button"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            background: `${tint}4d`,
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            color: copied ? "rgba(80,200,120,1)" : "rgba(255,180,120,1)",
            cursor: "pointer",
            border: "none",
            transition: "all 0.2s",
          }}
          title="Click to copy"
        >
          {code}
          <CopyIcon copied={copied} />
        </button>
      </div>
    </div>
  );
}

export default function ArbCalculatorModal({ row, onClose }) {
  const [shareSize, setShareSize] = useState(100);
  const [useOpinionReferral, setUseOpinionReferral] = useState(true);
  const [usePredictFunReferral, setUsePredictFunReferral] = useState(true);
  const [copiedCode, setCopiedCode] = useState("");
  const [depthBooks, setDepthBooks] = useState({
    loading: false,
    sideABook: null,
    sideBBook: null,
    error: null,
  });

  const platformA = row?.platformA || row?.sideA?.platform || "opinion";
  const platformB = row?.platformB || row?.sideB?.platform || "polymarket";
  const configA = PLATFORM_CONFIG[platformA] || PLATFORM_CONFIG.opinion;
  const configB = PLATFORM_CONFIG[platformB] || PLATFORM_CONFIG.polymarket;
  const prices = row?.prices || {};
  const strategy = Array.isArray(row?.strategy) ? row.strategy : [];
  const strategyLegs = Array.isArray(row?.strategyLegs) ? row.strategyLegs : [];
  const tokenIds = row?.tokenIds || {};
  const tagA = prices.opTag || configA.label;
  const tagB = prices.polyTag || configB.label;

  const sideALine = getStrategyLine(strategy, tagA, 1);
  const sideBLine = getStrategyLine(strategy, tagB, 0);
  const sideABuysYes = /buy\s+yes/i.test(sideALine) || (/buy/i.test(sideALine) && !/\bno\b/i.test(sideALine));
  const sideBBuysYes = /buy\s+yes/i.test(sideBLine) || (/buy/i.test(sideBLine) && !/\bno\b/i.test(sideBLine));
  const sideALabel = getLabelForSide(prices, sideABuysYes, "A");
  const sideBLabel = getLabelForSide(prices, sideBBuysYes, "B");
  const priceA = getPriceForSide(prices, sideABuysYes, "A") / 100;
  const priceB = getPriceForSide(prices, sideBBuysYes, "B") / 100;
  const hasOpinion = platformA === "opinion" || platformB === "opinion";
  const hasPredictFun = platformA === "predictfun" || platformB === "predictfun";
  const sideAMarketCategory = row?.sideA?.marketCategory ?? null;
  const sideBMarketCategory = row?.sideB?.marketCategory ?? null;
  const sideAFeesEnabled = row?.sideA?.feesEnabled ?? null;
  const sideBFeesEnabled = row?.sideB?.feesEnabled ?? null;
  const sideASportsMarketType = row?.sideA?.sportsMarketType ?? null;
  const sideBSportsMarketType = row?.sideB?.sportsMarketType ?? null;
  const fallbackMarketTitle = row?.parentTitle || row?.title || null;
  const displayMarketTitle = getDisplayMarketTitle(row);
  const sideAMarketTitle = resolveFeeMarketTitle(
    row?.sideA?.marketTitle,
    row?.sideA?.title,
    platformA === "polymarket" ? displayMarketTitle : null,
    fallbackMarketTitle,
    row?.outcome,
  );
  const sideBMarketTitle = resolveFeeMarketTitle(
    row?.sideB?.marketTitle,
    row?.sideB?.title,
    platformB === "polymarket" ? displayMarketTitle : null,
    fallbackMarketTitle,
    row?.outcome,
  );

  const referralDiscounts = buildReferralDiscounts({
    useOpinionReferral,
    usePredictFunReferral,
  });
  const enabledReferral = {
    opinion: useOpinionReferral,
    predictfun: usePredictFunReferral,
  };

  useEffect(() => {
    let cancelled = false;

    const fetchBook = async (platform, tokenId) => {
      if (!platform || !tokenId) return null;

      const apiPlatform = platform === "polymarket" ? "poly" : platform;
      const response = await fetch(
        `/api/arbitage/orderbook?platform=${encodeURIComponent(apiPlatform)}&token_id=${encodeURIComponent(tokenId)}`,
        { cache: "no-store" }
      );
      const payload = await response.json();

      if (!response.ok || !payload?.ok) return null;
      return payload;
    };

    const fetchSelectedBook = async ({ platform, yesTokenId, noTokenId, useYes }) => {
      if (platform === "predictfun") {
        const rawBook = await fetchBook(platform, yesTokenId || noTokenId);
        if (!rawBook) return null;
        return buildPredictFunSideSnapshot(rawBook, {
          side: useYes ? "yes" : "no",
          decimalPrecision: rawBook.decimalPrecision ?? 2,
        });
      }

      const tokenId = useYes ? yesTokenId : noTokenId;
      return fetchBook(platform, tokenId);
    };

    async function loadDepthBooks() {
      setDepthBooks({
        loading: true,
        sideABook: null,
        sideBBook: null,
        error: null,
      });

      try {
        const [sideABook, sideBBook] = await Promise.all([
          fetchSelectedBook({
            platform: platformA,
            yesTokenId: tokenIds?.opYes || null,
            noTokenId: tokenIds?.opNo || null,
            useYes: sideABuysYes,
          }),
          fetchSelectedBook({
            platform: platformB,
            yesTokenId: tokenIds?.polyYes || null,
            noTokenId: tokenIds?.polyNo || null,
            useYes: sideBBuysYes,
          }),
        ]);

        if (cancelled) return;

        setDepthBooks({
          loading: false,
          sideABook,
          sideBBook,
          error: sideABook && sideBBook ? null : "depth_unavailable",
        });
      } catch (error) {
        if (cancelled) return;
        console.error("[ArbCalculator] depth fetch failed:", error?.message || error);
        setDepthBooks({
          loading: false,
          sideABook: null,
          sideBBook: null,
          error: "depth_unavailable",
        });
      }
    }

    loadDepthBooks();

    return () => {
      cancelled = true;
    };
  }, [
    row?.id,
    platformA,
    platformB,
    tokenIds?.opYes,
    tokenIds?.opNo,
    tokenIds?.polyYes,
    tokenIds?.polyNo,
    sideABuysYes,
    sideBBuysYes,
  ]);

  const fallbackResult = useMemo(() => {
    return calculateArbPnlByShares({
      shares: shareSize,
      sideAPrice: priceA,
      sideBPrice: priceB,
      platformA,
      platformB,
      referralDiscounts,
      sideAMarketCategory,
      sideBMarketCategory,
      sideAFeesEnabled,
      sideBFeesEnabled,
      sideASportsMarketType,
      sideBSportsMarketType,
      sideAMarketTitle,
      sideBMarketTitle,
    });
  }, [
    shareSize,
    priceA,
    priceB,
    platformA,
    platformB,
    referralDiscounts,
    sideAMarketCategory,
    sideBMarketCategory,
    sideAFeesEnabled,
    sideBFeesEnabled,
    sideASportsMarketType,
    sideBSportsMarketType,
    sideAMarketTitle,
    sideBMarketTitle,
  ]);

  const depthResult = useMemo(() => {
    if (!depthBooks.sideABook || !depthBooks.sideBBook) return null;

    return calculateArbDepthPnlByShares({
      shares: shareSize,
      sideABook: depthBooks.sideABook,
      sideBBook: depthBooks.sideBBook,
      platformA,
      platformB,
      mode: row?.strategyMode === "sell" ? "sell" : "buy",
      feeMetaA: {
        marketCategory: sideAMarketCategory,
        feesEnabled: sideAFeesEnabled,
        sportsMarketType: sideASportsMarketType,
        marketTitle: sideAMarketTitle,
      },
      feeMetaB: {
        marketCategory: sideBMarketCategory,
        feesEnabled: sideBFeesEnabled,
        sportsMarketType: sideBSportsMarketType,
        marketTitle: sideBMarketTitle,
      },
      referralDiscounts,
    });
  }, [
    depthBooks.sideABook,
    depthBooks.sideBBook,
    shareSize,
    platformA,
    platformB,
    row?.strategyMode,
    sideAMarketCategory,
    sideBMarketCategory,
    sideAFeesEnabled,
    sideBFeesEnabled,
    sideASportsMarketType,
    sideBSportsMarketType,
    sideAMarketTitle,
    sideBMarketTitle,
    referralDiscounts,
  ]);

  const result = depthResult || fallbackResult;
  const displayPriceA =
    depthResult?.sideAAvgPrice ??
    getStrategyAvgPrice(strategyLegs, sideALine, 1) ??
    priceA;
  const displayPriceB =
    depthResult?.sideBAvgPrice ??
    getStrategyAvgPrice(strategyLegs, sideBLine, 0) ??
    priceB;

  const sideAUrl = appendReferralCode(row?.sideA?.url || row?.opinion?.url || "#", platformA, enabledReferral);
  const sideBUrl = appendReferralCode(row?.sideB?.url || row?.poly?.url || "#", platformB, enabledReferral);
  const marketTitle = getDisplayMarketTitle(row);
  const outcomeTitle = getDisplayOutcome(row);

  const handleCopyCode = async (platform) => {
    const code = platform === "predictfun" ? PREDICTFUN_REFERRAL_CODE : OPINION_REFERRAL_CODE;
    await navigator.clipboard.writeText(code);
    setCopiedCode(platform);
    setTimeout(() => setCopiedCode(""), 2000);
  };

  const footerNotes = [
    hasOpinion ? "* Min Opinion fee is $0.25 if Market Price matched. Fees range: 0% - 1%." : null,
    platformA === "probable" || platformB === "probable" ? "* Probable fee applies to taker orders only. Makers trade free." : null,
    hasPredictFun ? "* Min Predict.fun fee is $0.0002 if Market Price matched. Fees range: 0.018% - 2%." : null,
  ].filter(Boolean);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.8)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "linear-gradient(135deg, rgba(30,30,35,0.98), rgba(20,20,25,0.98))",
          borderRadius: 16,
          width: "95%",
          maxWidth: 600,
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CalculatorIcon />
            <span style={{ fontSize: 16, fontWeight: 800 }}>CALCULATOR</span>
          </div>
          <button
            onClick={onClose}
            type="button"
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: 6,
              padding: "6px 12px",
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            CLOSE X
          </button>
        </div>

        <div style={{
          padding: "12px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(0,0,0,0.2)",
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: "rgba(255,255,255,0.4)",
            marginBottom: 4,
          }}>
            MARKET
          </div>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: "rgba(255,255,255,0.9)",
            lineHeight: 1.4,
          }}>
            {marketTitle}
          </div>
          {outcomeTitle && (
            <div style={{
              marginTop: 6,
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(150,150,255,0.9)",
            }}>
              Outcome: {outcomeTitle}
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: configA.color }}>{configA.label}</span>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: 700 }}>vs</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: configB.color }}>{configB.label}</span>
          </div>
        </div>

        <div style={{ padding: "16px 20px" }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.5)" }}>
              o SHARE SIZE
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              value={shareSize}
              onChange={(e) => setShareSize(Math.max(0, parseInt(e.target.value || "0", 10) || 0))}
              style={{
                flex: 1,
                padding: "12px 14px",
                fontSize: 18,
                fontWeight: 700,
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                color: "#fff",
                outline: "none",
              }}
            />
            <div className="arb-calc-fast-filter" style={{ display: "flex", gap: 4 }}>
              {[50, 100, 500, 1000].map((size) => (
                <button
                  key={size}
                  onClick={() => setShareSize(size)}
                  type="button"
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    background: shareSize === size ? "rgba(255,180,50,0.2)" : "rgba(255,255,255,0.08)",
                    border: shareSize === size ? "1px solid rgba(255,180,50,0.4)" : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    color: shareSize === size ? "rgba(255,180,50,1)" : "rgba(255,255,255,0.7)",
                    cursor: "pointer",
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
          {depthResult && !depthResult.fullyFilled && (
            <div style={{
              marginTop: 8,
              fontSize: 12,
              fontWeight: 700,
              color: "rgba(255,180,120,0.95)",
            }}>
              Filled {Math.round(depthResult.sharesExecuted).toLocaleString("en-US")} / {shareSize.toLocaleString("en-US")} profitable shares at current depth.
            </div>
          )}
          {!depthResult && depthBooks.loading && (
            <div style={{
              marginTop: 8,
              fontSize: 12,
              fontWeight: 700,
              color: "rgba(255,255,255,0.55)",
            }}>
              Syncing depth and fees...
            </div>
          )}
          {!depthResult && !depthBooks.loading && depthBooks.error && (
            <div style={{
              marginTop: 8,
              fontSize: 12,
              fontWeight: 700,
              color: "rgba(255,180,120,0.95)",
            }}>
              Depth data unavailable. Showing top-of-book estimate.
            </div>
          )}
        </div>

        {result && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}>
            <div style={{
              padding: "16px 20px",
              borderRight: "1px solid rgba(255,255,255,0.1)",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: configA.color }}>{configA.label} SIDE</span>
                <span style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 800,
                  background: sideABuysYes ? "rgba(80,200,120,0.2)" : "rgba(255,100,100,0.2)",
                  color: sideABuysYes ? "rgba(80,200,120,1)" : "rgba(255,100,100,1)",
                }}>
                  {sideALabel}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <RowItem label="AVG SHARE PRICE" value={formatCents(displayPriceA)} />
                <RowItem label="TOTAL COST" value={formatUsd(result.sideACost)} copyValue={result.sideACost.toFixed(2)} />
                <RowItem
                  label={buildFeeRowLabel(result.sideAFeeLabelPct, result.sideAFeeCategoryLabel)}
                  value={result.sideAFeeLabel}
                  highlight={result.sideAFee === 0 ? "green" : "orange"}
                />
                <RowItem label="TOTAL COST (INC. FEES)" value={formatUsd(result.sideATotal)} bold />
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10, marginTop: 4 }}>
                  <RowItem
                    label="TO RETURN"
                    value={
                      <>
                        {formatUsd(result.toReturn)}
                        <span className="arb-calc-profit" style={{ color: "rgba(80,200,120,0.9)", marginLeft: 6, fontSize: 12 }}>
                          [+{formatUsd(result.toReturn - result.sideATotal)}]
                        </span>
                      </>
                    }
                    bold
                  />
                </div>
              </div>

              <a
                href={sideAUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="arb-calc-link"
                aria-label={`Open ${configA.label} market`}
                title={`Open ${configA.label} market`}
                style={{
                  display: "block",
                  marginTop: 16,
                  padding: "12px",
                  background: configA.buttonBg,
                  borderRadius: 8,
                  textAlign: "center",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span>{configA.buttonLabel}</span>
                  <span style={{ display: "inline-flex", opacity: 0.9 }}>
                    <ExternalLinkIcon />
                  </span>
                </span>
              </a>
            </div>

            <div style={{ padding: "16px 20px" }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: configB.color }}>{configB.label} SIDE</span>
                <span style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 800,
                  background: sideBBuysYes ? "rgba(80,200,120,0.2)" : "rgba(255,100,100,0.2)",
                  color: sideBBuysYes ? "rgba(80,200,120,1)" : "rgba(255,100,100,1)",
                }}>
                  {sideBLabel}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <RowItem label="AVG SHARE PRICE" value={formatCents(displayPriceB)} />
                <RowItem label="TOTAL COST" value={formatUsd(result.sideBCost)} copyValue={result.sideBCost.toFixed(2)} />
                <RowItem
                  label={buildFeeRowLabel(result.sideBFeeLabelPct, result.sideBFeeCategoryLabel)}
                  value={result.sideBFeeLabel}
                  highlight={result.sideBFee === 0 ? "green" : "orange"}
                />
                <RowItem label="TOTAL COST (INC. FEES)" value={formatUsd(result.sideBTotal)} bold />
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10, marginTop: 4 }}>
                  <RowItem
                    label="TO RETURN"
                    value={
                      <>
                        {formatUsd(result.toReturn)}
                        <span className="arb-calc-profit" style={{ color: "rgba(80,200,120,0.9)", marginLeft: 6, fontSize: 12 }}>
                          [+{formatUsd(result.toReturn - result.sideBTotal)}]
                        </span>
                      </>
                    }
                    bold
                  />
                </div>
              </div>

              <a
                href={sideBUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="arb-calc-link"
                aria-label={`Open ${configB.label} market`}
                title={`Open ${configB.label} market`}
                style={{
                  display: "block",
                  marginTop: 16,
                  padding: "12px",
                  background: configB.buttonBg,
                  borderRadius: 8,
                  textAlign: "center",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span>{configB.buttonLabel}</span>
                  <span style={{ display: "inline-flex", opacity: 0.9 }}>
                    <ExternalLinkIcon />
                  </span>
                </span>
              </a>
            </div>
          </div>
        )}

        {result && (
          <div style={{
            padding: "16px 20px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            background: result.netPnl >= 0 ? "rgba(80,200,120,0.1)" : "rgba(255,100,100,0.1)",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
                  COMBINED NET PNL
                </div>
                <div style={{
                  fontSize: 24,
                  fontWeight: 800,
                  color: result.netPnl >= 0 ? "rgba(80,200,120,1)" : "rgba(255,100,100,1)",
                }}>
                  {result.netPnl >= 0 ? "+" : ""}{formatUsd(result.netPnl)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
                  ROI
                </div>
                <div style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: result.roi >= 0 ? "rgba(80,200,120,1)" : "rgba(255,100,100,1)",
                }}>
                  {result.roi >= 0 ? "+" : ""}{result.roi.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
        )}

        {hasOpinion && (
          <ReferralRow
            checked={useOpinionReferral}
            onChange={setUseOpinionReferral}
            label="Use Code on Opinion to get Up To 10% Fee Discount"
            code={OPINION_REFERRAL_CODE}
            copied={copiedCode === "opinion"}
            onCopy={() => handleCopyCode("opinion")}
            tint="rgba(181,83,56,0.3)"
          />
        )}

        {hasPredictFun && (
          <ReferralRow
            checked={usePredictFunReferral}
            onChange={setUsePredictFunReferral}
            label="Use Code on Predict.fun to get Up To 10% Fee Discount"
            code={PREDICTFUN_REFERRAL_CODE}
            copied={copiedCode === "predictfun"}
            onCopy={() => handleCopyCode("predictfun")}
            tint="rgba(79,70,229,0.3)"
          />
        )}

        <div className="arb-calc-note" style={{
          padding: "12px 20px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          fontSize: 14,
          color: "rgb(253, 253, 253)",
          textAlign: "center",
        }}>
          {footerNotes.map((note, index) => (
            <div
              key={note}
              style={{
                color: "rgb(253, 253, 253)",
                fontWeight: 400,
                marginTop: index === 0 ? 0 : 16,
              }}
            >
              {note}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
