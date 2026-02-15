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
import OpinionWalletLanding from "@/components/wallet-tracker/OpinionWalletLanding";
import SavedWalletsDropdown, { saveWalletAddress } from "@/components/wallet-tracker/SavedWallets";

// Tab constants
const TAB_OPINION = "opinion";
const TAB_ARBITRAGE = "arbitrage";

// Inner component that uses useSearchParams
function WalletLandingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // -------------------------------------------------------------------------
  // Mobile detection
  // -------------------------------------------------------------------------
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  
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
    
    // Save wallet to localStorage for future use
    saveWalletAddress(trimmed);
    
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
    <div className="container wallet-page-container" style={isMobile ? { padding: "2px 12px" } : {}}>
      {/* Tab Selector */}
      <div className="wallet-tabs" style={isMobile ? { padding: 0, gap: 4, marginBottom: 0 } : {}}>
        <button
          className={`wallet-tab ${activeTab === TAB_OPINION ? "active" : ""}`}
          onClick={() => handleTabChange(TAB_OPINION)}
          style={isMobile ? { padding: "6px 10px", fontSize: 12 } : {}}
        >
          Opinion Wallet Track
        </button>
        <button
          className={`wallet-tab ${activeTab === TAB_ARBITRAGE ? "active" : ""}`}
          onClick={() => handleTabChange(TAB_ARBITRAGE)}
          style={isMobile ? { padding: "6px 10px", fontSize: 12 } : {}}
        >
          Arbitrage Manage
        </button>
      </div>
      
      {/* Conditional Content based on active tab */}
      {activeTab === TAB_ARBITRAGE ? (
        <ArbitrageManagePanel />
      ) : (
        <div className="wallet-landing" style={isMobile ? { padding: 0 } : {}}>
          {/* Title Section */}
          <div className="wallet-header-wrapper" style={isMobile ? { marginBottom: 2, marginTop: -8 } : {}}>
            <h1 className="wallet-main-title">
              Wallet Tracker
            </h1>
            <p className="wallet-subtitle">
              Track active/closed positions and history trades on Opinion.
            </p>
          </div>

          {/* Search Form */}
          <form
            onSubmit={handleSubmit}
            className="wallet-search-form"
            style={isMobile ? { marginTop: 28, marginBottom: 8, gap: 6 } : {}}
          >
            <div style={{ position: "relative" }}>
              <SavedWalletsDropdown 
                onSelect={(wallet) => setWalletInput(wallet)}
                currentValue={walletInput}
              />
              <div className="wallet-input-wrapper" style={isMobile ? { padding: "8px 10px" } : {}}>
                <svg 
                  width={isMobile ? "16" : "20"}
                  height={isMobile ? "16" : "20"}
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
                  style={isMobile ? { fontSize: 13 } : {}}
                />
              </div>
            </div>
            
            {error && (
              <div className="wallet-error">{error}</div>
            )}
            
            <button type="submit" className="wallet-search-btn" style={isMobile ? { padding: "8px 16px", fontSize: 13 } : {}}>
              Track Wallet
            </button>
          </form>

          {/* Hero Section (Showcase) */}
          <OpinionWalletLanding />
        </div>
      )}
      
      <style jsx>{`
        /* Tab Selector Styles */
        .wallet-tabs {
          display: flex;
          justify-content: center;
          gap: 8px;
          padding: 1px 1px 0;
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
          background: linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(251, 146, 60, 0.15));
          border-color: #f97316;
          color: var(--text);
          font-weight: 600;
        }
        
        /* Original wallet-landing styles */
        .wallet-landing {
          max-width: 600px;
          margin: 0 auto;
          padding: 1px 20px;
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
          border: 1px solid #f97316;
          border-radius: 12px;
          padding: 14px 16px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        
        .wallet-input-wrapper:focus-within {
          box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
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
          font-family: 'Space Mono', monospace;
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
          background: linear-gradient(90deg, #ffaf89 0%, #f97316 100%);
          border: none;
          border-radius: 12px;
          padding: 14px 24px;
          color: white;
          text-shadow:
            0 3px 5px rgba(0, 0, 0, 0.2),
            0 0 0.5px rgba(0, 0, 0, 0.9),
            0 0 5px rgba(0, 0, 0, 0.9);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .wallet-search-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
          filter: brightness(1.1);
        }
        
        .wallet-search-btn:active {
          transform: translateY(0);
        }

        .wallet-header-wrapper {
          text-align: center;
          margin-top: 12px;
          margin-bottom: 16px;
        }

        .wallet-main-title {
          font-size: 28px;
          font-weight: 800;
          color: #fff;
          margin: 0 0 8px;
          letter-spacing: -0.5px;
          line-height: 1.2;
        }

        .wallet-subtitle {
          font-size: 15px;
          color: rgba(255,255,255,0.5);
          font-weight: 500;
          margin: 0;
          line-height: 1.35;
        }

        .wallet-search-form {
          margin-bottom: 24px;
        }

        @media (min-width: 1800px) {
          .wallet-tabs {
            max-width: 760px;
            gap: 12px;
          }

          .wallet-tab {
            max-width: 260px;
            padding: 14px 22px;
            font-size: 16px;
            font-weight: 600;
          }
        }
        
        @media (max-width: 768px) {
          .wallet-page-container {
            padding: 4px 12px !important;
          }

          .wallet-tabs {
            padding: 0;
            gap: 4px;
            margin-bottom: 0;
          }
          
          .wallet-tab {
            padding: 6px 10px;
            font-size: 12px;
          }

          .wallet-landing {
            padding: 0;
          }

          .wallet-header-wrapper {
            margin-bottom: 2px;
            margin-top: -8px;
          }

          .wallet-main-title {
            font-size: 24px;
            margin: 0 0 4px;
            line-height: 1.2;
          }

          .wallet-subtitle {
            font-size: 12px;
            margin: 0;
            line-height: 1.35;
          }

          .wallet-search-form {
            margin-bottom: 8px;
            gap: 6px;
          }

          .wallet-input-wrapper {
            padding: 8px 10px;
          }

          .wallet-search-btn {
            padding: 8px 16px;
            font-size: 13px;
          }
          
          .wallet-hero-title {
            font-size: 20px;
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
