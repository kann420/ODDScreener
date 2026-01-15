import "./globals.css";
import Script from "next/script";
import NavLinks from "../components/NavLinks";
import GlobalMarketSearchInput from "../components/GlobalMarketSearchInput";
import FooterBar from "../components/FooterBar";

const GA_MEASUREMENT_ID = "G-P1NXMB82YZ";

export const metadata = {
  title: "ODDScreeners - Opinion Markets Explorer",
  description: "Demo UI for Opinion explorer + embedded chart service",
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
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>

      <body>
        {/* Smart Money hub warm-up (server-side safe) */}
        <img src="/api/smart-money/warm" alt="" style={{ display: "none" }} />

        {/* Topbar */}
        <div className="topbar">
          <div className="container">
            <div
              className="topbar-inner"
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
              }}
            >
              {/* LEFT: brand + nav */}
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <a className="brand" href="/" aria-label="ODDScreeners">
                  <img
                    src="/2logonewest.svg"
                    alt="ODDScreeners"
                    style={{
                      height: 160,
                      width: "auto",
                      display: "block",
                      objectFit: "contain",
                      maxHeight: "none",
                    }}
                  />
                </a>

                <NavLinks />
              </div>

              <div style={{ flex: 1 }} />

              {/* RIGHT: search */}
              <div className="search" style={{ display: "flex", alignItems: "center", gap: 1 }}>
                <GlobalMarketSearchInput />
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="container">{children}</div>

        {/* New Premium Footer Bar (replaces old bottom-left & bottom-right footers) */}
        <FooterBar version="1.1.2" live />
      </body>
    </html>
  );
}
