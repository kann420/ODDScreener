import "./globals.css";
import Script from "next/script";
import NavLinks from "../components/NavLinks";
import GlobalMarketSearchInput from "../components/GlobalMarketSearchInput";

const GA_MEASUREMENT_ID = "G-P1NXMB82YZ";

const iconButtonStyle = {
  width: 34,
  height: 34,
  borderRadius: 10,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#e5e7eb",
  boxShadow: "0 2px 10px rgba(0,0,0,0.16)",
  transition: "transform 120ms ease, border-color 120ms ease, background 120ms ease",
};

const partnerWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginRight: 12,
};

const partnerLogoBase = {
  width: 44,
  height: 44,
  display: "block",
};

const IconX = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M4 3h4.9l3.3 4.8L15.7 3H20l-6.3 7.7L20 21h-4.9l-3.6-5.2L7.7 21H4l6.6-8.1L4 3Z" fill="currentColor" />
  </svg>
);

const IconDiscord = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M20 4.6a16.5 16.5 0 0 0-4.1-1.3l-.2.5c1 .2 1.9.6 2.7 1.1-1.1-.6-2.3-.9-3.5-1.1a12 12 0 0 0-6.1 0 12.4 12.4 0 0 0-3.5 1.1c-.1.1-.2.1-.3.2 1.5-.7 2.3-.9 2.7-1.1l-.2-.5A16.5 16.5 0 0 0 4 4.6c-.7 1.1-1.5 3-1.9 5.5a12 12 0 0 0 3.6 8.4 10 10 0 0 0 3.4 1.7l.7-1.1a8.6 8.6 0 0 1-1.6-.7l.3-.2a9.5 9.5 0 0 0 6.4 0l.3.2a9 9 0 0 1-1.7.7l.7 1.1a10 10 0 0 0 3.4-1.7 12 12 0 0 0 3.6-8.4A12 12 0 0 0 20 4.6Zm-10.5 9.7c-.7 0-1.3-.6-1.3-1.3 0-.7.6-1.3 1.3-1.3.7 0 1.3.6 1.3 1.3 0 .7-.6 1.3-1.3 1.3Zm5 0c-.7 0-1.3-.6-1.3-1.3 0-.7.6-1.3 1.3-1.3.7 0 1.3.6 1.3 1.3 0 .7-.6 1.3-1.3 1.3Z"
      fill="currentColor"
    />
  </svg>
);

const DOC_ICON_SRC = "/logo_docs_50.svg"; // provided asset in public/

const SOCIAL_LINKS = [
  { id: "x", href: "https://x.com/ODDScreeners", label: "ODDScreeners on X", Icon: IconX },
  { id: "docs", href: "https://oddscreeners.gitbook.io/oddscreeners-docs/", label: "Docs", src: DOC_ICON_SRC },
];

export const metadata = {
  title: "ODDScreeners - Opinion Markets Explorer",
  description: "Demo UI for Opinion explorer + embedded chart service",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Google Analytics */}
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}', {
              page_path: window.location.pathname,
            });
          `}
        </Script>

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>

      <body>
        {/* Smart Money hub warm-up (server-side safe) */}
        <img src="/api/smart-money/warm" alt="" style={{ display: "none" }} />
        <div className="topbar">
  {/* ✅ Partner logos: OUTSIDE container => can sit at far-left */}
  <div
    style={{
      position: "absolute",
      left: 16,
      top: "50%",
      transform: "translateY(-50%)",
      display: "flex",
      alignItems: "center",
      gap: 8,
      zIndex: 5,
    }}
  >
    <img
      src="/polymarket_600.svg"
      alt="Polymarket"
      style={{
        width: 44,
        height: 44,
        filter: "grayscale(1) brightness(0.8)",
        opacity: 0.7,
        display: "block",
      }}
    />
    <img
      src="/op_logo_600.svg"
      alt="Opinion"
      style={{
        width: 44,
        height: 44,
        filter: "drop-shadow(0 0 6px rgba(255,255,255,0.22))",
        display: "block",
      }}
    />
  </div>

  <div className="container">
    {/* ✅ give the inner header a left padding so it doesn't overlap the logos */}
    <div
      className="topbar-inner"
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
      }}
    >
      {/* CENTER-LEFT: brand + nav */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <a className="brand" href="/" aria-label="ODDScreeners">
          <img className="brand-icon" src="/logo.svg" alt="ODDScreeners" />
          <span className="brand-wordmark">
            <span className="brand-odds">ODDS</span>
            <span className="brand-screener">creeners</span>
            <span className="brand-beta">beta</span>
          </span>
        </a>

        <NavLinks />
      </div>

      <div style={{ flex: 1 }} />

      <div className="search" style={{ display: "flex", alignItems: "center", gap: 1 }}>
        <GlobalMarketSearchInput />
      </div>
    </div>
  </div>
</div>

        <div className="container">{children}</div>

        {/* Footer: bottom left */}
        <div
          style={{
            position: "fixed",
            left: 12,
            bottom: 10,
            zIndex: 100,
            fontSize: 13,
            color: "#fff",
            fontWeight: 700,
            background: "rgba(215, 192, 176, 0.22)",
            borderRadius: 8,
            padding: "4px 12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "#22c55e", display: "inline-block", marginRight: 2 }} />
          <span style={{ color: "#fff", fontWeight: 700, marginRight: 2 }}>Live</span>
          <span style={{ color: "#cbd5e1", fontStyle: "italic", fontWeight: 400 }}>version 1.1.0 Beta</span>
        </div>

        {/* Footer: bottom right */}
        <div
          style={{
            position: "fixed",
            right: 12,
            bottom: 10,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {SOCIAL_LINKS.map(({ id, href, label, Icon, src }) => (
            <a key={id} href={href} target="_blank" rel="noreferrer" aria-label={label} style={iconButtonStyle}>
              {Icon ? (
                <Icon />
              ) : (
                <img
                  src={src}
                  alt={label}
                  style={{
                    width: 18,
                    height: 18,
                    objectFit: "contain",
                    transform: "scale(1.8)",
                    transformOrigin: "center",
                    display: "block",
                  }}
                />
              )}
            </a>
          ))}
        </div>
      </body>
    </html>
  );
}