"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

// Get device ID from localStorage
function getDeviceId() {
  if (typeof window === "undefined") return null;
  let deviceId = localStorage.getItem("odd_device_id");
  if (!deviceId) {
    deviceId = "device_" + crypto.randomUUID();
    localStorage.setItem("odd_device_id", deviceId);
  }
  return deviceId;
}

// Get stored access expiry
function getStoredExpiry() {
  if (typeof window === "undefined") return null;
  const expiry = localStorage.getItem("odd_access_expires");
  return expiry ? parseInt(expiry, 10) : null;
}

// Save access info
function saveAccessInfo(expiresAt) {
  if (typeof window === "undefined") return;
  localStorage.setItem("odd_access_expires", String(expiresAt));
}

/**
 * Access Guard Component - Modal Overlay Version
 * Shows modal overlay on top of content if no valid access
 */
export default function AccessGuard({ children }) {
  const router = useRouter();
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);
  
  // Modal state
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function verifyAccess() {
      const deviceId = getDeviceId();
      
      // Quick check: if stored expiry is valid, show content immediately
      const storedExpiry = getStoredExpiry();
      if (storedExpiry && Date.now() < storedExpiry) {
        setHasAccess(true);
        setChecking(false);
        // Verify in background
        verifyWithServer(deviceId);
        return;
      }
      
      // No valid local cache, check server
      if (!deviceId) {
        setChecking(false);
        return;
      }

      await verifyWithServer(deviceId);
    }
    
    async function verifyWithServer(deviceId) {
      try {
        const res = await fetch(`/api/arbitage/access/check?deviceId=${encodeURIComponent(deviceId)}`);
        const data = await res.json();
        
        if (data.hasAccess) {
          saveAccessInfo(data.expiresAt);
          setHasAccess(true);
        } else {
          localStorage.removeItem("odd_access_expires");
          setHasAccess(false);
        }
      } catch (err) {
        console.error("Access check error:", err);
        // On error, use local cache as fallback
        const storedExpiry = getStoredExpiry();
        if (storedExpiry && Date.now() < storedExpiry) {
          setHasAccess(true);
        }
      }
      setChecking(false);
    }

    verifyAccess();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!code.trim()) {
      setError("Please enter an invite code");
      return;
    }
    
    setLoading(true);
    setError("");
    
    try {
      const deviceId = getDeviceId();
      
      const res = await fetch("/api/arbitage/access/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          code: code.trim().toUpperCase(), 
          deviceId 
        }),
      });
      
      const data = await res.json();
      
      if (!data.valid) {
        setError(data.error || "Invalid code");
        setLoading(false);
        return;
      }
      
      // Save access info and grant access
      saveAccessInfo(data.expiresAt);
      setHasAccess(true);
      
    } catch (err) {
      console.error("Validate error:", err);
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  const handleCodeChange = (e) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    setCode(value);
    setError("");
  };

  // Render children if has access
  if (hasAccess) {
    return children;
  }

  const handleClose = () => {
    // Navigate back or to home
    if (typeof window !== "undefined") {
      window.history.back();
    }
  };

  // Show modal overlay on top of dimmed content
  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      {/* Dimmed background content */}
      <div style={{ 
        filter: "blur(3px)", 
        opacity: 0.7,
        pointerEvents: "none",
        userSelect: "none",
      }}>
        {children}
      </div>
      
      {/* Modal Overlay */}
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}>
        {/* Modal Card */}
        <div style={{
          position: "relative",
          width: "100%",
          maxWidth: 380,
          background: "linear-gradient(180deg, #18181c 0%, #101012 100%)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.1)",
          padding: "1px 16px 16px",
          boxShadow: "0 25px 80px -12px rgba(0,0,0,0.8)",
          margin: "0 16px",
        }}>
          {/* Close Button */}
          <button
            onClick={handleClose}
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              width: 28,
              height: 28,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 300,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.target.style.background = "rgba(255,255,255,0.1)";
              e.target.style.color = "rgba(255,255,255,0.8)";
            }}
            onMouseLeave={(e) => {
              e.target.style.background = "rgba(255,255,255,0.06)";
              e.target.style.color = "rgba(255,255,255,0.5)";
            }}
          >
            ✕
          </button>
          {/* Logo */}
          <div style={{ 
            display: "flex", 
            justifyContent: "center",
            marginBottom: 4,
          }}>
            <Image 
              src="/logonewest.svg" 
              alt="ODDScreener" 
              width={300} 
              height={194}
              style={{ opacity: 1 }}
            />
          </div>
          
          {/* Title */}
          <h1 style={{
            fontSize: 18,
            fontWeight: 600,
            color: "rgba(255,255,255,0.85)",
            textAlign: "center",
            margin: "0 0 5px 0",
            lineHeight: 1.4,
          }}>
            Arbitrage need Invite Code for now
          </h1>
          <h2 style={{
            fontSize: 16,
            fontWeight: 500,
            color: "rgba(255,255,255,0.6)",
            textAlign: "center",
            margin: "0 0 80px 0",
          }}>
            Want a code?{" "}
            <a 
              href="https://x.com/ODDScreeners" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                color: "rgba(255,180,50,0.9)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Visit our X
            </a>
          </h2>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {/* Label */}
            <label style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              color: "rgba(255,255,255,0.6)",
              marginBottom: 10,
            }}>
              Type in your invite code
            </label>
            
            {/* Input */}
            <input
              type="text"
              value={code}
              onChange={handleCodeChange}
              placeholder="Enter invite code"
              disabled={loading || checking}
              style={{
                width: "100%",
                padding: "14px 16px",
                fontSize: 15,
                fontWeight: 500,
                background: "rgba(255,255,255,0.06)",
                border: error 
                  ? "1px solid rgba(255,100,100,0.5)" 
                  : "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                color: "#fff",
                outline: "none",
                letterSpacing: "2px",
                textAlign: "center",
                textTransform: "uppercase",
                boxSizing: "border-box",
              }}
              autoFocus
              autoComplete="off"
              spellCheck="false"
            />
            
            {/* Error message */}
            {error && (
              <div style={{
                fontSize: 12,
                color: "rgba(255,100,100,0.9)",
                marginTop: 10,
                textAlign: "center",
                fontWeight: 500,
              }}>
                {error}
              </div>
            )}
            
            {/* Submit button */}
            <button
              type="submit"
              disabled={loading || checking || code.length < 8}
              style={{
                width: "100%",
                padding: "12px",
                fontSize: 14,
                fontWeight: 600,
                background: code.length === 8 && !loading && !checking
                  ? "#fff" 
                  : "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: 8,
                color: code.length === 8 && !loading && !checking
                  ? "#0a0a0a" 
                  : "rgba(255,255,255,0.3)",
                cursor: code.length === 8 && !loading && !checking
                  ? "pointer" 
                  : "not-allowed",
                marginTop: 12,
                transition: "all 0.2s",
                boxSizing: "border-box",
              }}
            >
              {checking ? "Checking..." : loading ? "Verifying..." : "Continue"}
            </button>
          </form>
          
          {/* Footer */}
          <div style={{
            marginTop: 16,
            fontSize: 10,
            color: "rgba(255,255,255,0.2)",
            textAlign: "center",
            letterSpacing: "0.5px",
          }}>
            Early Access • Arbitrage Scanner
          </div>
        </div>
      </div>
    </div>
  );
}
