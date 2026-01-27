"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// Get device ID from localStorage
function getDeviceId() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("odd_device_id");
}

// Get stored access expiry
function getStoredExpiry() {
  if (typeof window === "undefined") return null;
  const expiry = localStorage.getItem("odd_access_expires");
  return expiry ? parseInt(expiry, 10) : null;
}

/**
 * Access Guard Component
 * Wraps content that requires early access
 * Redirects to /arbitage/access if no valid access
 */
export default function AccessGuard({ children }) {
  const router = useRouter();
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function verifyAccess() {
      const deviceId = getDeviceId();
      
      // No device ID = no access
      if (!deviceId) {
        router.replace("/arbitage/access");
        return;
      }

      // Quick check: if stored expiry is in the past, redirect immediately
      const storedExpiry = getStoredExpiry();
      if (storedExpiry && Date.now() > storedExpiry) {
        localStorage.removeItem("odd_access_expires");
        router.replace("/arbitage/access");
        return;
      }

      // Verify with server
      try {
        const res = await fetch(`/api/arbitage/access/check?deviceId=${encodeURIComponent(deviceId)}`);
        const data = await res.json();
        
        if (data.hasAccess) {
          // Update stored expiry
          localStorage.setItem("odd_access_expires", String(data.expiresAt));
          setHasAccess(true);
          setChecking(false);
        } else {
          // No access, redirect
          localStorage.removeItem("odd_access_expires");
          router.replace("/arbitage/access");
        }
      } catch (err) {
        console.error("Access check error:", err);
        // On error, check local storage as fallback
        if (storedExpiry && Date.now() < storedExpiry) {
          setHasAccess(true);
          setChecking(false);
        } else {
          router.replace("/arbitage/access");
        }
      }
    }

    verifyAccess();
  }, [router]);

  // Show loading while checking
  if (checking) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg, #0d0e12)",
      }}>
        <div style={{ 
          color: "rgba(255,255,255,0.5)", 
          fontSize: 14,
          fontWeight: 600,
        }}>
          Verifying access...
        </div>
      </div>
    );
  }

  // Render children if has access
  if (hasAccess) {
    return children;
  }

  // Fallback (should not reach here normally)
  return null;
}
