"use client";
import { useEffect } from "react";

export default function GlobalMarketSearchInput() {
  useEffect(() => {
    // No-op for hydration
  }, []);

  return (
    <a
      href="https://app.opinion.trade?code=8YfTc9"
      target="_blank"
      rel="noopener noreferrer"
      style={{
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        cursor: "pointer",
        gap: 10,
        paddingLeft: 12,
        paddingRight: 14,
        minWidth: 0,
      }}
    >
      <img
        src="/logo-opinion.svg"
        alt="Opinion Logo"
        style={{
          width: 38,
          height: 38,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: "#fff",
          fontWeight: 700,
          fontSize: 23,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        Get 10% Fee Discount
      </span>
    </a>
  );
}
