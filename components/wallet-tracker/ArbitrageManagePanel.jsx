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

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidWalletAddress } from "@/lib/walletTracker/format";
import ArbitrageManageResults from "./ArbitrageManageResults";

// ============================================================================
// Info Tooltip Component
// ============================================================================

/**
 * InfoTooltip - Shows info icon that displays tooltip on hover/click
 * @param {string} text - Tooltip text content
 */
function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  
  // Handle click for mobile devices
  const handleClick = (e) => {
    e.stopPropagation();
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
  
  return (
    <div 
      style={{ position: "relative", display: "inline-flex", cursor: "help", marginLeft: 8 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={handleClick}
    >
      {/* Info icon (circle with "i") */}
      <svg 
        width="18" 
        height="18" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="rgba(255,255,255,0.5)" 
        strokeWidth="2"
        style={{ transition: "stroke 0.15s" }}
      >
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      
      {/* Tooltip popup */}
      {show && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 10px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(20,22,28,0.98)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 13,
          color: "rgba(255,255,255,0.9)",
          lineHeight: 1.6,
          width: 300,
          maxWidth: "90vw",
          whiteSpace: "pre-wrap",
          zIndex: 1000,
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        }}>
          {text}
          {/* Arrow pointing down */}
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

export default function ArbitrageManagePanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
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
  
  // -------------------------------------------------------------------------
  // Initialize state from URL query params on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    const polyParam = searchParams.get("poly") || "";
    const opinionParam = searchParams.get("opinion") || "";
    
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
  const updateQueryParams = useCallback((poly, opinion) => {
    const params = new URLSearchParams();
    
    if (poly) params.set("poly", poly);
    if (opinion) params.set("opinion", opinion);
    
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
    updateQueryParams(finalPoly, finalOpinion);
    
    // For now, just show a placeholder message
    // (Real scanning logic will be implemented next)
    setSubmitted(true);
  };
  
  // -------------------------------------------------------------------------
  // Tooltip text
  // -------------------------------------------------------------------------
  const tooltipText = "Track and manage arbitrage positions across Opinion and Polymarket in one place. View matched markets, arbitrage %, current & potential PnL, and exit status.";
  
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
            font-family: monospace;
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
      
      {/* Wallet Input Card */}
      <div className="arb-card">
        {/* Polymarket Wallet Section */}
        <div className="arb-input-section">
          <label className="arb-input-label">Polymarket Wallet <span className="arb-label-note">(Proxy Wallet)</span></label>
          <div className={`arb-input-wrapper ${polyError && polyTouched ? "error" : ""}`}>
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
          {polyError && polyTouched && (
            <div className="arb-error">{polyError}</div>
          )}
        </div>
        
        {/* Divider */}
        <div className="arb-divider" />
        
        {/* Opinion Wallet Section */}
        <div className="arb-input-section">
          <label className="arb-input-label">Opinion Wallet</label>
          <div className={`arb-input-wrapper ${opinionError && opinionTouched ? "error" : ""}`}>
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
          border: 1px solid var(--border, rgba(255,255,255,0.1));
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
          border: 1px solid var(--border, rgba(255,255,255,0.1));
          border-radius: 12px;
          padding: 14px 16px;
          transition: border-color 0.15s, opacity 0.15s;
        }
        
        .arb-input-wrapper:focus-within {
          border-color: var(--accent, #22c55e);
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
          font-family: monospace;
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
          background: linear-gradient(135deg, var(--accent, #22c55e), #16a34a);
          border: none;
          border-radius: 12px;
          padding: 16px 24px;
          color: white;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .arb-track-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(34, 197, 94, 0.35);
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
    </div>
  );
}
