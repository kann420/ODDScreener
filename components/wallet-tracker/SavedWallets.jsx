"use client";

/**
 * SavedWallets Component
 * 
 * Manages saved wallet addresses in localStorage with dropdown UI
 */

import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "oddscreeners_saved_wallets";
const MAX_SAVED = 5;

/**
 * Get saved wallets from localStorage
 */
export function getSavedWallets() {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

/**
 * Save a new wallet address to localStorage
 */
export function saveWalletAddress(address) {
  if (typeof window === "undefined" || !address) return;
  
  try {
    const trimmed = address.trim().toLowerCase();
    let saved = getSavedWallets();
    
    // Remove if already exists (to move to top)
    saved = saved.filter(w => w !== trimmed);
    
    // Add to front
    saved.unshift(trimmed);
    
    // Keep only MAX_SAVED
    saved = saved.slice(0, MAX_SAVED);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (err) {
    console.error("[SavedWallets] Error saving:", err);
  }
}

/**
 * SavedWalletsDropdown Component
 * Shows dropdown with saved addresses when input is focused
 */
export default function SavedWalletsDropdown({ onSelect, currentValue }) {
  const [show, setShow] = useState(false);
  const [savedWallets, setSavedWallets] = useState([]);
  const dropdownRef = useRef(null);
  
  // Load saved wallets on mount
  useEffect(() => {
    setSavedWallets(getSavedWallets());
  }, []);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    if (!show) return;
    
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShow(false);
      }
    };
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [show]);
  
  // Filter out current value and empty wallets
  const filteredWallets = savedWallets.filter(w => w && w !== currentValue?.trim().toLowerCase());
  
  if (filteredWallets.length === 0) {
    return null;
  }
  
  return (
    <div ref={dropdownRef} style={{ position: "absolute", top: -28, right: 0, zIndex: 50 }}>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setShow(!show)}
        style={{
          padding: "4px 10px",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          color: "rgba(255,255,255,0.6)",
          fontSize: 11,
          cursor: "pointer",
          transition: "all 0.15s",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.08)";
          e.currentTarget.style.color = "rgba(255,255,255,0.9)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          e.currentTarget.style.color = "rgba(255,255,255,0.6)";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        Saved ({filteredWallets.length})
      </button>
      
      {/* Dropdown */}
      {show && (
        <div 
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 280,
            background: "rgba(20,22,28,0.98)",
            border: "1px solid #f97316",
            borderRadius: 12,
            padding: "8px 0",
            zIndex: 100,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <div style={{
            padding: "4px 12px 8px",
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            Saved Wallets
          </div>
          
          {filteredWallets.map((wallet, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                onSelect(wallet);
                setShow(false);
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.9)",
                fontSize: 13,
                fontFamily: "'Space Mono', monospace",
                textAlign: "left",
                cursor: "pointer",
                transition: "background 0.15s",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(249,115,22,0.1)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              <span style={{ 
                flex: 1, 
                overflow: "hidden", 
                textOverflow: "ellipsis",
                whiteSpace: "nowrap" 
              }}>
                {wallet.slice(0, 6)}...{wallet.slice(-4)}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
