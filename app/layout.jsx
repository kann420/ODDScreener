import "./globals.css";
import Script from "next/script";
import NavLinks from "../components/NavLinks";
import GlobalMarketSearchInput from "../components/GlobalMarketSearchInput";

const GA_MEASUREMENT_ID = "G-P1NXMB82YZ";

export const metadata = {
  title: "ODDScreeners - Opinion Markets Explorer",
  description: "Demo UI for Opinion explorer + embedded chart service"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Google Analytics */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
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
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="topbar">
          <div className="container">
            <div className="topbar-inner">
              <a className="brand" href="/" aria-label="ODDScreeners">
                <img className="brand-icon" src="/logo.svg" alt="ODDScreeners" />

                <span className="brand-wordmark">
                  <span className="brand-odds">ODDS</span>
                  <span className="brand-screener">creeners</span>
                  <span className="brand-beta">beta</span>
                </span>
              </a>

              <NavLinks />

              <div className="spacer" />

              <div className="search" style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <GlobalMarketSearchInput />
              </div>
            </div>
          </div>
        </div>

        <div className="container">{children}</div>
        {/* Footer: bottom left */}
        <div style={{
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
          gap: 4
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "#22c55e", display: "inline-block", marginRight: 2 }}></span>
          <span style={{ color: '#fff', fontWeight: 700, marginRight: 2 }}>Live</span>
          <span style={{ color: '#cbd5e1', fontStyle: 'italic', fontWeight: 400 }}>version 1.0 Beta</span>
        </div>
      </body>
    </html>
  );
}
