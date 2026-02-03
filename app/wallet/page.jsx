"use client";

/**
 * Wallet Tracker Landing Page
 * 
 * Route: /wallet
 * 
 * Allows users to enter a wallet address to view their positions and activity.
 * Now includes tabs for:
 *   - "Opinion Wallet Track" (default, original behavior)
 *   - "Arbitrage Manage" (new sub-feature)
 */

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidWalletAddress } from "@/lib/walletTracker/format";
import ArbitrageManagePanel from "@/components/wallet-tracker/ArbitrageManagePanel";

// Tab constants
const TAB_OPINION = "opinion";
const TAB_ARBITRAGE = "arbitrage";

// Inner component that uses useSearchParams
function WalletLandingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // -------------------------------------------------------------------------
  // Tab state: read from URL params, default to "opinion"
  // -------------------------------------------------------------------------
  const [activeTab, setActiveTab] = useState(TAB_OPINION);
  
  // Initialize tab from URL query param on mount
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === TAB_ARBITRAGE) {
      setActiveTab(TAB_ARBITRAGE);
    } else {
      setActiveTab(TAB_OPINION);
    }
  }, [searchParams]);
  
  // Handle tab change
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    
    // Update URL to reflect tab choice (preserves other params if any)
    const params = new URLSearchParams(searchParams.toString());
    if (tab === TAB_OPINION) {
      params.delete("tab"); // Default tab, no need for param
      // Also clear arbitrage-specific params when switching away
      params.delete("poly");
      params.delete("opinion");
      params.delete("same");
    } else {
      params.set("tab", tab);
    }
    
    const queryString = params.toString();
    const newUrl = queryString ? `/wallet?${queryString}` : "/wallet";
    window.history.replaceState(null, "", newUrl);
  };
  
  // -------------------------------------------------------------------------
  // Original Opinion Wallet Track state
  // -------------------------------------------------------------------------
  const [walletInput, setWalletInput] = useState("");
  const [error, setError] = useState("");
  
  const handleSubmit = (e) => {
    e.preventDefault();
    
    const trimmed = walletInput.trim();
    
    if (!trimmed) {
      setError("Please enter a wallet address");
      return;
    }
    
    if (!isValidWalletAddress(trimmed)) {
      setError("Invalid wallet address. Please enter a valid Ethereum/BSC address (0x followed by 40 hex characters)");
      return;
    }
    
    setError("");
    router.push(`/wallet/${trimmed}`);
  };
  
  const handleInputChange = (e) => {
    setWalletInput(e.target.value);
    if (error) setError("");
  };
  
  // Example wallets for quick access (can be removed in production)
  const exampleWallets = [
    { label: "Example Wallet 1", address: "0x0000000000000000000000000000000000000001" },
  ];
  
  return (
    <div className="container">
      {/* Tab Selector */}
      <div className="wallet-tabs">
        <button
          className={`wallet-tab ${activeTab === TAB_OPINION ? "active" : ""}`}
          onClick={() => handleTabChange(TAB_OPINION)}
        >
          Opinion Wallet Track
        </button>
        <button
          className={`wallet-tab ${activeTab === TAB_ARBITRAGE ? "active" : ""}`}
          onClick={() => handleTabChange(TAB_ARBITRAGE)}
        >
          Arbitrage Manage
        </button>
      </div>
      
      {/* Conditional Content based on active tab */}
      {activeTab === TAB_ARBITRAGE ? (
        <ArbitrageManagePanel />
      ) : (
        <div className="wallet-landing">
          {/* Hero Section */}
          <div className="wallet-hero">
            <div className="wallet-hero-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                <line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
            </div>
            <h1 className="wallet-hero-title">Wallet Tracker</h1>
            <p className="wallet-hero-desc">
              Track Opinion wallet's positions, PnL, and trading activity.
            </p>
          </div>
        
          {/* Search Form */}
          <form onSubmit={handleSubmit} className="wallet-search-form">
            <div className="wallet-input-wrapper">
              <svg 
                width="20" 
                height="20" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              className="wallet-input-icon"
            >
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={walletInput}
              onChange={handleInputChange}
              placeholder="Enter wallet address (0x...)"
              className="wallet-input"
              autoFocus
            />
          </div>
          
          {error && (
            <div className="wallet-error">{error}</div>
          )}
          
          <button type="submit" className="wallet-search-btn">
            Track Wallet
          </button>
        </form>
        
        {/* Features */}
        <div className="wallet-features">
          <div className="wallet-feature">
            <div className="feature-icon">📊</div>
            <div className="feature-title">Active Positions</div>
            <div className="feature-desc">View current positions with real-time value and PnL</div>
          </div>
          <div className="wallet-feature">
            <div className="feature-icon">📈</div>
            <div className="feature-title">Closed Positions</div>
            <div className="feature-desc">Analyze historical trades and realized profits</div>
          </div>
          <div className="wallet-feature">
            <div className="feature-icon">⚡</div>
            <div className="feature-title">Activity Feed</div>
            <div className="feature-desc">See all buy/sell trades with timestamps</div>
          </div>
        </div>
        
        {/* Info */}
        <div className="wallet-info">
          <p>
            <strong>Supported Network:</strong> BSC (Chain ID: 56)
          </p>
          <p>
            Data is fetched from Opinion OpenAPI. Positions and trades update in real-time.
          </p>
        </div>
      </div>
      )}
      
      <style jsx>{`
        /* Tab Selector Styles */
        .wallet-tabs {
          display: flex;
          justify-content: center;
          gap: 8px;
          padding: 20px 20px 0;
          max-width: 600px;
          margin: 0 auto;
        }
        
        .wallet-tab {
          flex: 1;
          max-width: 200px;
          padding: 12px 20px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          border-radius: 10px;
          color: var(--muted);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .wallet-tab:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text);
        }
        
        .wallet-tab.active {
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 211, 238, 0.15));
          border-color: var(--accent);
          color: var(--text);
          font-weight: 600;
        }
        
        /* Original wallet-landing styles */
        .wallet-landing {
          max-width: 600px;
          margin: 0 auto;
          padding: 60px 20px;
        }
        
        .wallet-hero {
          text-align: center;
          margin-bottom: 40px;
        }
        
        .wallet-hero-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 80px;
          height: 80px;
          border-radius: 20px;
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 211, 238, 0.15));
          color: var(--accent);
          margin-bottom: 20px;
        }
        
        .wallet-hero-title {
          font-size: 32px;
          font-weight: 700;
          margin: 0 0 12px;
          color: var(--text);
        }
        
        .wallet-hero-desc {
          font-size: 16px;
          color: var(--muted);
          margin: 0;
        }
        
        .wallet-search-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 40px;
        }
        
        .wallet-input-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 14px 16px;
          transition: border-color 0.15s;
        }
        
        .wallet-input-wrapper:focus-within {
          border-color: var(--accent);
        }
        
        .wallet-input-icon {
          color: var(--muted);
          flex-shrink: 0;
        }
        
        .wallet-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          color: var(--text);
          font-size: 15px;
          font-family: monospace;
        }
        
        .wallet-input::placeholder {
          color: var(--muted);
          font-family: inherit;
        }
        
        .wallet-error {
          color: var(--danger);
          font-size: 13px;
          padding: 0 4px;
        }
        
        .wallet-search-btn {
          background: linear-gradient(135deg, var(--accent), #16a34a);
          border: none;
          border-radius: 12px;
          padding: 14px 24px;
          color: white;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .wallet-search-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
        }
        
        .wallet-search-btn:active {
          transform: translateY(0);
        }
        
        .wallet-features {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 40px;
        }
        
        .wallet-feature {
          text-align: center;
          padding: 20px 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border);
          border-radius: 12px;
        }
        
        .feature-icon {
          font-size: 28px;
          margin-bottom: 10px;
        }
        
        .feature-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 6px;
        }
        
        .feature-desc {
          font-size: 11px;
          color: var(--muted);
          line-height: 1.4;
        }
        
        .wallet-info {
          text-align: center;
          font-size: 12px;
          color: var(--muted);
        }
        
        .wallet-info p {
          margin: 8px 0;
        }
        
        @media (max-width: 500px) {
          .wallet-tabs {
            padding: 16px 16px 0;
            gap: 6px;
          }
          
          .wallet-tab {
            padding: 10px 14px;
            font-size: 13px;
          }
          
          .wallet-features {
            grid-template-columns: 1fr;
          }
          
          .wallet-hero-title {
            font-size: 26px;
          }
        }
      `}</style>
    </div>
  );
}

// Main export wrapped in Suspense
export default function WalletLandingPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>
        <div style={{ color: "var(--muted)", fontSize: 14 }}>Loading...</div>
      </div>
    }>
      <WalletLandingContent />
    </Suspense>
  );
}
