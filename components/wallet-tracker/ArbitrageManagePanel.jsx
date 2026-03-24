"use client";

/**
 * ArbitrageManagePanel Component
 * 
 * A sub-feature panel inside Wallet Tracker for managing arbitrage positions
 * across Opinion and Polymarket exchanges.
 * 
 * Features:
 * - Dual wallet input (Polymarket + Opinion)
 * - "Same wallet" checkbox for mirroring
 * - Wallet validation with inline errors
 * - URL query param persistence for refresh
 * - Tooltip with feature description
 * - Results table with search and sorting (after Track Wallet)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidWalletAddress } from "@/lib/walletTracker/format";
import ArbitrageManageResults from "./ArbitrageManageResults";
import SavedWalletsDropdown, { saveWalletAddress } from "./SavedWallets";

// ============================================================================
// Info Tooltip Component
// ============================================================================

/**
 * InfoTooltip - Shows info icon that displays tooltip on hover/click
 * @param {string} text - Tooltip text content
 */
function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTop, setMobileTop] = useState(96);
  const triggerRef = useRef(null);
  
  const updateMobilePosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const triggerEl = triggerRef.current;
    if (!triggerEl || !triggerEl.getBoundingClientRect) return;
    const rect = triggerEl.getBoundingClientRect();
    const desiredTop = rect.bottom + 10;
    const maxTop = Math.max(72, window.innerHeight - 220);
    const nextTop = Math.max(72, Math.min(desiredTop, maxTop));
    setMobileTop(nextTop);
  }, []);
  
  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkMobile = () => setIsMobile(window.innerWidth <= 600);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  
  // Handle click for mobile devices
  const handleClick = (e) => {
    e.stopPropagation();
    if (isMobile) updateMobilePosition();
    setShow(prev => !prev);
  };
  
  // Close tooltip when clicking outside (for mobile)
  useEffect(() => {
    if (!show) return;
    
    const handleClickOutside = () => setShow(false);
    // Small delay to prevent immediate close on the same click
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [show]);

  useEffect(() => {
    if (!show || !isMobile) return;
    updateMobilePosition();
    const onViewportChange = () => updateMobilePosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [show, isMobile, updateMobilePosition]);
  
  return (
    <div 
      ref={triggerRef}
      style={{ position: "relative", display: "inline-flex", cursor: "help", marginLeft: 8 }}
      onMouseEnter={() => {
        if (!isMobile) setShow(true);
      }}
      onMouseLeave={() => {
        if (!isMobile) setShow(false);
      }}
      onClick={handleClick}
    >
      {/* Info icon (filled circle with "i") */}
      <svg 
        width="18" 
        height="18" 
        viewBox="0 0 24 24" 
        fill="currentColor"
        style={{ color: "rgba(255,255,255,0.6)", transition: "color 0.2s", cursor: "pointer" }}
        onMouseEnter={(e) => e.currentTarget.style.color = "rgba(255,255,255,1)"}
        onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.6)"}
      >
        {/* Filled circle background */}
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15"/>
        {/* Circle outline */}
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        {/* Info text: dot */}
        <circle cx="12" cy="8" r="1.2" fill="currentColor"/>
        {/* Info text: line */}
        <line x1="12" y1="11" x2="12" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      
      {/* Tooltip popup */}
      {show && (
        <div style={{
          position: isMobile ? "fixed" : "absolute",
          bottom: isMobile ? "auto" : "calc(100% + 10px)",
          top: isMobile ? mobileTop : "auto",
          left: isMobile ? 12 : "50%",
          right: isMobile ? 12 : "auto",
          transform: isMobile ? "none" : "translateX(-50%)",
          background: "rgba(20,22,28,0.98)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 13,
          color: "rgba(255,255,255,0.9)",
          lineHeight: 1.6,
          width: isMobile ? "auto" : 300,
          maxWidth: isMobile ? "none" : "90vw",
          whiteSpace: "pre-wrap",
          zIndex: 1200,
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
        >
          {text}
          {/* Arrow pointing down */}
          {!isMobile && (
            <div style={{
              position: "absolute",
              bottom: -7,
              left: "50%",
              transform: "translateX(-50%) rotate(45deg)",
              width: 12,
              height: 12,
              background: "rgba(20,22,28,0.98)",
              borderRight: "1px solid rgba(255,255,255,0.15)",
              borderBottom: "1px solid rgba(255,255,255,0.15)",
            }} />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Search Icon Component
// ============================================================================

function SearchIcon() {
  return (
    <svg 
      width="18" 
      height="18" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2"
      style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }}
    >
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

// ============================================================================
// Main ArbitrageManagePanel Component
// ============================================================================

// ============================================================================
// Exchange Pair Selector Component
// ============================================================================

const EXCHANGE_B_OPTIONS = [
  { value: "opinion", label: "Opinion", logo: "/logo-opinion.svg" },
  { value: "predictfun", label: "Predict.fun", logo: "/predictfun_logo.svg" },
];

function ExchangePairSelector({ exchangeB, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = EXCHANGE_B_OPTIONS.find((o) => o.value === exchangeB) || EXCHANGE_B_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const isPredictFun = exchangeB === "predictfun";
  const accentColor = isPredictFun ? "#8b5cf6" : "#f97316";

  return (
    <div className="exchange-pair-row">
      <div className="exchange-pair-label">EXCHANGE A</div>
      <div className="exchange-pair-label">EXCHANGE B</div>

      {/* Exchange A: Polymarket (fixed) */}
      <div className="exchange-select-fixed">
        <img src="/polymarket_600.svg" alt="" width={15} height={15} style={{ objectFit: "contain", opacity: 0.85, flexShrink: 0 }} />
        <span>Polymarket</span>
      </div>

      {/* Swap icon */}
      <div className="exchange-swap-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "rgba(255,255,255,0.4)" }}>
          <path d="M7 16l-4-4 4-4" /><path d="M17 8l4 4-4 4" /><line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      </div>

      {/* Exchange B: dropdown */}
      <div ref={ref} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="exchange-select-btn"
          style={{ borderColor: open ? accentColor : "rgba(255,255,255,0.13)" }}
        >
          <img src={current.logo} alt="" width={15} height={15} style={{ objectFit: "contain", opacity: 0.85, flexShrink: 0 }} />
          <span style={{ flex: 1, textAlign: "left" }}>{current.label}</span>
          <svg width="9" height="5" viewBox="0 0 10 6" fill="none" style={{ flexShrink: 0, opacity: 0.55, transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none" }}>
            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div className="exchange-dropdown">
            {EXCHANGE_B_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`exchange-dropdown-item ${opt.value === exchangeB ? "selected" : ""}`}
              >
                <img src={opt.logo} alt="" width={15} height={15} style={{ objectFit: "contain", flexShrink: 0 }} />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .exchange-pair-row {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          grid-template-rows: auto auto;
          gap: 4px 12px;
          align-items: center;
          margin-bottom: 20px;
        }
        .exchange-pair-label {
          font-size: 11px;
          font-weight: 600;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .exchange-pair-label:nth-child(2) {
          grid-column: 3;
        }
        .exchange-select-fixed {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          background: rgba(0,0,0,0.32);
          border: 1px solid rgba(255,255,255,0.13);
          border-radius: 8px;
          color: #e9eef5;
          font-size: 13px;
          font-weight: 700;
        }
        .exchange-swap-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          grid-row: 2;
          grid-column: 2;
        }
        .exchange-select-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 8px 7px 10px;
          background: rgba(0,0,0,0.32);
          border: 1px solid rgba(255,255,255,0.13);
          border-radius: 8px;
          color: #e9eef5;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
        }
        .exchange-select-btn:hover {
          background: rgba(255,255,255,0.04);
        }
        .exchange-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: rgba(13,17,27,0.97);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          z-index: 300;
          padding: 3px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.55);
        }
        .exchange-dropdown-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          background: transparent;
          border: none;
          border-radius: 6px;
          color: rgba(255,255,255,0.8);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.1s;
        }
        .exchange-dropdown-item:hover {
          background: rgba(255,255,255,0.06);
        }
        .exchange-dropdown-item.selected {
          background: rgba(255,255,255,0.07);
          color: #fff;
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// Main ArbitrageManagePanel Component
// ============================================================================

export default function ArbitrageManagePanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // -------------------------------------------------------------------------
  // State: Exchange pair selection
  // -------------------------------------------------------------------------
  const [exchangeB, setExchangeB] = useState("predictfun");

  // -------------------------------------------------------------------------
  // State: Wallet inputs and checkbox
  // -------------------------------------------------------------------------
  const [polymarketWallet, setPolymarketWallet] = useState("");
  const [opinionWallet, setOpinionWallet] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // State: Validation errors (shown after blur or submit attempt)
  const [polyError, setPolyError] = useState("");
  const [opinionError, setOpinionError] = useState("");

  // State: Track if user has interacted (to show errors only after blur/submit)
  const [polyTouched, setPolyTouched] = useState(false);
  const [opinionTouched, setOpinionTouched] = useState(false);

  // State: Submission status (shows results table when true)
  const [submitted, setSubmitted] = useState(false);

  // Derived: color scheme based on exchangeB
  const isPredictFun = exchangeB === "predictfun";
  const accentColor = isPredictFun ? "#8b5cf6" : "#f97316";
  const accentGradient = isPredictFun
    ? "linear-gradient(90deg, #a78bfa 0%, #8b5cf6 100%)"
    : "linear-gradient(90deg, #ffaf89 0%, #f97316 100%)";
  const accentShadow = isPredictFun
    ? "rgba(139, 92, 246, 0.3)"
    : "rgba(249, 115, 22, 0.3)";
  const accentFocusShadow = isPredictFun
    ? "0 0 0 2px rgba(139, 92, 246, 0.2)"
    : "0 0 0 2px rgba(249, 115, 22, 0.2)";

  // -------------------------------------------------------------------------
  // Initialize state from URL query params on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    const polyParam = searchParams.get("poly") || "";
    const opinionParam = searchParams.get("opinion") || "";
    const exchangeBParam = searchParams.get("exchangeB") || "";

    if (exchangeBParam === "predictfun") {
      setExchangeB("predictfun");
    }

    if (polyParam) {
      setPolymarketWallet(polyParam);

      // If we have a valid poly wallet from URL, auto-show results
      if (isValidWalletAddress(polyParam)) {
        setSubmitted(true);
      }
    }

    if (opinionParam) {
      setOpinionWallet(opinionParam);
    }
  }, [searchParams]);
  
  // -------------------------------------------------------------------------
  // Validation helper
  // -------------------------------------------------------------------------
  const validateWallet = useCallback((address) => {
    if (!address.trim()) {
      return "Wallet address is required";
    }
    if (!isValidWalletAddress(address.trim())) {
      return "Invalid address format. Must be 0x followed by 40 hex characters.";
    }
    return ""; // No error
  }, []);
  
  // -------------------------------------------------------------------------
  // Check if form is valid (for button disabled state)
  // -------------------------------------------------------------------------
  const isFormValid = useCallback(() => {
    const polyValid = isValidWalletAddress(polymarketWallet.trim());
    const opinionValid = isValidWalletAddress(opinionWallet.trim());
    return polyValid && opinionValid;
  }, [polymarketWallet, opinionWallet]);
  
  // -------------------------------------------------------------------------
  // Handle Polymarket wallet input change
  // -------------------------------------------------------------------------
  const handlePolyChange = (e) => {
    const value = e.target.value;
    setPolymarketWallet(value);
    
    // Clear error if user is typing
    if (polyError) setPolyError("");
    
    // Reset submission state when editing
    if (submitted) setSubmitted(false);
  };
  
  // -------------------------------------------------------------------------
  // Handle Opinion wallet input change
  // -------------------------------------------------------------------------
  const handleOpinionChange = (e) => {
    const value = e.target.value;
    setOpinionWallet(value);
    
    // Clear error if user is typing
    if (opinionError) setOpinionError("");
    
    // Reset submission state when editing
    if (submitted) setSubmitted(false);
  };
  
  // -------------------------------------------------------------------------
  // Handle blur (validate on blur)
  // -------------------------------------------------------------------------
  const handlePolyBlur = () => {
    setPolyTouched(true);
    const error = validateWallet(polymarketWallet);
    setPolyError(error);
  };
  
  const handleOpinionBlur = () => {
    setOpinionTouched(true);
    const error = validateWallet(opinionWallet);
    setOpinionError(error);
  };
  
  // -------------------------------------------------------------------------
  // Update URL query params (for persistence on refresh)
  // -------------------------------------------------------------------------
  const updateQueryParams = useCallback((poly, opinion, exB) => {
    const params = new URLSearchParams();

    if (poly) params.set("poly", poly);
    if (opinion) params.set("opinion", opinion);
    if (exB && exB !== "opinion") params.set("exchangeB", exB);

    // Add "tab" param to keep the current tab selected
    params.set("tab", "arbitrage");

    const queryString = params.toString();
    const newUrl = queryString ? `?${queryString}` : "";

    // Replace current URL without navigation (keeps state on refresh)
    window.history.replaceState(null, "", `/wallet${newUrl}`);
  }, []);
  
  // -------------------------------------------------------------------------
  // Handle Track Wallet button click
  // -------------------------------------------------------------------------
  const handleTrackWallet = (e) => {
    e.preventDefault();
    
    // Mark all fields as touched to show any errors
    setPolyTouched(true);
    setOpinionTouched(true);
    
    // Validate polymarket wallet
    const polyErr = validateWallet(polymarketWallet);
    setPolyError(polyErr);
    
    // Validate opinion wallet
    const opinionErr = validateWallet(opinionWallet);
    setOpinionError(opinionErr);
    
    // If any errors, don't proceed
    if (polyErr || opinionErr) {
      return;
    }
    
    // Save to URL query params for refresh persistence
    const finalPoly = polymarketWallet.trim();
    const finalOpinion = opinionWallet.trim();
    updateQueryParams(finalPoly, finalOpinion, exchangeB);
    
    // Save wallets to localStorage for future use
    saveWalletAddress(finalPoly);
    saveWalletAddress(finalOpinion);

    setSubmitted(true);
  };
  
  // -------------------------------------------------------------------------
  // Tooltip text
  // -------------------------------------------------------------------------
  const exchangeBLabel = isPredictFun ? "Predict.fun" : "Opinion";
  const tooltipText = `Track and manage arbitrage positions across ${exchangeBLabel} and Polymarket in one place. View matched markets, arbitrage %, current & potential PnL, and exit status.`;
  
  // -------------------------------------------------------------------------
  // Handle "Edit Wallets" to go back to input form
  // -------------------------------------------------------------------------
  const handleEditWallets = () => {
    setSubmitted(false);
  };
  
  // -------------------------------------------------------------------------
  // Handle Refresh button click
  // -------------------------------------------------------------------------
  const handleRefresh = () => {
    setIsRefreshing(true);
    window.location.reload();
  };
  
  // -------------------------------------------------------------------------
  // Get final wallet addresses for results
  // -------------------------------------------------------------------------
  const getFinalWallets = () => {
    const finalPoly = polymarketWallet.trim();
    const finalOpinion = opinionWallet.trim();
    return { polyWallet: finalPoly, opinionWallet: finalOpinion };
  };
  
  // -------------------------------------------------------------------------
  // Render: Show Results if submitted, otherwise show Input Form
  // -------------------------------------------------------------------------
  
  // RESULTS VIEW: Show after Track Wallet is clicked
  if (submitted) {
    const { polyWallet, opinionWallet: opWallet } = getFinalWallets();
    
    return (
      <div className="arb-results-page">
        {/* Header with title and Edit button */}
        <div className="arb-results-header">
          <div className="arb-results-title-row">
            <h1 className="arb-results-title">Arbitrage Manage</h1>
            <InfoTooltip text={tooltipText} />
          </div>
          
          {/* Wallet info and buttons */}
          <div className="arb-wallet-info">
            <div className="arb-wallet-badge">
              <span className="arb-wallet-label">Tracking:</span>
              <span className="arb-wallet-addr">{polyWallet.slice(0, 6)}...{polyWallet.slice(-4)}</span>
            </div>
            <div className="arb-button-group">
              <button 
                className="arb-refresh-btn" 
                onClick={handleRefresh}
                disabled={isRefreshing}
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
                  <path d="M23 4v6h-6"/>
                  <path d="M1 20v-6h6"/>
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                </svg>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button className="arb-edit-btn" onClick={handleEditWallets}>
                Edit Wallets
              </button>
            </div>
          </div>
        </div>
        
        {/* Results Table */}
        <ArbitrageManageResults
          polyWallet={polyWallet}
          opinionWallet={opWallet}
          exchangeB={exchangeB}
        />
        
        <style jsx>{`
          .arb-results-page {
            width: 100%;
            min-height: 100vh;
          }
          
          .arb-results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            flex-wrap: wrap;
            gap: 16px;
          }
          
          .arb-results-title-row {
            display: flex;
            align-items: center;
          }
          
          .arb-results-title {
            font-size: 24px;
            font-weight: 700;
            color: var(--text, #fff);
            margin: 0;
          }
          
          .arb-wallet-info {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;
          }
          
          .arb-wallet-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            font-size: 13px;
          }
          
          .arb-wallet-label {
            color: rgba(255,255,255,0.5);
          }
          
          .arb-wallet-addr {
            color: #fff;
            font-family: 'Space Mono', monospace;
          }
          
          .arb-button-group {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .arb-refresh-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: rgba(255, 255, 255, 0.7);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
          }
          
          .arb-refresh-btn:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
          }
          
          .arb-refresh-btn:disabled {
            color: rgba(255, 255, 255, 0.4);
            cursor: not-allowed;
          }
          
          @keyframes spin {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }
          
          .arb-edit-btn {
            padding: 8px 16px;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: rgba(255, 255, 255, 0.7);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
          }
          
          .arb-edit-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
          }

          @media (min-width: 1800px) {
            .arb-results-title {
              font-size: 28px;
            }

            .arb-wallet-badge,
            .arb-refresh-btn,
            .arb-edit-btn {
              font-size: 14px;
            }
          }
          
          @media (max-width: 600px) {
            .arb-results-header {
              flex-direction: column;
              align-items: flex-start;
            }
            
            .arb-results-title {
              font-size: 20px;
            }
          }
        `}</style>
      </div>
    );
  }
  
  // INPUT FORM VIEW: Default view for entering wallet addresses
  return (
    <div className="arb-manage-container">
      {/* Page Title with Info Icon */}
      <div className="arb-title-row">
        <h1 className="arb-title">Arbitrage Manage</h1>
        <InfoTooltip text={tooltipText} />
      </div>
      
      {/* Exchange Pair Selector */}
      <ExchangePairSelector exchangeB={exchangeB} onChange={(v) => { setExchangeB(v); if (submitted) setSubmitted(false); }} />

      {/* Wallet Input Card */}
      <div className={`arb-card ${isPredictFun ? "arb-card-pf" : ""}`} style={{ borderColor: accentColor }}>
        {/* Polymarket Wallet Section */}
        <div className="arb-input-section">
          <label className="arb-input-label">Polymarket Wallet <span className="arb-label-note">(Proxy Wallet)</span></label>
          <div style={{ position: "relative" }}>
            <SavedWalletsDropdown 
              onSelect={(wallet) => setPolymarketWallet(wallet)}
              currentValue={polymarketWallet}
            />
          </div>
          <div className={`arb-input-wrapper ${polyError && polyTouched ? "error" : ""}`} {...(isPredictFun ? {"data-pf": ""} : {})}>
            <SearchIcon />
            <input
              type="text"
              value={polymarketWallet}
              onChange={handlePolyChange}
              onBlur={handlePolyBlur}
              placeholder="Enter proxy wallet address (0x…)"
              className="arb-input"
              spellCheck="false"
              autoComplete="off"
            />
          </div>
          <div className="arb-proxy-hint">
            💡 Find your proxy wallet at <a href="https://polymarket.com/profile" target="_blank" rel="noopener noreferrer">polymarket.com/profile</a> → Deposit/Withdraw → Your wallet address
          </div>
          
          <div style={{ marginTop: 12, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
            <img 
              src="/wallet track/polytuto.png" 
              alt="Polymarket Proxy Wallet Tutorial" 
              style={{ width: "100%", display: "block" }} 
            />
          </div>

          {polyError && polyTouched && (
            <div className="arb-error">{polyError}</div>
          )}
        </div>
        
        {/* Divider */}
        <div className="arb-divider" />
        
        {/* Exchange B Wallet Section */}
        <div className="arb-input-section">
          <label className="arb-input-label">{exchangeBLabel} Wallet</label>
          <div style={{ position: "relative" }}>
            <SavedWalletsDropdown
              onSelect={(wallet) => setOpinionWallet(wallet)}
              currentValue={opinionWallet}
            />
          </div>
          <div className={`arb-input-wrapper ${opinionError && opinionTouched ? "error" : ""}`} {...(isPredictFun ? {"data-pf": ""} : {})}>
            <SearchIcon />
            <input
              type="text"
              value={opinionWallet}
              onChange={handleOpinionChange}
              onBlur={handleOpinionBlur}
              placeholder="Enter wallet address (0x…)"
              className="arb-input"
              spellCheck="false"
              autoComplete="off"
            />
          </div>

          {!isPredictFun && (
            <div style={{ marginTop: 12, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
              <img
                src="/wallet track/optuto.png"
                alt="Opinion Wallet Tutorial"
                style={{ width: "100%", display: "block" }}
              />
            </div>
          )}

          <div className="arb-proxy-hint">
            💡 {isPredictFun ? "Find your Predict Smart Wallet at Portfolio → Predict Smart Wallet → Your wallet address" : "Find your wallet by click on Profile icon → Your wallet address"}
          </div>

          {opinionError && opinionTouched && (
            <div className="arb-error">{opinionError}</div>
          )}
        </div>

        {/* Track Wallet Button */}
        <button
          type="button"
          onClick={handleTrackWallet}
          disabled={!isFormValid()}
          className="arb-track-btn"
          style={{ background: accentGradient }}
        >
          Track Wallet
        </button>
      </div>
      
      {/* Inline Styles */}
      <style jsx>{`
        .arb-manage-container {
          max-width: 500px;
          margin: 0 auto;
          padding: 40px 20px;
        }
        
        /* Title Row */
        .arb-title-row {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }
        
        .arb-title {
          font-size: 28px;
          font-weight: 700;
          color: var(--text, #fff);
          margin: 0;
        }
        
        /* Card */
        .arb-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid;
          border-radius: 16px;
          padding: 24px;
        }
        
        /* Input Section */
        .arb-input-section {
          margin-bottom: 20px;
        }
        
        .arb-input-section:last-of-type {
          margin-bottom: 24px;
        }
        
        .arb-input-label {
          display: block;
          font-size: 14px;
          font-weight: 600;
          color: var(--text, #fff);
          margin-bottom: 10px;
        }
        
        .arb-input-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid;
          border-color: #f97316;
          border-radius: 12px;
          padding: 14px 16px;
          transition: border-color 0.15s, opacity 0.15s, box-shadow 0.15s;
        }
        
        .arb-input-wrapper.error {
          border-color: var(--danger, #ef4444);
        }
        
        .arb-input-wrapper.disabled {
          opacity: 0.6;
          background: rgba(255, 255, 255, 0.02);
        }
        
        .arb-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          color: var(--text, #fff);
          font-size: 14px;
          font-family: 'Space Mono', monospace;
          min-width: 0;
        }
        
        .arb-input::placeholder {
          color: var(--muted, rgba(255,255,255,0.4));
          font-family: inherit;
        }
        
        .arb-input:disabled {
          color: var(--muted, rgba(255,255,255,0.5));
          cursor: not-allowed;
        }
        
        /* Error message */
        .arb-error {
          color: var(--danger, #ef4444);
          font-size: 12px;
          margin-top: 8px;
          padding-left: 4px;
        }
        
        /* Hint message (for auto-fill) */
        .arb-hint {
          color: var(--muted, rgba(255,255,255,0.5));
          font-size: 12px;
          margin-top: 8px;
          padding-left: 4px;
          font-style: italic;
        }
        
        /* Proxy wallet hint */
        .arb-proxy-hint {
          color: rgba(255,255,255,0.45);
          font-size: 12px;
          margin-top: 8px;
          padding-left: 4px;
        }
        
        .arb-proxy-hint a {
          color: var(--accent, #22c55e);
          text-decoration: none;
        }
        
        .arb-proxy-hint a:hover {
          text-decoration: underline;
        }
        
        /* Label note (smaller text in label) */
        .arb-label-note {
          color: rgba(255,255,255,0.4);
          font-size: 11px;
          font-weight: normal;
          margin-left: 4px;
        }
        
        /* Divider */
        .arb-divider {
          height: 1px;
          background: var(--border, rgba(255,255,255,0.1));
          margin: 20px 0;
        }
        
        /* Track Wallet Button */
        .arb-track-btn {
          width: 100%;
          border: none;
          border-radius: 12px;
          padding: 16px 24px;
          color: white;
          text-shadow:
            0 1px 2px rgba(0, 0, 0, 0.2),
            0 0 0.5px rgba(0, 0, 0, 0.9),
            0 0 1px rgba(0, 0, 0, 0.9);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .arb-track-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(139, 92, 246, 0.3);
          filter: brightness(1.1);
        }
        
        .arb-track-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        
        .arb-track-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        /* Responsive adjustments */
        @media (max-width: 500px) {
          .arb-manage-container {
            padding: 30px 16px;
          }
          
          .arb-title {
            font-size: 24px;
          }
          
          .arb-card {
            padding: 20px 16px;
          }
          
          .arb-input-wrapper {
            padding: 12px 14px;
          }
        }
      `}</style>
      <style jsx global>{`
        .arb-input-wrapper[data-pf] {
          border-color: #8b5cf6 !important;
        }
      `}</style>
    </div>
  );
}
