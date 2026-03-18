"use client";

import { useState, useEffect } from "react";

const SLIDES = [
  { 
    id: 0, 
    header: "/wallet track/predictfun/1.png", 
    banner: "/wallet track/predictfun/big1.png",
    alt: "Predict.fun Wallet Tracker Feature 1",
    url: "/wallet/predictfun/0x402582D54b7Bd3A44b57A6A0b4ac60c0BE1af608"
  },
  { 
    id: 1, 
    header: "/wallet track/predictfun/2.png", 
    banner: "/wallet track/predictfun/big2.png",
    alt: "Predict.fun Wallet Tracker Feature 2",
    url: "/wallet/predictfun/0x2Aa3ea72C0D5e6D15063EE9b22321E057f858626"
  },
  { 
    id: 2, 
    header: "/wallet track/predictfun/3.png", 
    banner: "/wallet track/predictfun/big3.png",
    alt: "Predict.fun Wallet Tracker Feature 3",
    url: "/wallet/predictfun/0x15dD26df339E8964b617e81867DEf030de7b4021"
  },
];

// Mobile banner path
const MOBILE_BANNER = "/wallet track/predictfun/mobile.png";
const MOBILE_URL = "https://predict.fun/portfolio/0x4739c09e9eE42bbb651Ed612431549e052Ff17eb";

export default function PredictFunWalletLanding() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile screen
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleHeaderEnter = (index) => {
    setActiveIndex(index);
  };
  
  // Keyboard navigation
  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter' || e.key === ' ') {
      setActiveIndex(index);
    }
  };

  // Mobile Layout - Only big banner, no thumbnails
  if (isMobile) {
    return (
      <div className="pf-landing-container-mobile" style={{ 
        width: "100%",
        maxWidth: "95vw",
        margin: "0 auto 32px auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxSizing: "border-box"
      }}>
        {/* Mobile Banner - Single image, no purple border */}
        <div style={{
          position: "relative",
          width: "100%",
          backgroundColor: "#0a0a0c",
          borderRadius: 12,
          overflow: "hidden"
        }}>
          <img 
            src={MOBILE_BANNER}
            alt="Predict.fun Wallet Tracker Mobile"
            style={{
              width: "100%",
              height: "auto",
              objectFit: "contain",
              display: "block"
            }}
          />
          
          {/* View More Link - Mobile */}
          <a 
            href={MOBILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              textAlign: "center",
              padding: "12px 16px",
              fontSize: 16,
              fontWeight: 600,
              color: "#fff",
              textDecoration: "underline",
              textUnderlineOffset: 4,
              cursor: "pointer",
              backgroundColor: "rgba(0,0,0,0.5)"
            }}
          >
            View more 👉
          </a>
        </div>
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="pf-landing-container" style={{ 
      width: 1080,
      maxWidth: "95vw",
      position: "relative",
      left: "50%",
      transform: "translateX(-50%)",
      marginBottom: 32,
      display: "flex",
      flexDirection: "column",
      gap: 24,
      boxSizing: "border-box"
    }}>
      {/* Header Cards (Thumbnails) */}
      <div className="pf-landing-headers-row" style={{
        display: "flex",
        gap: 16,
        justifyContent: "center",
        alignItems: "center"
      }}>
        {SLIDES.map((slide, i) => {
          const isActive = i === activeIndex;
          return (
            <div 
              key={slide.id}
              role="button"
              tabIndex={0}
              onMouseEnter={() => handleHeaderEnter(i)}
              onClick={() => setActiveIndex(i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              style={{
                width: 350,
                height: 230,
                borderRadius: 12,
                cursor: "pointer",
                overflow: "hidden",
                border: isActive ? "2px solid #8b5cf6" : "2px solid rgba(255,255,255,0.1)",
                position: "relative",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                flexShrink: 0,
                transform: isActive ? "scale(1.02)" : "scale(1)",
                boxShadow: isActive ? "0 4px 24px rgba(139, 92, 246, 0.3)" : "none",
                opacity: isActive ? 1 : 0.7,
                backgroundColor: "#0d0d0f",
              }}
            >
              {/* Thumbnail Image */}
              <img 
                src={slide.header} 
                alt={`Slide ${i + 1}`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "top center",
                  display: "block"
                }}
              />
              
              {/* Hover overlay hint */}
              <div style={{
                position: "absolute",
                inset: 0,
                background: isActive ? "transparent" : "rgba(0,0,0,0.3)",
                transition: "background 0.2s"
              }} />
            </div>
          );
        })}
      </div>

      {/* Big Banner Area */}
      <div className="pf-landing-banner-wrapper" style={{
        position: "relative",
        width: "100%",
        backgroundColor: "#0a0a0c",
        borderRadius: 16,
        overflow: "hidden",
        border: "2px solid #8b5cf6",
        boxShadow: "0 4px 24px rgba(139, 92, 246, 0.3), 0 20px 50px -10px rgba(0,0,0,0.6)"
      }}>
        {SLIDES.map((slide, i) => {
          const isActive = i === activeIndex;
          return (
            <div 
              key={slide.id}
              style={{
                display: isActive ? "block" : "none",
                width: "100%",
                position: "relative"
              }}
            >
              <img 
                src={slide.banner} 
                alt={slide.alt}
                style={{
                  width: "100%",
                  height: "auto",
                  objectFit: "contain",
                  display: "block"
                }}
              />
              
              {/* View More Link - Inside Banner */}
              <a 
                href={slide.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  position: "absolute",
                  bottom: 30,
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: 20,
                  fontWeight: 600,
                  color: "#fff",
                  textDecoration: "underline",
                  textUnderlineOffset: 4,
                  cursor: "pointer",
                  transition: "color 0.2s",
                  padding: "8px 16px",
                  backgroundColor: "rgba(0,0,0,0.5)",
                  borderRadius: 8
                }}
                onMouseEnter={(e) => e.target.style.color = "#a78bfa"}
                onMouseLeave={(e) => e.target.style.color = "#fff"}
              >
                View more 👉
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
