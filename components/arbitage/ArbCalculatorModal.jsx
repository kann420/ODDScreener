"use client";

import { useState, useMemo } from "react";

/**
 * Opinion Fee Calculator
 * Fee formula from docs: https://docs.opinion.trade/trade-on-opinion.trade/fees
 * 
 * Fee is assessed PER matched fill:
 * - For each fill i with price Pi¢ and quantity Qi:
 *   - Notional_i = Qi × (Pi¢ / 100)
 *   - D = (1 - user_discount) × (1 - transaction_discount) × (1 - user_referral_discount)
 *   - Effective fee rate_i = topic_rate × pi × (1 - pi) × D
 *   - Raw fee_i = Notional_i × Effective fee rate_i
 *   - Fee charged per fill_i = max(Raw fee_i, $0.5)   // $0.5 minimum PER FILL
 * - Total Opinion fee = sum(Fee charged per fill_i)
 * 
 * Default topic_rate = 2% (0.02)
 * Min fee = $0.5 per fill
 * Max fee = 2% of notional
 * 
 * Fill estimation based on orderbook depth:
 * - Notional < $90 → 1 fill
 * - Notional $90-200 → 2 fills
 * - Notional $200-500 → 4 fills
 * - Notional > $500 → 5 + floor((notional-500)/200) fills
 */

/**
 * Estimate number of fills based on notional value
 * - Notional < $50 → 1 fill
 * - Notional $50-100 → 2 fills
 * - Notional $100-200 → 3 fills
 * - Notional $200-$300 → 4 fills
 * - Notional $300-$400 → 5 fills
 * - Notional > $400 → use max fee 2% (return -1 to signal this)
 */
function estimateNumFills(notional) {
  if (notional < 50) return 1;
  if (notional < 100) return 2;
  if (notional < 200) return 3;
  if (notional < 300) return 4;
  if (notional < 400) return 5;
  // For large orders > $400, use max fee 2%
  return -1; // Signal to use max fee
}

function calculateOpinionFee({
  price,           // Price in decimal (0-1), e.g., 0.85 = 85¢
  quantity,        // Number of shares
  topicRate = 0.02,       // Default 2%
  userDiscount = 0,       // 0-1
  transactionDiscount = 0, // 0-1
  referralDiscount = 0,   // 0-1 (default 0, pass 0.1 for 10% referral discount)
}) {
  const totalNotional = price * quantity;
  
  // Max fee is 2% of notional
  const maxFee = totalNotional * 0.02;
  
  // Estimate number of fills based on notional
  const numFills = estimateNumFills(totalNotional);
  
  // Discount multiplier: D = (1 - user_discount) × (1 - transaction_discount) × (1 - referral_discount)
  const D = (1 - userDiscount) * (1 - transactionDiscount) * (1 - referralDiscount);
  
  let baseTotalFee;
  let rawFeePerFill = 0;
  let feePerFill = 0;
  let isCapped = false;
  
  if (numFills === -1) {
    // For notional > $500, use max fee 2%
    baseTotalFee = maxFee;
    isCapped = true;
  } else {
    // Effective fee rate at this price (without discounts for base calculation)
    const baseEffectiveRate = topicRate * price * (1 - price);
    
    // Calculate notional per fill (assume equal distribution)
    const notionalPerFill = totalNotional / numFills;
    
    // Calculate raw fee per fill (before minimum, without discounts)
    rawFeePerFill = notionalPerFill * baseEffectiveRate;
    
    // Apply $0.5 minimum per fill
    feePerFill = Math.max(rawFeePerFill, 0.5);
    
    // Total fee before discount = sum of all fills
    baseTotalFee = feePerFill * numFills;
    
    // Cap at max fee if exceeded
    if (baseTotalFee > maxFee) {
      baseTotalFee = maxFee;
      isCapped = true;
    }
  }
  
  // Apply discounts to total fee
  let totalFee = baseTotalFee * D;
  
  // Ensure minimum $0.50 total fee (absolute floor)
  totalFee = Math.max(totalFee, 0.5);
  
  const isMinimumApplied = totalFee <= 0.5;
  
  // Calculate effective fee percentage for display
  const feePercentage = totalNotional > 0 ? (totalFee / totalNotional) * 100 : 0;
  
  // Effective rate with discounts
  const baseEffectiveRate = topicRate * price * (1 - price);
  const effectiveRate = baseEffectiveRate * D;

  return {
    fee: totalFee,
    baseFee: baseTotalFee,
    effectiveRate,
    feePercentage,
    notional: totalNotional,
    numFills: numFills === -1 ? 'max' : numFills,
    rawFeePerFill,
    feePerFill,
    maxFee,
    discountMultiplier: D,
    isMinimumApplied,
    isCapped,
  };
}

/**
 * Calculate arbitrage PNL based on share count
 */
function calculateArbPnlByShares({
  shares,         // Number of shares to buy
  polyPrice,      // Polymarket price (decimal 0-1)
  opinionPrice,   // Opinion price (decimal 0-1)
  polySide,       // "YES" or "NO" - which side to buy on Poly
  opinionSide,    // "YES" or "NO" - which side to buy on Opinion
  referralDiscount = 0,  // 0 = no referral, 0.1 = 10% discount
}) {
  if (!shares || shares <= 0 || !polyPrice || !opinionPrice) {
    return null;
  }

  // Costs
  const polyCost = shares * polyPrice;
  const opinionCost = shares * opinionPrice;
  
  // Polymarket fee = 0
  const polyFee = 0;
  
  // Opinion fee
  const opinionFeeResult = calculateOpinionFee({
    price: opinionPrice,
    quantity: shares,
    referralDiscount,
  });
  const opinionFee = opinionFeeResult.fee;
  
  // Total costs
  const polyTotalCost = polyCost + polyFee;
  const opinionTotalCost = opinionCost + opinionFee;
  const totalCost = polyTotalCost + opinionTotalCost;
  
  // Return: One side always wins, so return = shares * $1 = shares
  const toReturn = shares;
  
  // Net PNL
  const netPnl = toReturn - totalCost;
  
  // ROI
  const roi = totalCost > 0 ? (netPnl / totalCost) * 100 : 0;
  
  return {
    shares,
    polyCost,
    opinionCost,
    polyFee,
    opinionFee,
    opinionFeeRate: opinionFeeResult.effectiveRate,
    opinionFeePercentage: opinionFeeResult.feePercentage,
    isMinimumFeeApplied: opinionFeeResult.isMinimumApplied,
    isFeeMaxCapped: opinionFeeResult.isCapped,
    numFills: opinionFeeResult.numFills,
    polyTotalCost,
    opinionTotalCost,
    totalCost,
    toReturn,
    netPnl,
    roi,
  };
}

// Calculator Icon SVG (iPhone style)
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

// Copy Icon SVG
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

// Helper functions
function formatUsd(value) {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}

function formatCents(decimalPrice) {
  if (!Number.isFinite(decimalPrice)) return "0¢";
  const cents = decimalPrice * 100;
  return `${cents.toFixed(1)}¢`;
}

// Helper components
function RowItem({ label, value, copyValue, highlight, bold }) {
  const [itemCopied, setItemCopied] = useState(false);
  
  const handleCopy = () => {
    if (copyValue) {
      navigator.clipboard.writeText(copyValue);
      setItemCopied(true);
      setTimeout(() => setItemCopied(false), 1500);
    }
  };

  let valueColor = "rgba(255,255,255,0.9)";
  if (highlight === "green") valueColor = "rgba(80,200,120,1)";
  if (highlight === "orange") valueColor = "rgba(255,140,50,1)";

  return (
    <div style={{ 
      display: "flex", 
      justifyContent: "space-between", 
      alignItems: "center",
      fontSize: 12,
    }}>
      <span style={{ 
        color: highlight ? valueColor : "rgba(255,255,255,0.5)", 
        fontWeight: highlight || bold ? 700 : 400,
      }}>
        {label}
      </span>
      <span style={{ 
        color: valueColor, 
        fontWeight: bold ? 800 : 600,
        display: "flex",
        alignItems: "center",
        gap: 6,
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
          >
            <CopyIcon copied={itemCopied} />
          </button>
        )}
      </span>
    </div>
  );
}

export default function ArbCalculatorModal({ row, onClose }) {
  const [shareSize, setShareSize] = useState(100);
  const [useReferral, setUseReferral] = useState(true);
  const [copied, setCopied] = useState(false);
  
  // Extract prices from row
  const prices = row?.prices || {};
  const strategy = Array.isArray(row?.strategy) ? row.strategy : [];
  
  // Determine which sides based on strategy
  // Strategy like ["Buy YES (Poly)", "Buy NO (Opinion)"]
  const strategyStr = strategy.join(" ");
  const polyBuySide = strategyStr.includes("YES (Poly)") ? "YES" : "NO";
  const opinionBuySide = strategyStr.includes("YES (Opinion)") || strategyStr.includes("YES (Op)") ? "YES" : "NO";
  
  // Get prices based on sides (these are ASK prices for buying)
  const polyPrice = polyBuySide === "YES" 
    ? (prices.polyYes || 0) / 100  // Convert cents to decimal
    : (prices.polyNo || 0) / 100;
  const opinionPrice = opinionBuySide === "YES"
    ? (prices.opYes || 0) / 100
    : (prices.opNo || 0) / 100;
  
  // Calculate referral discount based on checkbox
  const referralDiscount = useReferral ? 0.1 : 0;
  
  // Calculate PNL
  const result = useMemo(() => {
    return calculateArbPnlByShares({
      shares: shareSize,
      polyPrice,
      opinionPrice,
      polySide: polyBuySide,
      opinionSide: opinionBuySide,
      referralDiscount,
    });
  }, [shareSize, polyPrice, opinionPrice, polyBuySide, opinionBuySide, referralDiscount]);
  
  // Handle copy referral code
  const handleCopyReferral = () => {
    navigator.clipboard.writeText("8YfTc9");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "linear-gradient(180deg, rgba(30,30,35,1) 0%, rgba(20,20,25,1) 100%)",
          borderRadius: 16,
          width: "95%",
          maxWidth: 600,
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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
            CLOSE ✕
          </button>
        </div>

        {/* Market Info */}
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
            {row?.poly?.title || row?.opinion?.question || "Unknown Market"}
          </div>
          {row?.outcome && (
            <div style={{ 
              marginTop: 6,
              fontSize: 11, 
              fontWeight: 600, 
              color: "rgba(150,150,255,0.9)",
            }}>
              Outcome: {row.outcome}
            </div>
          )}
        </div>

        {/* Share Size Input */}
        <div style={{ padding: "16px 20px" }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.5)" }}>
              ○ SHARE SIZE
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              value={shareSize}
              onChange={(e) => setShareSize(Math.max(0, parseInt(e.target.value) || 0))}
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
            <div style={{ display: "flex", gap: 4 }}>
              {[50, 100, 500, 1000].map((size) => (
                <button
                  key={size}
                  onClick={() => setShareSize(size)}
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
        </div>

        {/* Results */}
        {result && (
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "1fr 1fr",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}>
            {/* Polymarket Side */}
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
                <span style={{ fontSize: 13, fontWeight: 800, color: "rgba(80,160,255,1)" }}>POLYMARKET SIDE</span>
                <span style={{ 
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 800,
                  background: polyBuySide === "YES" ? "rgba(80,200,120,0.2)" : "rgba(255,100,100,0.2)",
                  color: polyBuySide === "YES" ? "rgba(80,200,120,1)" : "rgba(255,100,100,1)",
                }}>
                  {polyBuySide}
                </span>
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <RowItem label="AVG SHARE PRICE" value={formatCents(polyPrice)} />
                <RowItem label="TOTAL COST" value={formatUsd(result.polyCost)} copyValue={result.polyCost.toFixed(2)} />
                <RowItem label="EST. FEE" value="$0" highlight="green" />
                <RowItem label="TOTAL COST (INC. FEES)" value={formatUsd(result.polyTotalCost)} bold />
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10, marginTop: 4 }}>
                  <RowItem 
                    label="TO RETURN" 
                    value={
                      <>
                        {formatUsd(result.toReturn)} 
                        <span style={{ color: "rgba(80,200,120,0.9)", marginLeft: 6, fontSize: 12 }}>
                          [+{formatUsd(result.toReturn - result.polyTotalCost)}]
                        </span>
                      </>
                    } 
                    bold 
                  />
                </div>
              </div>

              <a
                href={row.poly?.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "block",
                  marginTop: 16,
                  padding: "12px",
                  background: "rgba(80,160,255,0.9)",
                  borderRadius: 8,
                  textAlign: "center",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                GO TO POLYMARKET ↗
              </a>
            </div>

            {/* Opinion Side */}
            <div style={{ padding: "16px 20px" }}>
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "space-between",
                marginBottom: 14,
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,140,50,1)" }}>OPINION SIDE</span>
                <span style={{ 
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 800,
                  background: opinionBuySide === "YES" ? "rgba(80,200,120,0.2)" : "rgba(255,100,100,0.2)",
                  color: opinionBuySide === "YES" ? "rgba(80,200,120,1)" : "rgba(255,100,100,1)",
                }}>
                  {opinionBuySide}
                </span>
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <RowItem label="AVG SHARE PRICE" value={formatCents(opinionPrice)} />
                <RowItem label="TOTAL COST" value={formatUsd(result.opinionCost)} copyValue={result.opinionCost.toFixed(2)} />
                <RowItem 
                  label={`EST. FEE (~${result.opinionFeePercentage.toFixed(2)}%)${result.isMinimumFeeApplied ? ' min' : ''}${result.isFeeMaxCapped ? ' max' : ''}`} 
                  value={`~${formatUsd(result.opinionFee)}`} 
                  highlight="orange" 
                />
                <RowItem label="TOTAL COST (INC. FEES)" value={formatUsd(result.opinionTotalCost)} bold />
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10, marginTop: 4 }}>
                  <RowItem 
                    label="TO RETURN" 
                    value={
                      <>
                        {formatUsd(result.toReturn)} 
                        <span style={{ color: "rgba(80,200,120,0.9)", marginLeft: 6, fontSize: 12 }}>
                          [+{formatUsd(result.toReturn - result.opinionTotalCost)}]
                        </span>
                      </>
                    } 
                    bold 
                  />
                </div>
              </div>

              <a
                href={row.opinion?.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "block",
                  marginTop: 16,
                  padding: "12px",
                  background: "rgba(181,83,56,0.9)",
                  borderRadius: 8,
                  textAlign: "center",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                GO TO OPINION ↗
              </a>
            </div>
          </div>
        )}

        {/* NET PNL Summary */}
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

        {/* Referral Section */}
        <div style={{ 
          padding: "14px 20px",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.02)",
        }}>
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={useReferral}
                onChange={(e) => setUseReferral(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <span style={{ fontSize: 15, color: "rgb(255, 255, 255)" }}>
                Use Code on Opinion to get Up To 10% Fee Discount
              </span>
            </div>
            <button 
              onClick={handleCopyReferral}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                background: "rgba(181,83,56,0.3)",
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
              8YfTc9
              <CopyIcon copied={copied} />
            </button>
          </div>
        </div>

        {/* Footer Note */}
        <div style={{ 
          padding: "12px 20px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          fontSize: 14,
          color: "rgb(253, 253, 253)",
          textAlign: "center",
        }}>
          * Opinion Fee applies to Market Order only; Limit Order are not charged.
          <br />
          <br />
          * Minimum Opinion fee is $0.50 if Market Price matched. Fees range from 0% to 2%.
        </div>
      </div>
    </div>
  );
}
