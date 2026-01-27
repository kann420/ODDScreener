"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

// Generate or get device ID from localStorage
function getDeviceId() {
  if (typeof window === "undefined") return null;
  
  let deviceId = localStorage.getItem("odd_device_id");
  if (!deviceId) {
    deviceId = "device_" + crypto.randomUUID();
    localStorage.setItem("odd_device_id", deviceId);
  }
  return deviceId;
}

// Save access info to localStorage
function saveAccessInfo(expiresAt) {
  if (typeof window === "undefined") return;
  localStorage.setItem("odd_access_expires", String(expiresAt));
}

export default function ArbitrageAccessPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Check if already has access on mount
  useEffect(() => {
    async function checkAccess() {
      const deviceId = getDeviceId();
      if (!deviceId) {
        setChecking(false);
        return;
      }

      try {
        const res = await fetch(`/api/arbitage/access/check?deviceId=${encodeURIComponent(deviceId)}`);
        const data = await res.json();
        
        if (data.hasAccess) {
          saveAccessInfo(data.expiresAt);
          router.replace("/arbitage");
          return;
        }
      } catch (err) {
        console.error("Check access error:", err);
      }
      
      setChecking(false);
    }
    
    checkAccess();
  }, [router]);

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
      
      // Save access info and redirect
      saveAccessInfo(data.expiresAt);
      router.replace("/arbitage");
      
    } catch (err) {
      console.error("Validate error:", err);
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  // Format code input (auto uppercase, max 8 chars)
  const handleCodeChange = (e) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    setCode(value);
    setError("");
  };

  // Show loading while checking access
  if (checking) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
      }}>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
          Checking access...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0a0a0a",
    }}>
      {/* Modal Card */}
      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "linear-gradient(180deg, #1a1a1f 0%, #111114 100%)",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "40px 36px",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
      }}>
        {/* Logo */}
        <div style={{ 
          display: "flex", 
          justifyContent: "center",
          marginBottom: 28,
        }}>
          <Image 
            src="/logonewest.svg" 
            alt="ODDScreener" 
            width={64} 
            height={64}
            style={{ opacity: 0.95 }}
          />
        </div>
        
        {/* Title */}
        <h1 style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#fff",
          textAlign: "center",
          margin: "0 0 40px 0",
          lineHeight: 1.3,
        }}>
          Want a code?<br />
          <span style={{ 
            background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.8) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            Visit our X
          </span>
        </h1>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Label */}
          <label style={{
            display: "block",
            fontSize: 13,
            fontWeight: 500,
            color: "rgba(255,255,255,0.7)",
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
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px 16px",
              fontSize: 15,
              fontWeight: 500,
              background: "rgba(255,255,255,0.06)",
              border: error 
                ? "1px solid rgba(255,100,100,0.5)" 
                : "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10,
              color: "#fff",
              outline: "none",
              letterSpacing: "1.5px",
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
            disabled={loading || code.length < 8}
            style={{
              width: "100%",
              padding: "14px",
              fontSize: 15,
              fontWeight: 600,
              background: code.length === 8 && !loading 
                ? "rgba(255,255,255,0.9)" 
                : "rgba(255,255,255,0.12)",
              border: "none",
              borderRadius: 10,
              color: code.length === 8 && !loading 
                ? "#0a0a0a" 
                : "rgba(255,255,255,0.3)",
              cursor: code.length === 8 && !loading 
                ? "pointer" 
                : "not-allowed",
              marginTop: 20,
              transition: "all 0.2s",
              boxSizing: "border-box",
            }}
          >
            {loading ? "Verifying..." : "Continue"}
          </button>
        </form>
        
        {/* Footer note */}
        <div style={{
          marginTop: 28,
          fontSize: 11,
          color: "rgba(255,255,255,0.3)",
          textAlign: "center",
          letterSpacing: "0.5px",
        }}>
          Early Access • Arbitrage Scanner
        </div>
      </div>
    </div>
  );
}
