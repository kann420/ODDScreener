"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import ArbCalculatorModal from "./ArbCalculatorModal";
import { OptimizedImage } from "@/components/OptimizedImage";
import {
  getBonusCache,
  setBonusCache,
  getProbableBoostedCache,
  setProbableBoostedCache,
} from "@/lib/clientCache";

// ── Platform definitions (logos + labels) ──────────────────────────────────
const PLATFORMS = [
  { value: "polymarket", label: "Polymarket", logo: "/polymarket_600.svg" },
  { value: "opinion", label: "Opinion", logo: "/logo-opinion.svg" },
  { value: "probable", label: "Probable", logo: "/proable.svg" },
  { value: "predictfun", label: "Predict.fun", logo: "/predictfun_logo.svg" },
];

/** Custom exchange dropdown with logo — shared by desktop and mobile header */
function PlatformSelect({
  value,
  onChange,
  disabled,
  excludeValue,
  width = 130,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = PLATFORMS.find((p) => p.value === value) || PLATFORMS[0];
  const options = PLATFORMS.filter((p) => p.value !== excludeValue);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 8px 7px 10px",
          background: open ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.32)",
          border: `1px solid ${open ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.13)"}`,
          borderRadius: 8,
          color: open ? "rgba(185,198,215,0.6)" : "#e9eef5",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 13,
          fontWeight: 700,
          transition: "all 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.logo}
          alt=""
          width={15}
          height={15}
          style={{
            objectFit: "contain",
            opacity: open ? 0.5 : 0.85,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {current.label}
        </span>
        <svg
          width="9"
          height="5"
          viewBox="0 0 10 6"
          fill="none"
          style={{
            flexShrink: 0,
            opacity: 0.55,
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "none",
          }}
        >
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {/* Dropdown panel */}
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "rgba(13,17,27,0.97)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            zIndex: 300,
            padding: "3px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              disabled={disabled}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                background:
                  opt.value === value
                    ? "rgba(255,255,255,0.07)"
                    : "transparent",
                border: "none",
                borderRadius: 5,
                color: "rgba(170,185,205,0.8)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
                textAlign: "left",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  opt.value === value
                    ? "rgba(255,255,255,0.07)"
                    : "transparent";
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={opt.logo}
                alt=""
                width={15}
                height={15}
                style={{ objectFit: "contain", opacity: 0.78, flexShrink: 0 }}
              />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Cache key for sessionStorage (includes platform pair — ORDER-INDEPENDENT)
// Sorting alphabetically so "opinion_probable" === "probable_opinion"
function cacheKey(pA = "polymarket", pB = "opinion", eventFilterKey = "") {
  const sorted = [pA, pB].sort();
  const eventKey = String(eventFilterKey || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  return `arbitrage_cache_v3_${sorted[0]}_${sorted[1]}${eventKey ? `_${eventKey}` : ""}`;
}

/**
 * Given a row from the engine and the display platform order,
 * return { statsA, statsB } where statsA = stats for displayPlatformA column,
 * statsB = stats for displayPlatformB column.
 *
 * Engine convention: polyStats = sideB data, opinionStats = sideA data.
 * row.platformA / sideA.platform = engine's sideA platform.
 * row.platformB / sideB.platform = engine's sideB platform.
 */
function getStatsForDisplay(row, displayPlatformA, displayPlatformB) {
  // Engine's sideA platform
  const engineSideA = row.sideA?.platform || row.platformA;
  // polyStats = sideB, opinionStats = sideA
  if (engineSideA === displayPlatformA) {
    // sideA matches display column A → column A = opinionStats, column B = polyStats
    return { statsA: row.opinionStats, statsB: row.polyStats };
  }
  // sideA matches display column B (swapped) → column A = polyStats, column B = opinionStats
  return { statsA: row.polyStats, statsB: row.opinionStats };
}

function isMarchMadnessRow(row) {
  if (row?.marchMadnessPair === true) return true;

  const categorySlugs = [
    row?.predictfunCategorySlug,
    row?.predictfunCategorySlugA,
    row?.predictfunCategorySlugB,
    row?._predictfunMarketA?.categorySlug,
    row?._predictfunMarketB?.categorySlug,
    row?._predictfunMarketA?._categorySlug,
    row?._predictfunMarketB?._categorySlug,
    row?._predictfunMarketA?._predictfunRaw?.categorySlug,
    row?._predictfunMarketB?._predictfunRaw?.categorySlug,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());

  if (
    categorySlugs.some(
      (slug) =>
        slug.includes("march") ||
        slug.includes("ncaam") ||
        slug.includes("ncaa") ||
        slug.includes("cbb"),
    )
  ) {
    return true;
  }

  const haystack = [
    row?.title,
    row?.opinionTitle,
    row?.polyTitle,
    row?.parentTitle,
    row?.outcome,
    row?.sideA?.title,
    row?.sideB?.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("march madness") ||
    haystack.includes("ncaam") ||
    haystack.includes("ncaa tournament") ||
    haystack.includes("ncaa basketball") ||
    haystack.includes("college basketball")
  );
}

function isLiveRow(row) {
  // A market is "live" when:
  // 1. It's a sports/esports match (sports_team_match or sports_match variant)
  // 2. The game ends within the next 24 hours (happening today/soon)
  const now = Date.now();

  // Check if it's a sports match variant
  const variant = String(
    row?.pfCategoryMarketVariant || ""
  ).toLowerCase();
  const isSportsMatch =
    variant === "sports_team_match" || variant === "sports_match";

  if (!isSportsMatch) return false;

  // Check time window: game must end within 24h and not have ended yet
  const endMs = row?.endDate ? Date.parse(row.endDate) : null;
  if (!endMs) return false;
  if (now >= endMs) return false;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  if (endMs - now > TWENTY_FOUR_HOURS) return false;

  return true;
}

// Get cache from sessionStorage (persists across page navigation)
function getCache(pA, pB, eventFilterKey = "") {
  if (typeof window === "undefined") {
    return {
      bids: { rows: null, timestamp: null, matchedMarkets: null },
      asks: { rows: null, timestamp: null, matchedMarkets: null },
    };
  }
  try {
    const stored = sessionStorage.getItem(cacheKey(pA, pB, eventFilterKey));
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate cache has correct structure
      if (parsed.bids && parsed.asks) {
        return parsed;
      }
    }
  } catch {}
  return {
    bids: { rows: null, timestamp: null, matchedMarkets: null },
    asks: { rows: null, timestamp: null, matchedMarkets: null },
  };
}

// Save cache to sessionStorage
function saveCache(
  mode,
  rows,
  timestamp,
  matchedMarkets = null,
  pA,
  pB,
  eventFilterKey = "",
) {
  if (typeof window === "undefined") return;
  try {
    const cache = getCache(pA, pB, eventFilterKey);
    cache[mode] = { rows, timestamp, matchedMarkets };
    sessionStorage.setItem(
      cacheKey(pA, pB, eventFilterKey),
      JSON.stringify(cache),
    );
  } catch {}
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return null;
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return "over a day ago";
}

// Sort icon component - 12px outline style SVG icons per guidelines
function ArbSortIcon({ active, direction }) {
  // Neutral state (double chevron)
  if (!active) {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.4, marginLeft: 4 }}
      >
        <path d="M7 15l5 5 5-5" />
        <path d="M7 9l5-5 5 5" />
      </svg>
    );
  }

  // Active desc (arrow down) - sortAsc=false means highest first
  if (!direction) {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: "rgba(255,180,50,1)", marginLeft: 4 }}
      >
        <path d="M12 5v14" />
        <path d="M19 12l-7 7-7-7" />
      </svg>
    );
  }

  // Active asc (arrow up)
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "rgba(255,180,50,1)", marginLeft: 4 }}
    >
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

const PREDICTFUN_LOGO_SRC = "/predictfun_logo.svg?v=20260306";

// Platform display maps
const platformLogoMap = {
  polymarket: "/2polymarket_600.webp",
  opinion: "/2logo-opinion.webp",
  probable: "/proable.svg",
  predictfun: PREDICTFUN_LOGO_SRC,
};
const platformDisplayMap = {
  polymarket: "Polymarket",
  opinion: "Opinion",
  probable: "Probable",
  predictfun: "Predict.fun",
};
const platformColorMap = {
  polymarket: "rgba(96,165,250,0.95)",
  opinion: "rgba(249,115,22,1)",
  probable: "rgba(168,85,247,1)",
  predictfun: "rgba(99,102,241,1)",
};
const platformShortNameMap = {
  polymarket: "POLY",
  opinion: "OPN",
  probable: "PROB",
  predictfun: "PF",
};
const platformVolBorderColor = {
  polymarket: "rgba(96,165,250,0.5)",
  opinion: "rgba(249,115,22,0.5)",
  probable: "rgba(168,85,247,0.5)",
  predictfun: "rgba(99,102,241,0.5)",
};
const platformVolBgColor = {
  polymarket: "rgba(96,165,250,0.1)",
  opinion: "rgba(249,115,22,0.1)",
  probable: "rgba(168,85,247,0.1)",
  predictfun: "rgba(99,102,241,0.1)",
};

export default function ArbitageBoard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const priceMode = "asks";
  const [sortAsc, setSortAsc] = useState(false); // false = descending (highest first)
  const [sortField, setSortField] = useState("arbPct"); // "arbPct" or "endDate"
  const [lastScanTime, setLastScanTime] = useState(null);
  const [matchedMarketCount, setMatchedMarketCount] = useState(null);
  const [, forceUpdate] = useState(0); // For updating "X ago" display
  const [initialized, setInitialized] = useState(false);

  // Filter settings
  const [minArbPct, setMinArbPct] = useState(0.1); // Min arb percentage
  const [minShares, setMinShares] = useState(0); // Min shares on orderbook
  const [minPolyVol, setMinPolyVol] = useState(0); // Min Poly 24h volume
  const [minOpnVol, setMinOpnVol] = useState(0); // Min OPN 24h volume
  const [showFilters, setShowFilters] = useState(true); // Toggle filter panel - default open
  const [scanMode, setScanMode] = useState("quick"); // "quick" (80 markets), "med" (200 markets), or "full" (all markets)
  const [isMobileView, setIsMobileView] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Platform selector state
  const [platformA, setPlatformA] = useState("polymarket");
  const [platformB, setPlatformB] = useState("predictfun");
  const isPolyPredictFunPair =
    (platformA === "polymarket" && platformB === "predictfun") ||
    (platformA === "predictfun" && platformB === "polymarket");

  // Track if user has ever scanned
  const [hasScanned, setHasScanned] = useState(false);

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");

  // Calculator modal
  const [calculatorRow, setCalculatorRow] = useState(null); // Row to show in calculator

  // SSE streaming state
  const [progress, setProgress] = useState(null); // { phase, current, total, message }
  const [streamingRows, setStreamingRows] = useState([]); // Rows received while streaming
  const eventSourceRef = useRef(null);

  // Bonus markets filter
  const [bonusIds, setBonusIds] = useState([]);
  const [bonusOnly, setBonusOnly] = useState(false);
  const [bonusScanStatus, setBonusScanStatus] = useState(""); // "", "scanning", "done"
  const bonusSet = useMemo(
    () => new Set((bonusIds || []).map((x) => String(x))),
    [bonusIds],
  );

  // Keep a ref to bonusIds for async scan function
  const bonusIdsRef = useRef(bonusIds);
  useEffect(() => {
    bonusIdsRef.current = bonusIds;
  }, [bonusIds]);

  // Probable boosted-points filter
  const [probableBoostedIds, setProbableBoostedIds] = useState([]);
  const [boostedProbableOnly, setBoostedProbableOnly] = useState(false);
  const probableBoostedSet = useMemo(
    () => new Set((probableBoostedIds || []).map((x) => String(x))),
    [probableBoostedIds],
  );

  // Predict.fun boosted filter
  const [boostedPredictFunOnly, setBoostedPredictFunOnly] = useState(false);
  const [marchMadnessOnly, setMarchMadnessOnly] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);
  const autoScanIntervalRef = useRef(null);
  const ignoreMinArbPct = marchMadnessOnly || liveOnly;

  // Update "X ago" display every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => forceUpdate((n) => n + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Responsive pagination sizing
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileView(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Scan bonus markets for given market IDs by fetching market detail and checking incentiveFactor
  // OPTIMIZED: Higher concurrency (10 parallel), progressive UI updates per batch, minimal delay
  const scanBonusForMarkets = useCallback(async (marketIds) => {
    if (!marketIds || marketIds.length === 0) return;

    // Filter out already known bonus markets (use ref to get latest)
    const currentBonus = new Set(
      (bonusIdsRef.current || []).map((x) => String(x)),
    );
    const toScan = marketIds.filter(
      (id) => id && !currentBonus.has(String(id)),
    );
    if (toScan.length === 0) {
      console.log(
        `[Arb-Bonus] All ${marketIds.length} markets already checked`,
      );
      return;
    }

    setBonusScanStatus("scanning");
    console.log(`[Arb-Bonus] Scanning ${toScan.length} markets for bonus...`);

    const batchSize = 10; // Up from 5 for faster scanning

    for (let i = 0; i < toScan.length; i += batchSize) {
      const batch = toScan.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (marketId) => {
          try {
            const res = await fetch(
              `/api/opinion/market/${encodeURIComponent(marketId)}`,
              { cache: "no-store" },
            );
            if (!res.ok) return null;
            const j = await res.json();
            const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};
            // Check if incentiveFactor field exists
            if (
              "incentiveFactor" in data ||
              "incentive_factor" in data ||
              "incentive" in data
            ) {
              return marketId;
            }
            return null;
          } catch {
            return null;
          }
        }),
      );

      // Progressive update: add bonus markets AS THEY ARE FOUND (stream to UI per batch)
      const batchBonus = results
        .filter((r) => r.status === "fulfilled" && r.value)
        .map((r) => r.value);

      if (batchBonus.length > 0) {
        setBonusIds((prev) => {
          const newIds = batchBonus.filter(
            (id) => !prev.includes(id) && !prev.includes(String(id)),
          );
          if (newIds.length === 0) return prev;
          const updated = [...prev, ...newIds];
          setBonusCache(updated); // Save to cache progressively
          return updated;
        });
      }

      // Minimal delay between batches
      if (i + batchSize < toScan.length) {
        await new Promise((r) => setTimeout(r, 15));
      }
    }

    console.log(`[Arb-Bonus] Scan complete`);
    setBonusScanStatus("done");
  }, []); // No deps - uses refs for latest state

  // Load bonus IDs from cache or API (for bonus market detection)
  useEffect(() => {
    const cachedBonus = getBonusCache();
    if (cachedBonus?.ids && cachedBonus.ids.length > 0) {
      setBonusIds(cachedBonus.ids);
      console.log("[Arb] Loaded bonus IDs from cache:", cachedBonus.ids.length);
      return;
    }

    // Fetch from API if no cache
    (async () => {
      try {
        const res = await fetch(`/api/opinion/bonus-markets?limit=1000`, {
          cache: "no-store",
        });
        const j = await res.json();
        const ids = j?.ids || j?.result?.ids || [];
        if (Array.isArray(ids) && ids.length > 0) {
          setBonusIds(ids);
          setBonusCache(ids);
          console.log("[Arb] Fetched bonus IDs from API:", ids.length);
        }
      } catch (e) {
        console.error("[Arb] Failed to fetch bonus IDs:", e);
      }
    })();
  }, []);

  // Load Probable boosted market IDs from cache or API when Probable is a selected platform
  useEffect(() => {
    if (platformA !== "probable" && platformB !== "probable") return;

    const cached = getProbableBoostedCache();
    if (cached?.ids) {
      setProbableBoostedIds(cached.ids);
      console.log(
        "[Arb] Loaded Probable boosted IDs from cache:",
        cached.ids.length,
      );
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/probable/boosted-markets", {
          cache: "no-store",
        });
        const j = await res.json();
        const ids = j?.ids || [];
        if (Array.isArray(ids)) {
          setProbableBoostedIds(ids);
          setProbableBoostedCache(ids);
          console.log(
            "[Arb] Fetched Probable boosted IDs from API:",
            ids.length,
          );
        }
      } catch (e) {
        console.error("[Arb] Failed to fetch Probable boosted IDs:", e);
      }
    })();
  }, [platformA, platformB]);

  // Reset boostedProbableOnly / boostedPredictFunOnly / bonusOnly when platforms change
  useEffect(() => {
    if (platformA !== "opinion" && platformB !== "opinion") {
      setBonusOnly(false);
    }
    if (platformA !== "probable" && platformB !== "probable") {
      setBoostedProbableOnly(false);
    }
    if (platformA !== "predictfun" && platformB !== "predictfun") {
      setBoostedPredictFunOnly(false);
    }
    if (!isPolyPredictFunPair) {
      setMarchMadnessOnly(false);
    }
  }, [platformA, platformB, isPolyPredictFunPair]);

  // Load from sessionStorage cache when switching modes or on mount
  useEffect(() => {
    const cache = getCache(platformA, platformB);
    const cached = cache[priceMode];
    if (cached?.rows && cached.rows.length > 0) {
      setRows(cached.rows);
      setLastScanTime(cached.timestamp);
      setMatchedMarketCount(
        Number.isFinite(cached.matchedMarkets) ? cached.matchedMarkets : null,
      );
      setLoading(false);
      setInitialized(true);
      setHasScanned(true); // Cache exists = user has scanned before

      // Scan bonus for cached rows (defer to avoid race condition)
      // Only scan for bonus if Opinion is one of the selected platforms
      if (platformA === "opinion" || platformB === "opinion") {
        setTimeout(() => {
          const marketIds = [
            ...new Set(
              cached.rows.map((r) => r.opinionMarketId).filter(Boolean),
            ),
          ];
          if (marketIds.length > 0) {
            scanBonusForMarkets(marketIds);
          }
        }, 200);
      }
    } else {
      // No cache for this pair/mode, wait for user to scan
      setRows([]);
      setLastScanTime(null);
      setMatchedMarketCount(null);
      setHasScanned(false); // Reset hasScanned when switching to mode without cache
      setInitialized(true);
    }
  }, [priceMode, platformA, platformB, isPolyPredictFunPair]); // scanBonusForMarkets is stable (no deps)

  // Cleanup SSE on unmount or mode change
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [priceMode]);

  const loadDataStreaming = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLoading(true);
    setErr("");
    setProgress({ phase: "connecting", message: "Connecting..." });
    setStreamingRows([]);
    let latestMatchedPairs = 0;

    const streamLimit =
      scanMode === "full" ? 500 : scanMode === "med" ? 140 : 80;
    const eventFilter = liveOnly ? "live" : marchMadnessOnly ? "march-madness" : "";
    const url = `/api/arbitage/stream?priceMode=${encodeURIComponent(priceMode)}&minArbPct=${encodeURIComponent(minArbPct)}&limit=${streamLimit}&scanMode=${encodeURIComponent(scanMode)}&platformA=${encodeURIComponent(platformA)}&platformB=${encodeURIComponent(platformB)}${eventFilter ? `&predictFunEvent=${encodeURIComponent(eventFilter)}` : ""}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse(e.data);
        setProgress(data);

        if (
          (data.phase === "matching" || data.phase === "processing") &&
          Number.isFinite(data.total) &&
          data.total >= 0
        ) {
          latestMatchedPairs = data.total;
        }

        // Check for platform API error
        if (
          data.phase === "error" &&
          (data.error === "POLYMARKET_UNAVAILABLE" ||
            data.error === "PROBABLE_UNAVAILABLE" ||
            data.error === "PLATFORM_UNAVAILABLE")
        ) {
          setErr(
            data.errorMessage ||
              `Cannot connect to exchange API. Try again later.`,
          );
          es.close();
          eventSourceRef.current = null;
          setLoading(false);
          setProgress(null);
        }
      } catch {}
    });

    es.addEventListener("match", (e) => {
      try {
        const match = JSON.parse(e.data);
        setStreamingRows((prev) => {
          // Dedupe by id
          if (prev.some((r) => r.id === match.id)) return prev;
          const newRows = [...prev, match];
          // Sort by arbPct descending
          newRows.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));
          return newRows;
        });
      } catch {}
    });

    es.addEventListener("batch", (e) => {
      try {
        const { rows: batchRows } = JSON.parse(e.data);
        if (Array.isArray(batchRows) && batchRows.length > 0) {
          setStreamingRows((prev) => {
            const ids = new Set(prev.map((r) => r.id));
            const newOnes = batchRows.filter((r) => !ids.has(r.id));
            if (newOnes.length === 0) return prev;
            const combined = [...prev, ...newOnes];
            combined.sort((a, b) => (b.arbPct ?? 0) - (a.arbPct ?? 0));
            return combined;
          });
        }
      } catch {}
    });

    es.addEventListener("done", () => {
      es.close();
      eventSourceRef.current = null;

      // Finalize: save to cache
      setStreamingRows((finalRows) => {
        const now = Date.now();
        const finalMatchedCount =
          latestMatchedPairs > 0 ? latestMatchedPairs : finalRows.length;
        saveCache(
          priceMode,
          finalRows,
          now,
          finalMatchedCount,
          platformA,
          platformB,
        );
        setRows(finalRows);
        setLastScanTime(now);
        setMatchedMarketCount(finalMatchedCount);
        setHasScanned(true);

        // Extract unique opinionMarketIds for bonus scan (defer to after state update)
        // Only scan for bonus if Opinion is one of the selected platforms
        if (platformA === "opinion" || platformB === "opinion") {
          setTimeout(() => {
            const marketIds = [
              ...new Set(
                finalRows.map((r) => r.opinionMarketId).filter(Boolean),
              ),
            ];
            if (marketIds.length > 0) {
              scanBonusForMarkets(marketIds);
            }
          }, 100);
        }

        return finalRows;
      });

      setLoading(false);
      setProgress(null);
    });

    es.addEventListener("error", (e) => {
      try {
        const data = JSON.parse(e.data);
        setErr(data.message || "Scan failed");
      } catch {
        setErr("Connection lost");
      }
      es.close();
      eventSourceRef.current = null;
      setLoading(false);
      setProgress(null);
    });

    es.onerror = () => {
      // SSE connection error
      if (es.readyState === EventSource.CLOSED) {
        // Normal close, ignore
        return;
      }
      setErr("Connection error");
      es.close();
      eventSourceRef.current = null;
      setLoading(false);
      setProgress(null);
    };
  }, [priceMode, minArbPct, scanMode, platformA, platformB, liveOnly, marchMadnessOnly]);

  // Auto Scan: continuously re-scan when Live filter + autoScan enabled
  useEffect(() => {
    // Clear any existing interval
    if (autoScanIntervalRef.current) {
      clearInterval(autoScanIntervalRef.current);
      autoScanIntervalRef.current = null;
    }

    if (!autoScanEnabled || !liveOnly) return;

    // Auto scan every 15 seconds
    autoScanIntervalRef.current = setInterval(() => {
      if (!loading) {
        console.log("[Auto-Scan] Re-scanning live markets...");
        loadDataStreaming();
      }
    }, 15000);

    return () => {
      if (autoScanIntervalRef.current) {
        clearInterval(autoScanIntervalRef.current);
        autoScanIntervalRef.current = null;
      }
    };
  }, [autoScanEnabled, liveOnly, loading, loadDataStreaming]);

  // Disable auto scan when live filter is turned off
  useEffect(() => {
    if (!liveOnly) {
      setAutoScanEnabled(false);
    }
  }, [liveOnly]);

  // Fallback: use regular fetch if SSE fails
  const loadDataFallback = useCallback(async () => {
    try {
      setLoading(true);
      setErr("");
      setProgress({ phase: "loading", message: "Loading..." });

      const url = `/api/arbitage/opportunities?mode=auto&priceMode=${encodeURIComponent(priceMode)}&minArbPct=${encodeURIComponent(minArbPct)}&platformA=${encodeURIComponent(platformA)}&platformB=${encodeURIComponent(platformB)}&limit=50&t=${Date.now()}`;

      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setErr("Failed to load arbitrage data.");
        setRows([]);
        return;
      }

      const newRows = Array.isArray(json.rows) ? json.rows : [];
      const now = Date.now();
      const fallbackMatchedCount = newRows.length;

      // Save to sessionStorage cache
      saveCache(
        priceMode,
        newRows,
        now,
        fallbackMatchedCount,
        platformA,
        platformB,
      );

      setRows(newRows);
      setLastScanTime(now);
      setMatchedMarketCount(fallbackMatchedCount);
    } catch (e) {
      setErr("Failed to load arbitrage data.");
      setRows([]);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [priceMode, minArbPct, platformA, platformB]);

  function handleRefresh() {
    // Use streaming by default
    setHasScanned(true);
    loadDataStreaming();
  }

  // Cancel ongoing scan: close SSE, keep whatever rows we found so far
  function cancelScan() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    // Finalize with whatever rows we have so far
    setStreamingRows((currentRows) => {
      if (currentRows.length > 0) {
        const now = Date.now();
        saveCache(
          priceMode,
          currentRows,
          now,
          currentRows.length,
          platformA,
          platformB,
        );
        setRows(currentRows);
        setLastScanTime(now);
        setMatchedMarketCount(currentRows.length);
      }
      return currentRows;
    });
    setLoading(false);
    setProgress(null);
  }

  // Display rows: show streaming rows while loading, otherwise show cached rows
  const displayRows =
    loading && streamingRows.length > 0 ? streamingRows : rows;

  const sorted = useMemo(() => {
    const arr = Array.isArray(displayRows) ? [...displayRows] : [];

    // Sort by selected field — use display-mapped stats so sorting matches column headers
    arr.sort((a, b) => {
      if (sortField === "endDate") {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return sortAsc ? dateA - dateB : dateB - dateA;
      } else if (sortField === "polyVolume") {
        // "polyVolume" = column A (platformA) volume
        const sA = getStatsForDisplay(a, platformA, platformB);
        const sB = getStatsForDisplay(b, platformA, platformB);
        const volA = sA.statsA?.volume ?? 0;
        const volB = sB.statsA?.volume ?? 0;
        return sortAsc ? volA - volB : volB - volA;
      } else if (sortField === "opinionVolume") {
        // "opinionVolume" = column B (platformB) volume
        const sA = getStatsForDisplay(a, platformA, platformB);
        const sB = getStatsForDisplay(b, platformA, platformB);
        const volA = sA.statsB?.volume ?? 0;
        const volB = sB.statsB?.volume ?? 0;
        return sortAsc ? volA - volB : volB - volA;
      } else {
        return sortAsc
          ? (a.arbPct ?? 0) - (b.arbPct ?? 0)
          : (b.arbPct ?? 0) - (a.arbPct ?? 0);
      }
    });
    return arr.filter((r) => {
      if (marchMadnessOnly && !isMarchMadnessRow(r)) return false;
      if (liveOnly && !isLiveRow(r)) return false;

      // Filter by min arb %
      if (!ignoreMinArbPct && (r.arbPct ?? 0) < minArbPct) return false;

      // Filter by min Poly volume (column A = platformA)
      const mapped = getStatsForDisplay(r, platformA, platformB);
      if (minPolyVol > 0 && (mapped.statsA?.volume ?? 0) < minPolyVol)
        return false;

      // Filter by min OPN volume (column B = platformB)
      if (minOpnVol > 0 && (mapped.statsB?.volume ?? 0) < minOpnVol)
        return false;

      // Filter by min shares at best bid/ask level
      // Both sides of the arbitrage trade must have at least minShares
      if (minShares > 0 && r.sizes) {
        const relevantSizes = [];
        const polyLine = Array.isArray(r.strategy) ? r.strategy[0] || "" : "";
        const opLine = Array.isArray(r.strategy) ? r.strategy[1] || "" : "";

        // Determine which side is bought on each platform using the labels from prices
        const polyYesLabel = r.prices?.polyYesLabel || "YES";
        const opYesLabel = r.prices?.opYesLabel || "YES";

        // Poly side: if strategy line contains the "yes" label â†’ polyYes size, else polyNo size
        if (polyLine.includes(polyYesLabel))
          relevantSizes.push(r.sizes.polyYes);
        else relevantSizes.push(r.sizes.polyNo);

        // Opinion side: if strategy line contains the "yes" label â†’ opYes size, else opNo size
        if (opLine.includes(opYesLabel)) relevantSizes.push(r.sizes.opYes);
        else relevantSizes.push(r.sizes.opNo);

        // Filter out if we have no size data or any relevant side has less than minShares
        const validSizes = relevantSizes.filter(
          (s) => Number.isFinite(s) && s > 0,
        );
        if (validSizes.length === 0) return false; // No valid size data

        const minAvailable = Math.min(...validSizes);
        if (minAvailable < minShares) return false;
      }
      return true;
    });
  }, [
    displayRows,
    sortAsc,
    sortField,
    minArbPct,
    minShares,
    minPolyVol,
    minOpnVol,
    platformA,
    platformB,
    ignoreMinArbPct,
    marchMadnessOnly,
    liveOnly,
  ]);

  // Apply bonus filter
  const filteredSorted = useMemo(() => {
    let result = sorted;

    // Apply bonus filter
    if (bonusOnly) {
      result = result.filter((r) => {
        const marketId = String(r.opinionMarketId || "");
        return bonusSet.has(marketId);
      });
    }

    // Apply Probable boosted filter
    if (boostedProbableOnly) {
      result = result.filter((r) => {
        // Use the pre-computed flag from the engine (direct embed from events API)
        if (r.probableIsBoosted) return true;
        // Fallback: check against fetched boosted IDs list
        const pid = String(r.probableMarketId || "");
        return pid && probableBoostedSet.has(pid);
      });
    }

    // Apply Predict.fun boosted filter (active or upcoming boosts only, not expired)
    if (boostedPredictFunOnly) {
      const now = Date.now();
      result = result.filter((r) => {
        if (!r.predictfunIsBoosted) return false;
        const endsMs = r.predictfunBoostEndsAt
          ? Date.parse(r.predictfunBoostEndsAt)
          : null;
        return !endsMs || now < endsMs;
      });
    }

    return result;
  }, [
    sorted,
    bonusOnly,
    bonusSet,
    boostedProbableOnly,
    probableBoostedSet,
    boostedPredictFunOnly,
  ]);

  // Apply search filter
  const searchFilteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return filteredSorted;

    return filteredSorted.filter((r) => {
      // Search across all title fields
      const title = String(r?.title ?? "").toLowerCase();
      const opinionTitle = String(r?.opinionTitle ?? "").toLowerCase();
      const polyTitle = String(r?.polyTitle ?? "").toLowerCase();
      const parentTitle = String(r?.parentTitle ?? "").toLowerCase();
      const outcome = String(r?.outcome ?? "").toLowerCase();
      const marketId = String(r?.opinionMarketId ?? "");

      return (
        title.includes(query) ||
        opinionTitle.includes(query) ||
        polyTitle.includes(query) ||
        parentTitle.includes(query) ||
        outcome.includes(query) ||
        marketId.includes(query)
      );
    });
  }, [filteredSorted, searchQuery]);

  const itemsPerPage = isMobileView ? 20 : 100;
  const totalPages = Math.max(
    1,
    Math.ceil(searchFilteredRows.length / itemsPerPage),
  );

  // Keep page valid when result set changes
  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  // Reset to first page whenever filtering/sorting mode changes
  useEffect(() => {
    setCurrentPage(1);
  }, [
    priceMode,
    scanMode,
    searchQuery,
    minArbPct,
    minShares,
    minPolyVol,
    minOpnVol,
    bonusOnly,
    boostedProbableOnly,
    sortField,
    sortAsc,
  ]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return searchFilteredRows.slice(start, start + itemsPerPage);
  }, [searchFilteredRows, currentPage, itemsPerPage]);

  const pageNums = useMemo(() => {
    const max = totalPages;
    const cur = currentPage;
    const windowSize = 7;
    let start = Math.max(1, cur - Math.floor(windowSize / 2));
    let end = Math.min(max, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    const arr = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }, [currentPage, totalPages]);

  // Count bonus markets in current results
  const bonusCount = useMemo(() => {
    return sorted.filter((r) => bonusSet.has(String(r.opinionMarketId || "")))
      .length;
  }, [sorted, bonusSet]);

  // Count Probable boosted markets in current results
  const boostedProbableCount = useMemo(() => {
    return sorted.filter(
      (r) =>
        r.probableIsBoosted ||
        (r.probableMarketId &&
          probableBoostedSet.has(String(r.probableMarketId))),
    ).length;
  }, [sorted, probableBoostedSet]);

  // Count Predict.fun boosted markets in current results (active or upcoming, not expired)
  const boostedPredictFunCount = useMemo(() => {
    const now = Date.now();
    return sorted.filter((r) => {
      if (!r.predictfunIsBoosted) return false;
      const endsMs = r.predictfunBoostEndsAt
        ? Date.parse(r.predictfunBoostEndsAt)
        : null;
      return !endsMs || now < endsMs;
    }).length;
  }, [sorted]);

  // Progress bar percentage
  const progressPct =
    progress?.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;
  const showFullScanMatchedInTitle =
    scanMode === "full" && matchedMarketCount !== null && !loading;

  // Count to display in TITLE badge: filtered count when searching, total when not
  const titleBadgeCount =
    searchQuery.trim() || marchMadnessOnly || liveOnly
      ? searchFilteredRows.length
      : (matchedMarketCount ?? rows.length);
  const headerMatchedCount = marchMadnessOnly || liveOnly
    ? searchFilteredRows.length
    : (matchedMarketCount ?? rows.length);
  // Show badge when searching (always), or when we have loaded rows (any scan mode)
  const hasData = !loading && (rows.length > 0 || matchedMarketCount !== null);
  const showTitleBadge = (searchQuery.trim() && !loading) || hasData;

  return (
    <div
      className="arb-board"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {/* Header */}
      <div className="panel arb-header" style={{ padding: 16 }}>
        <div
          className="arb-header-top"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            position: "relative",
          }}
        >
          <div className="arb-header-left" style={{ flex: 1 }}>
            <div
              className="arb-title"
              style={{ fontSize: 22, fontWeight: 900 }}
            >
              Arbitrage
            </div>
            <div
              className="muted arb-subtitle"
              style={{ fontSize: 12, marginTop: 6 }}
            >
              Using best <b>ASK</b> prices from{" "}
              {platformA.charAt(0).toUpperCase() + platformA.slice(1)} &{" "}
              {platformB.charAt(0).toUpperCase() + platformB.slice(1)}.
              {loading && progress?.message && (
                <span style={{ marginLeft: 8, color: "rgba(255,180,50,0.9)" }}>
                  {progress.message}
                </span>
              )}
              {!loading && lastScanTime && (
                <span style={{ marginLeft: 8, color: "rgba(255,180,50,0.9)" }}>
                  Scanned {formatTimeAgo(lastScanTime)}. Found{" "}
                  {headerMatchedCount} pairs
                </span>
              )}
            </div>
            {err ? (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  fontWeight: 800,
                  color: "rgba(255,120,120,0.95)",
                }}
              >
                âš ï¸ {err}
              </div>
            ) : null}
          </div>

          {/* ── Exchange Selector — absolutely centered on desktop ── */}
          <div
            className="arb-header-exchange"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              pointerEvents: "auto",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "rgba(148,163,184,0.6)",
                  marginBottom: 3,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Exchange A
              </div>
              <PlatformSelect
                value={platformA}
                onChange={(val) => {
                  if (val === platformB) setPlatformB(platformA);
                  setPlatformA(val);
                }}
                disabled={loading}
                excludeValue={platformB}
              />
            </div>
            {/* Swap */}
            <button
              type="button"
              onClick={() => {
                setPlatformA(platformB);
                setPlatformB(platformA);
              }}
              disabled={loading}
              aria-label="Swap exchanges"
              style={{
                marginBottom: 1,
                padding: "7px 9px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.11)",
                borderRadius: 8,
                cursor: loading ? "not-allowed" : "pointer",
                color: "rgba(148,163,184,0.85)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!loading)
                  e.currentTarget.style.background = "rgba(255,255,255,0.11)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 16l-4-4 4-4" />
                <path d="M17 8l4 4-4 4" />
                <line x1="3" y1="12" x2="21" y2="12" />
              </svg>
            </button>
            <div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "rgba(148,163,184,0.6)",
                  marginBottom: 3,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Exchange B
              </div>
              <PlatformSelect
                value={platformB}
                onChange={(val) => {
                  if (val === platformA) setPlatformA(platformB);
                  setPlatformB(val);
                }}
                disabled={loading}
                excludeValue={platformA}
              />
            </div>
          </div>

          <div
            className="arb-header-right"
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flex: "0 0 auto",
            }}
          >
            <div
              className="arb-scan-btn-wrap"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              {loading ? (
                <button
                  className="btn arb-cancel-btn"
                  type="button"
                  onClick={cancelScan}
                  style={{
                    minWidth: 128,
                    padding: "9px 16px",
                    borderRadius: 10,
                    border: "1px solid rgba(239,68,68,0.55)",
                    background:
                      "linear-gradient(135deg, rgba(239,68,68,0.22), rgba(220,50,50,0.25))",
                    color: "rgba(255,200,200,0.98)",
                    fontSize: 13,
                    fontWeight: 900,
                    letterSpacing: 0.2,
                    boxShadow:
                      "0 4px 14px rgba(239,68,68,0.15), 0 0 0 1px rgba(239,68,68,0.12) inset",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    cursor: "pointer",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ opacity: 0.95 }}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M15 9l-6 6" />
                    <path d="M9 9l6 6" />
                  </svg>
                  Cancel
                </button>
              ) : (
                <button
                  className="btn arb-scan-now-btn"
                  type="button"
                  onClick={handleRefresh}
                  style={{
                    minWidth: 128,
                    padding: "9px 16px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,180,50,0.65)",
                    background:
                      "linear-gradient(135deg, rgba(255,190,70,0.28), rgba(255,140,30,0.32))",
                    color: "rgba(255,242,220,0.98)",
                    fontSize: 13,
                    fontWeight: 900,
                    letterSpacing: 0.2,
                    boxShadow:
                      "0 6px 18px rgba(255,150,40,0.2), 0 0 0 1px rgba(255,190,70,0.12) inset",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    cursor: "pointer",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ opacity: 0.95 }}
                  >
                    <path d="M21 2v6h-6" />
                    <path d="M3 22v-6h6" />
                    <path d="M3.51 9a9 9 0 0114.13-3.36L21 8" />
                    <path d="M20.49 15a9 9 0 01-14.13 3.36L3 16" />
                  </svg>
                  Scan Now
                </button>
              )}
            </div>

            {/* Filter toggle */}
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="btn ghost arb-filter-btn"
              aria-label={showFilters ? "Hide filters" : "Show filters"}
              aria-expanded={showFilters}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 800,
                background: showFilters
                  ? "rgba(59,130,246,0.16)"
                  : "rgba(255,255,255,0.02)",
                border: showFilters
                  ? "1px solid rgba(59,130,246,0.45)"
                  : "1px solid rgba(148,163,184,0.22)",
                color: showFilters
                  ? "rgba(191,219,254,0.98)"
                  : "rgba(203,213,225,0.9)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              Filters
            </button>
            {/* Asks mode only */}
            <div
              className="arb-mode-toggle"
              role="group"
              aria-label="Price mode selection"
              style={{
                display: "flex",
                gap: 4,
                background: "rgba(255,255,255,0.05)",
                borderRadius: 8,
                padding: 3,
              }}
            >
              <div
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 800,
                  borderRadius: 6,
                  border: "none",
                  cursor: "default",
                  background: "rgba(181, 53, 56, 0.9)",
                  color: "#ffffff",
                }}
              >
                Asks Mode
              </div>
            </div>
          </div>
        </div>

        {/* Platform Selector — mobile-only (hidden on desktop via CSS, shown on mobile) */}
        <div
          className="arb-platform-selector arb-platform-selector-mobile"
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            gap: 8,
            marginTop: 10,
            padding: "7px 10px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <PlatformSelect
              value={platformA}
              onChange={(val) => {
                if (val === platformB) {
                  setPlatformB(platformA);
                }
                setPlatformA(val);
              }}
              disabled={loading}
              excludeValue={platformB}
              width="100%"
            />
          </div>
          {/* Swap Button */}
          <button
            type="button"
            onClick={() => {
              setPlatformA(platformB);
              setPlatformB(platformA);
            }}
            disabled={loading}
            aria-label="Swap exchanges"
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              padding: 0,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              cursor: loading ? "not-allowed" : "pointer",
              color: "rgba(148,163,184,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!loading)
                e.currentTarget.style.background = "rgba(255,255,255,0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 16l-4-4 4-4" />
              <path d="M17 8l4 4-4 4" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <PlatformSelect
              value={platformB}
              onChange={(val) => {
                if (val === platformA) {
                  setPlatformA(platformB);
                }
                setPlatformB(val);
              }}
              disabled={loading}
              excludeValue={platformA}
              width="100%"
            />
          </div>
        </div>

        {/* Filter Panel (Collapsible) */}
        {showFilters && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: "rgba(255,255,255,0.03)",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 24,
                flexWrap: "wrap",
                alignItems: "flex-start",
                rowGap: 16,
              }}
            >
              {/* Min Arb % */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "rgba(233,238,245,0.6)",
                    height: 13,
                  }}
                >
                  MIN ARB %
                </label>
                <input
                  type="number"
                  value={minArbPct}
                  onChange={(e) =>
                    setMinArbPct(Math.max(0, parseFloat(e.target.value) || 0))
                  }
                  step="0.1"
                  min="0"
                  style={{
                    width: 90,
                    height: 38,
                    padding: "0 10px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 6,
                    color: "#e9eef5",
                    outline: "none",
                  }}
                />
              </div>

              {/* Min Shares */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "rgba(233,238,245,0.6)",
                    height: 13,
                  }}
                >
                  MIN SHARES
                </label>
                <input
                  type="number"
                  value={minShares}
                  onChange={(e) =>
                    setMinShares(Math.max(0, parseInt(e.target.value) || 0))
                  }
                  step="100"
                  min="0"
                  placeholder="0"
                  style={{
                    width: 90,
                    height: 38,
                    padding: "0 10px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 6,
                    color: "#e9eef5",
                    outline: "none",
                  }}
                />
              </div>

              {/* Scan Mode */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "rgba(233,238,245,0.6)",
                    height: 13,
                  }}
                >
                  SCAN MODE
                </label>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    height: 38,
                    alignItems: "stretch",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      padding: "0 12px",
                      borderRadius: 6,
                      background:
                        scanMode === "quick"
                          ? "rgba(80,200,120,0.15)"
                          : "rgba(0,0,0,0.2)",
                      border:
                        scanMode === "quick"
                          ? "1px solid rgba(80,200,120,0.4)"
                          : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="quick"
                      checked={scanMode === "quick"}
                      onChange={() => setScanMode("quick")}
                      style={{ accentColor: "rgb(80,200,120)" }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color:
                          scanMode === "quick"
                            ? "rgba(80,200,120,0.95)"
                            : "rgba(233,238,245,0.7)",
                      }}
                    >
                      Quick Scan
                    </span>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      padding: "0 12px",
                      borderRadius: 6,
                      background:
                        scanMode === "med"
                          ? "rgba(100,160,255,0.15)"
                          : "rgba(0,0,0,0.2)",
                      border:
                        scanMode === "med"
                          ? "1px solid rgba(100,160,255,0.4)"
                          : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="med"
                      checked={scanMode === "med"}
                      onChange={() => setScanMode("med")}
                      style={{ accentColor: "rgb(100,160,255)" }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color:
                          scanMode === "med"
                            ? "rgba(100,160,255,0.95)"
                            : "rgba(233,238,245,0.7)",
                      }}
                    >
                      Med Scan
                    </span>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      padding: "0 12px",
                      borderRadius: 6,
                      background:
                        scanMode === "full"
                          ? "rgba(255,180,50,0.15)"
                          : "rgba(0,0,0,0.2)",
                      border:
                        scanMode === "full"
                          ? "1px solid rgba(255,180,50,0.4)"
                          : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="full"
                      checked={scanMode === "full"}
                      onChange={() => setScanMode("full")}
                      style={{ accentColor: "rgb(255,180,50)" }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color:
                          scanMode === "full"
                            ? "rgba(255,180,50,0.95)"
                            : "rgba(233,238,245,0.7)",
                      }}
                    >
                      Full Scan
                    </span>
                  </label>
                </div>
              </div>

              {/* Bonus Only Filter - only shown when Opinion is one of the selected platforms */}
              {(platformA === "opinion" || platformB === "opinion") && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "rgba(233,238,245,0.6)",
                      height: 13,
                    }}
                  >
                    OPN BONUS FILTER
                  </label>
                  <button
                    type="button"
                    onClick={() => setBonusOnly((v) => !v)}
                    style={{
                      height: 38,
                      padding: "0 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: bonusOnly
                        ? "rgba(245, 200, 75, 0.15)"
                        : "rgba(0,0,0,0.2)",
                      border: bonusOnly
                        ? "1px solid rgba(245, 200, 75, 0.5)"
                        : "1px solid rgba(255,255,255,0.1)",
                      color: bonusOnly ? "#F5C84B" : "rgba(233,238,245,0.7)",
                      fontSize: 12,
                      fontWeight: 700,
                      transition: "all 0.2s",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/gift_icon_24.svg"
                      alt=""
                      width={32}
                      height={32}
                      style={{ opacity: bonusOnly ? 1 : 0.5 }}
                    />
                    <span>Bonus Only</span>
                    {bonusScanStatus === "scanning" ? (
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "rgba(100,150,255,0.2)",
                          fontSize: 10,
                          fontWeight: 800,
                          color: "rgba(150,200,255,0.9)",
                        }}
                      >
                        Scanning...
                      </span>
                    ) : (
                      bonusCount > 0 && (
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: bonusOnly
                              ? "rgba(245, 200, 75, 0.25)"
                              : "rgba(255,255,255,0.1)",
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        >
                          {bonusCount}
                        </span>
                      )
                    )}
                  </button>
                </div>
              )}

              {/* Boosted Points Filter (Probable only) */}
              {(platformA === "probable" || platformB === "probable") && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "rgba(233,238,245,0.6)",
                      height: 13,
                    }}
                  >
                    BOOST FILTER
                  </label>
                  <button
                    type="button"
                    onClick={() => setBoostedProbableOnly((v) => !v)}
                    style={{
                      height: 38,
                      padding: "0 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: boostedProbableOnly
                        ? "rgba(168,85,247,0.15)"
                        : "rgba(0,0,0,0.2)",
                      border: boostedProbableOnly
                        ? "1px solid rgba(168,85,247,0.55)"
                        : "1px solid rgba(255,255,255,0.1)",
                      color: boostedProbableOnly
                        ? "rgba(216,180,254,1)"
                        : "rgba(233,238,245,0.7)",
                      fontSize: 12,
                      fontWeight: 700,
                      transition: "all 0.2s",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/probable_logo.svg"
                      alt=""
                      width={20}
                      height={20}
                      style={{
                        opacity: boostedProbableOnly ? 1 : 0.45,
                        flexShrink: 0,
                      }}
                    />
                    <span>Boosted Only</span>
                    {boostedProbableCount > 0 && (
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: boostedProbableOnly
                            ? "rgba(168,85,247,0.3)"
                            : "rgba(255,255,255,0.1)",
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        {boostedProbableCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* Predict.fun Boost Filter */}
              {(platformA === "predictfun" || platformB === "predictfun") && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "rgba(233,238,245,0.6)",
                      height: 13,
                    }}
                  >
                    PF BOOSTED FILTER
                  </label>
                  <button
                    type="button"
                    onClick={() => setBoostedPredictFunOnly((v) => !v)}
                    style={{
                      height: 38,
                      padding: "0 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: boostedPredictFunOnly
                        ? "rgba(99,102,241,0.18)"
                        : "rgba(0,0,0,0.2)",
                      border: boostedPredictFunOnly
                        ? "1px solid rgba(99,102,241,0.6)"
                        : "1px solid rgba(255,255,255,0.1)",
                      color: boostedPredictFunOnly
                        ? "rgba(165,180,252,1)"
                        : "rgba(233,238,245,0.7)",
                      fontSize: 12,
                      fontWeight: 700,
                      transition: "all 0.2s",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={PREDICTFUN_LOGO_SRC}
                      alt=""
                      width={18}
                      height={18}
                      style={{
                        opacity: boostedPredictFunOnly ? 1 : 0.45,
                        flexShrink: 0,
                        borderRadius: 3,
                      }}
                    />
                    <span>Boosted Only</span>
                    {boostedPredictFunCount > 0 && (
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: boostedPredictFunOnly
                            ? "rgba(99,102,241,0.3)"
                            : "rgba(255,255,255,0.1)",
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        {boostedPredictFunCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* March Madness Filter - Poly + Predict.fun only */}
              {isPolyPredictFunPair && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "rgba(233,238,245,0.6)",
                      height: 13,
                    }}
                  >
                    MARCH MADNESS
                  </label>
                  <button
                    type="button"
                    onClick={() => setMarchMadnessOnly((v) => !v)}
                    style={{
                      height: 38,
                      padding: "0 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: marchMadnessOnly
                        ? "rgba(24,18,9,0.96)"
                        : "rgba(0,0,0,0.2)",
                      border: marchMadnessOnly
                        ? "1px solid rgba(249,168,37,0.8)"
                        : "1px solid rgba(255,255,255,0.1)",
                      boxShadow: marchMadnessOnly
                        ? "0 0 0 1px rgba(255,197,92,0.08) inset"
                        : "0 0 0 1px rgba(0,0,0,0.18) inset",
                      color: marchMadnessOnly
                        ? "rgba(255,180,50,1)"
                        : "rgba(233,238,245,0.7)",
                      fontSize: 12,
                      fontWeight: 700,
                      transition: "all 0.2s",
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                      style={{
                        flexShrink: 0,
                        opacity: marchMadnessOnly ? 1 : 0.55,
                      }}
                    >
                      <circle cx="12" cy="12" r="9" fill="currentColor" />
                      <path
                        d="M4.1 8.2c3.2 1 5.3 3.2 6.2 6.6"
                        stroke="rgba(37,23,7,0.92)"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                      />
                      <path
                        d="M19.9 8.2c-3.2 1-5.3 3.2-6.2 6.6"
                        stroke="rgba(37,23,7,0.92)"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                      />
                      <path
                        d="M8.2 4.2c1.9 2 2.9 4.7 2.9 7.8s-1 5.8-2.9 7.8"
                        stroke="rgba(37,23,7,0.92)"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                      />
                      <path
                        d="M15.8 4.2c-1.9 2-2.9 4.7-2.9 7.8s1 5.8 2.9 7.8"
                        stroke="rgba(37,23,7,0.92)"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span>March Madness</span>
                  </button>
                </div>
              )}

              {/* Live Filter - Poly + Predict.fun only */}
              {isPolyPredictFunPair && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "rgba(233,238,245,0.6)",
                      height: 13,
                    }}
                  >
                    LIVE
                  </label>
                  <button
                    type="button"
                    onClick={() => setLiveOnly((v) => !v)}
                    style={{
                      height: 38,
                      padding: "0 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: liveOnly
                        ? "rgba(9,24,18,0.96)"
                        : "rgba(0,0,0,0.2)",
                      border: liveOnly
                        ? "1px solid rgba(52,211,153,0.8)"
                        : "1px solid rgba(255,255,255,0.1)",
                      boxShadow: liveOnly
                        ? "0 0 0 1px rgba(52,211,153,0.08) inset"
                        : "0 0 0 1px rgba(0,0,0,0.18) inset",
                      color: liveOnly
                        ? "rgba(52,211,153,1)"
                        : "rgba(233,238,245,0.7)",
                      fontSize: 12,
                      fontWeight: 700,
                      transition: "all 0.2s",
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                      style={{
                        flexShrink: 0,
                        opacity: liveOnly ? 1 : 0.55,
                      }}
                    >
                      <circle cx="12" cy="12" r="4" fill="currentColor" />
                      <path
                        d="M8 5.5a8 8 0 0 0 0 13"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                      <path
                        d="M16 5.5a8 8 0 0 1 0 13"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                      <path
                        d="M5.5 3a11.5 11.5 0 0 0 0 18"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                      <path
                        d="M18.5 3a11.5 11.5 0 0 1 0 18"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span>Live</span>
                  </button>
                </div>
              )}

              {/* Min Platform A Volume */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "rgba(233,238,245,0.6)",
                    height: 13,
                  }}
                >
                  MIN{" "}
                  {platformShortNameMap[platformA] || platformA.toUpperCase()}{" "}
                  VOLUME
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={
                    minPolyVol > 0 ? minPolyVol.toLocaleString("en-US") : ""
                  }
                  placeholder="0"
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, "");
                    setMinPolyVol(raw ? Number(raw) : 0);
                  }}
                  style={{
                    height: 38,
                    width: 120,
                    padding: "0 10px",
                    borderRadius: 6,
                    border:
                      minPolyVol > 0
                        ? `1px solid ${platformVolBorderColor[platformA] || "rgba(96,165,250,0.5)"}`
                        : "1px solid rgba(255,255,255,0.1)",
                    background:
                      minPolyVol > 0
                        ? platformVolBgColor[platformA] ||
                          "rgba(96,165,250,0.1)"
                        : "rgba(0,0,0,0.2)",
                    color: "rgba(233,238,245,0.9)",
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              </div>

              {/* Min Platform B Volume */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "rgba(233,238,245,0.6)",
                    height: 13,
                  }}
                >
                  MIN{" "}
                  {platformShortNameMap[platformB] || platformB.toUpperCase()}{" "}
                  VOLUME
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={minOpnVol > 0 ? minOpnVol.toLocaleString("en-US") : ""}
                  placeholder="0"
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, "");
                    setMinOpnVol(raw ? Number(raw) : 0);
                  }}
                  style={{
                    height: 38,
                    width: 120,
                    padding: "0 10px",
                    borderRadius: 6,
                    border:
                      minOpnVol > 0
                        ? `1px solid ${platformVolBorderColor[platformB] || "rgba(249,115,22,0.5)"}`
                        : "1px solid rgba(255,255,255,0.1)",
                    background:
                      minOpnVol > 0
                        ? platformVolBgColor[platformB] ||
                          "rgba(249,115,22,0.1)"
                        : "rgba(0,0,0,0.2)",
                    color: "rgba(233,238,245,0.9)",
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              </div>
            </div>
            {/* Scan mode description - moved outside to avoid height mismatch */}
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "rgba(233,238,245,0.6)",
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {scanMode === "quick"
                ? "Quick scan: Top 90 markets. Results almost instantly."
                : scanMode === "med"
                  ? "Med scan: Top 300 markets. May take up to 30 seconds."
                  : "Full scan: All markets. May take up to 1 minute."}
            </div>
            {ignoreMinArbPct && (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "rgba(245,158,11,0.9)",
                  marginTop: 6,
                }}
              >
                March Madness scan includes negative spread rows and ignores Min
                Arb %.
              </div>
            )}
          </div>
        )}

        {/* Progress bar during streaming */}
        {loading && progress && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                height: 4,
                background: "rgba(255,255,255,0.1)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progressPct}%`,
                  background: "rgba(255,180,50,0.9)",
                  borderRadius: 2,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 6,
              }}
            >
              <div className="muted" style={{ fontSize: 11 }}>
                {progress.phase === "discovering" && "Scanning markets..."}
                {progress.phase === "matching" &&
                  `Found ${progress.total} potential pairs`}
                {progress.phase === "processing" &&
                  `Processing ${progress.current}/${progress.total} pairs`}
                {streamingRows.length > 0 && (
                  <span
                    style={{
                      marginLeft: 8,
                      color: "rgba(80,200,120,0.95)",
                      fontWeight: 800,
                    }}
                  >
                    • {streamingRows.length} opportunities found
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={cancelScan}
                style={{
                  padding: "4px 14px",
                  borderRadius: 6,
                  border: "1px solid rgba(239,68,68,0.45)",
                  background: "rgba(239,68,68,0.15)",
                  color: "rgba(255,180,180,0.95)",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  whiteSpace: "nowrap",
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M15 9l-6 6" />
                  <path d="M9 9l6 6" />
                </svg>
                Stop Scan
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative", flex: 1 }}>
            {/* Search Icon */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "rgba(255,255,255,0.4)",
                pointerEvents: "none",
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search arbitrage opportunities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 16px 10px 40px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "#fff",
                outline: "none",
                fontSize: 14,
                fontWeight: 500,
                boxSizing: "border-box",
              }}
            />
          </div>
          {/* Auto Scan toggle - only visible when Live filter is active */}
          {liveOnly && (
            <button
              type="button"
              onClick={() => setAutoScanEnabled((v) => !v)}
              style={{
                height: 38,
                padding: "0 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 8,
                cursor: "pointer",
                background: autoScanEnabled
                  ? "rgba(9,24,18,0.96)"
                  : "rgba(0,0,0,0.2)",
                border: autoScanEnabled
                  ? "1px solid rgba(52,211,153,0.8)"
                  : "1px solid rgba(255,255,255,0.12)",
                boxShadow: autoScanEnabled
                  ? "0 0 8px rgba(52,211,153,0.25)"
                  : "none",
                color: autoScanEnabled
                  ? "rgba(52,211,153,1)"
                  : "rgba(233,238,245,0.7)",
                fontSize: 13,
                fontWeight: 700,
                whiteSpace: "nowrap",
                transition: "all 0.2s",
                flexShrink: 0,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ opacity: autoScanEnabled ? 1 : 0.55 }}
              >
                <path d="M21 12a9 9 0 1 1-6.2-8.6" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
              <span>Auto Scan</span>
              {autoScanEnabled && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "rgba(52,211,153,1)",
                    boxShadow: "0 0 6px rgba(52,211,153,0.6)",
                    animation: "pulse 1.5s ease-in-out infinite",
                  }}
                />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Single panel wrapper for header + rows — guarantees separator alignment */}
      <div className="panel" style={{ borderRadius: 14, overflow: "hidden" }}>
        {/* Table Header */}
        <div
          className="arb-table-header"
          style={{
            padding: "10px 14px",
            display: "grid",
            gridTemplateColumns:
              "var(--arbitrage-desktop-grid-columns, 1.1fr 0.45fr 0.42fr 0.42fr 0.55fr 0.32fr 0.24fr)",
            gap: 10,
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 900,
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "rgba(233,238,245,0.9)",
            }}
          >
            <span>Title</span>
            {showTitleBadge && (
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.1)",
                  fontSize: 12,
                  fontWeight: 800,
                  lineHeight: 1.2,
                  textTransform: "none",
                }}
              >
                {titleBadgeCount}
              </span>
            )}
          </div>
          <div
            style={{
              fontWeight: 900,
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "rgba(233,238,245,0.9)",
              borderLeft: "1px solid rgba(255,255,255,0.10)",
              paddingLeft: 10,
            }}
          >
            Strategy
          </div>
          <div
            style={{
              fontWeight: 900,
              color:
                sortField === "polyVolume"
                  ? "rgba(255,180,50,1)"
                  : platformColorMap[platformA] || "rgba(96,165,250,0.95)",
              textAlign: "left",
              textTransform: "uppercase",
              fontSize: 13,
              letterSpacing: 0.5,
              borderLeft: "1px solid rgba(255,255,255,0.10)",
              paddingLeft: 10,
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => {
              if (sortField === "polyVolume") {
                setSortAsc((v) => !v);
              } else {
                setSortField("polyVolume");
                setSortAsc(false); // Start with highest first
              }
            }}
            title={`Click to sort by ${platformDisplayMap[platformA] || "Platform A"} 24h volume`}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
              }}
            >
              {platformDisplayMap[platformA] || "Platform A"} Stats
              <ArbSortIcon
                active={sortField === "polyVolume"}
                direction={sortAsc}
              />
            </span>
          </div>
          <div
            style={{
              fontWeight: 900,
              color:
                sortField === "opinionVolume"
                  ? "rgba(255,180,50,1)"
                  : platformColorMap[platformB] || "rgba(249,115,22,1)",
              textAlign: "left",
              textTransform: "uppercase",
              fontSize: 13,
              letterSpacing: 0.5,
              borderLeft: "1px solid rgba(255,255,255,0.10)",
              paddingLeft: 10,
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => {
              if (sortField === "opinionVolume") {
                setSortAsc((v) => !v);
              } else {
                setSortField("opinionVolume");
                setSortAsc(false); // Start with highest first
              }
            }}
            title={`Click to sort by ${platformDisplayMap[platformB] || "Platform B"} 24h volume`}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
              }}
            >
              {platformDisplayMap[platformB] || "Platform B"} Stats
              <ArbSortIcon
                active={sortField === "opinionVolume"}
                direction={sortAsc}
              />
            </span>
          </div>
          <div
            style={{
              fontWeight: 900,
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "rgba(233,238,245,0.9)",
              textAlign: "left",
              justifySelf: "start",
              borderLeft: "1px solid rgba(255,255,255,0.10)",
              paddingLeft: 10,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
              }}
            >
              Order Book
            </span>
          </div>
          <div
            style={{
              fontWeight: 900,
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color:
                sortField === "endDate"
                  ? "rgba(255,180,50,1)"
                  : "rgba(233,238,245,0.9)",
              textAlign: "left",
              borderLeft: "1px solid rgba(255,255,255,0.10)",
              paddingLeft: 10,
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => {
              if (sortField === "endDate") {
                setSortAsc((v) => !v);
              } else {
                setSortField("endDate");
                setSortAsc(true); // Soonest first
              }
            }}
            title="Click to sort by expiration date"
          >
            <span style={{ display: "flex", alignItems: "center" }}>
              Expires
              <ArbSortIcon
                active={sortField === "endDate"}
                direction={sortAsc}
              />
            </span>
          </div>
          <div
            style={{
              fontWeight: 900,
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color:
                sortField === "arbPct"
                  ? "rgba(255,180,50,1)"
                  : "rgba(233,238,245,0.9)",
              textAlign: "right",
              cursor: "pointer",
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 4,
              borderLeft: "1px solid rgba(255,255,255,0.10)",
              paddingLeft: 10,
            }}
            onClick={() => {
              if (sortField === "arbPct") {
                setSortAsc((v) => !v);
              } else {
                setSortField("arbPct");
                setSortAsc(false); // Start with highest first
              }
            }}
            title="Click to sort by arbitrage percentage"
          >
            <span style={{ display: "flex", alignItems: "center" }}>
              Arbitrage
              <ArbSortIcon
                active={sortField === "arbPct"}
                direction={sortAsc}
              />
            </span>
          </div>
        </div>

        {loading && sorted.length === 0 ? (
          <SkeletonRows inPanel />
        ) : !hasScanned && sorted.length === 0 ? (
          /* User hasn't scanned yet - show prompt */
          <div style={{ padding: "60px 20px", textAlign: "center" }}>
            <div style={{ marginBottom: 16, opacity: 0.4 }}>
              <svg
                width="42"
                height="42"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "rgba(233,238,245,0.85)",
                marginBottom: 8,
              }}
            >
              Press "
              <span style={{ color: "rgba(255,180,50,1)" }}>Scan Now</span>" to
              find Arbitrage Opportunities
            </div>
            <div
              className="muted"
              style={{ fontSize: 12, maxWidth: 400, margin: "0 auto" }}
            >
              It may take up to 30 seconds to fully load.
            </div>
          </div>
        ) : searchFilteredRows.length === 0 && !loading ? (
          <div style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 13, fontWeight: 800 }}>
              {searchQuery.trim()
                ? `No results found for "${searchQuery.trim()}"`
                : bonusOnly
                  ? `No bonus markets with arbitrage ≥ ${minArbPct.toFixed(2)}% found.`
                  : boostedProbableOnly
                    ? `No boosted Probable markets with arbitrage ≥ ${minArbPct.toFixed(2)}% found.`
                    : boostedPredictFunOnly
                      ? `No boosted Predict.fun markets with arbitrage ≥ ${minArbPct.toFixed(2)}% found.`
                      : ignoreMinArbPct
                        ? "No March Madness arbitrage matches found."
                        : `No arbitrage opportunities ≥ ${minArbPct.toFixed(2)}% found.`}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {searchQuery.trim()
                ? "Try a different search term or clear the search."
                : bonusOnly
                  ? "Try disabling the bonus filter or adjusting other filters."
                  : boostedProbableOnly
                    ? "Try disabling the Probable boosted filter or adjusting other filters."
                    : boostedPredictFunOnly
                      ? "Try disabling the Predict.fun boost filter or adjusting other filters."
                      : "Try scanning again, or adjust your filters."}
            </div>
          </div>
        ) : (
          <>
            {paginatedRows.map((r) => (
              <Row
                key={r.id}
                r={r}
                priceMode={priceMode}
                marchMadnessOnly={marchMadnessOnly}
                liveOnly={liveOnly}
                displayPlatformA={platformA}
                displayPlatformB={platformB}
                isBonus={bonusSet.has(String(r.opinionMarketId || ""))}
                isBoostedProbable={
                  r.probableIsBoosted ||
                  probableBoostedSet.has(String(r.probableMarketId || ""))
                }
                isBoostedPredictFun={!!r.predictfunIsBoosted}
                pfBoostStartsAtMs={
                  r.predictfunBoostStartsAt
                    ? Date.parse(r.predictfunBoostStartsAt)
                    : null
                }
                pfBoostEndsAtMs={
                  r.predictfunBoostEndsAt
                    ? Date.parse(r.predictfunBoostEndsAt)
                    : null
                }
                onCalculatorClick={() => setCalculatorRow(r)}
              />
            ))}
            {loading && (
              <div style={{ padding: 14, textAlign: "center" }}>
                <div
                  className="muted"
                  style={{ fontSize: 12, fontWeight: 800 }}
                >
                  Loading more opportunities...
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* end single panel wrapper */}

      {searchFilteredRows.length > itemsPerPage && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 8,
            paddingBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <PagerButton
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span style={{ marginLeft: 4 }}>Prev</span>
            </PagerButton>

            {pageNums[0] > 1 && (
              <>
                <PagerButton
                  onClick={() => setCurrentPage(1)}
                  active={currentPage === 1}
                >
                  1
                </PagerButton>
                {pageNums[0] > 2 && (
                  <span style={{ opacity: 0.6, fontSize: 12 }}>...</span>
                )}
              </>
            )}

            {pageNums.map((p) => (
              <PagerButton
                key={p}
                onClick={() => setCurrentPage(p)}
                active={p === currentPage}
              >
                {p}
              </PagerButton>
            ))}

            {pageNums[pageNums.length - 1] < totalPages && (
              <>
                {pageNums[pageNums.length - 1] < totalPages - 1 && (
                  <span style={{ opacity: 0.6, fontSize: 12 }}>...</span>
                )}
                <PagerButton
                  onClick={() => setCurrentPage(totalPages)}
                  active={currentPage === totalPages}
                >
                  {totalPages}
                </PagerButton>
              </>
            )}

            <PagerButton
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <span style={{ marginRight: 4 }}>Next</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </PagerButton>
          </div>
        </div>
      )}

      {/* Calculator Modal */}
      {calculatorRow && (
        <ArbCalculatorModal
          row={calculatorRow}
          onClose={() => setCalculatorRow(null)}
        />
      )}
    </div>
  );
}

function PagerButton({ children, onClick, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 30,
        padding: "0 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,.12)",
        background: active ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.18)",
        color: "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: active ? 900 : 800,
        opacity: disabled ? 0.45 : 0.95,
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      {children}
    </button>
  );
}

/* ========================================
   MiniOrderbook — compact 3-ask + 3-bid view
   Shown inline in each arbitrage row.
   User can toggle between Poly and Opinion side.
   Shows the action-relevant outcome side:
     e.g. strategy = "Buy YES (Poly), Buy NO (Opinion)"
     or "Sell YES (Poly), Sell NO (Opinion)"
======================================== */
function MiniOrderbook({ row, priceMode }) {
  // Map platform names to the API "platform" param values
  const pA = row.platformA || row.sideA?.platform || "polymarket";
  const pB = row.platformB || row.sideB?.platform || "opinion";
  const apiPlatformA = pA === "polymarket" ? "poly" : pA; // API uses "poly" not "polymarket"
  const apiPlatformB = pB === "polymarket" ? "poly" : pB;
  const labelA = platformDisplayMap[pA] || pA;
  const labelB = platformDisplayMap[pB] || pB;

  const [platform, setPlatform] = useState(apiPlatformB); // default to side B
  const [ob, setOb] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Strategy lines: ["Buy YES (Poly)", "Buy NO (Probable)"] or ["Sell YES (Poly)", ...]
  // Parse which side (YES/NO) each platform references from the label text.
  // prices.opTag = sideA tag, prices.polyTag = sideB tag (legacy naming)
  const strategyLines = row.strategy ?? [];
  const tagA = row.prices?.opTag || "";
  const tagB = row.prices?.polyTag || "";

  const resolveOutcome = (line, yesLabel, noLabel) => {
    const text = String(line || "").toLowerCase();
    const yesText = String(yesLabel || "").toLowerCase();
    const noText = String(noLabel || "").toLowerCase();

    if (
      yesText &&
      text.includes(yesText) &&
      (!noText || !text.includes(noText) || yesText === noText)
    )
      return true;
    if (
      noText &&
      text.includes(noText) &&
      (!yesText || !text.includes(yesText) || yesText === noText)
    )
      return false;

    const fallback = text.match(/\b(yes|no)\b/i)?.[1]?.toLowerCase();
    if (fallback === "yes") return true;
    if (fallback === "no") return false;

    return true;
  };

  const sideALine =
    strategyLines.find((l) => l.includes(`(${tagA})`)) ||
    strategyLines[1] ||
    "";
  const sideBLine =
    strategyLines.find((l) => l.includes(`(${tagB})`)) ||
    strategyLines[0] ||
    "";

  const sideAUsesYes = resolveOutcome(
    sideALine,
    row.prices?.opYesLabel || "YES",
    row.prices?.opNoLabel || "NO",
  );
  const sideBUsesYes = resolveOutcome(
    sideBLine,
    row.prices?.polyYesLabel || "YES",
    row.prices?.polyNoLabel || "NO",
  );

  // Token IDs: opYes/opNo = sideA tokens, polyYes/polyNo = sideB tokens (legacy naming)
  const rawIds = row.tokenIds || null;
  const sideAYesTid = rawIds?.opYes || null;
  const sideANoTid = rawIds?.opNo || null;
  const sideBYesTid = rawIds?.polyYes || null;
  const sideBNoTid = rawIds?.polyNo || null;

  const hasTokenIds = Boolean(
    sideAYesTid && sideANoTid && sideBYesTid && sideBNoTid,
  );

  // Derive the specific token ID to fetch based on platform + strategy side
  const activeTokenId = useMemo(() => {
    if (!hasTokenIds) return null;
    if (platform === apiPlatformA) {
      // Side A tokens
      return sideAUsesYes ? sideAYesTid : sideANoTid;
    } else {
      // Side B tokens
      return sideBUsesYes ? sideBYesTid : sideBNoTid;
    }
  }, [
    platform,
    apiPlatformA,
    sideAUsesYes,
    sideBUsesYes,
    sideAYesTid,
    sideANoTid,
    sideBYesTid,
    sideBNoTid,
    hasTokenIds,
  ]);

  useEffect(() => {
    setPlatform(apiPlatformB);
    setOb(null);
  }, [row.id, apiPlatformB]);

  useEffect(() => {
    setOb(null);
  }, [platform, activeTokenId]);

  // Labels: opYesLabel/opNoLabel = sideA labels, polyYesLabel/polyNoLabel = sideB labels (legacy)
  const sideLabel =
    platform === apiPlatformA
      ? sideAUsesYes
        ? row.prices?.opYesLabel || "YES"
        : row.prices?.opNoLabel || "NO"
      : sideBUsesYes
        ? row.prices?.polyYesLabel || "YES"
        : row.prices?.polyNoLabel || "NO";

  // Fetch orderbook when expanded, platform changes, or refresh triggered
  useEffect(() => {
    if (!expanded || !activeTokenId) return;

    let cancelled = false;
    setLoading(true);

    fetch(
      `/api/arbitage/orderbook?platform=${platform}&token_id=${encodeURIComponent(activeTokenId)}&t=${refreshKey}`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) {
          setOb(data);
        } else {
          setOb(null);
        }
      })
      .catch(() => {
        if (!cancelled) setOb(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [expanded, platform, activeTokenId, refreshKey]);

  if (!hasTokenIds) {
    return (
      <div className="muted" style={{ fontSize: 11 }}>
        No data
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{
          padding: "6px 10px",
          fontSize: 11,
          fontWeight: 700,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          color: "rgba(233,238,245,0.8)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
        View Order Book
      </button>
    );
  }

  const asks = (ob?.asks || []).slice(0, 3);
  const bids = (ob?.bids || []).slice(0, 3);

  // For depth bars: find max shares for normalization
  const allEntries = [...asks, ...bids];
  const maxShares = Math.max(...allEntries.map((e) => e.shares || 0), 1);

  const fmtCentsOb = (price) => {
    const cents = price * 100;
    const s = cents.toFixed(1).replace(/\.0$/, "");
    return `${s}¢`;
  };
  const fmtSharesOb = (n) => {
    if (!n || n === 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const fmtTotal = (t) => {
    if (!t || t === 0) return "$0";
    return `$${t.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}
    >
      {/* Platform toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 2 }}>
        <button
          type="button"
          onClick={() => setPlatform(apiPlatformA)}
          style={{
            padding: "3px 8px",
            fontSize: 10,
            fontWeight: 800,
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
            background:
              platform === apiPlatformA
                ? `${platformColorMap[pA] || "rgba(96,165,250,1)"}40`
                : "rgba(255,255,255,0.06)",
            color:
              platform === apiPlatformA
                ? platformColorMap[pA] || "rgba(96,165,250,1)"
                : "rgba(233,238,245,0.6)",
          }}
        >
          {labelA}
        </button>
        <button
          type="button"
          onClick={() => setPlatform(apiPlatformB)}
          style={{
            padding: "3px 8px",
            fontSize: 10,
            fontWeight: 800,
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
            background:
              platform === apiPlatformB
                ? `${platformColorMap[pB] || "rgba(249,115,22,1)"}40`
                : "rgba(255,255,255,0.06)",
            color:
              platform === apiPlatformB
                ? platformColorMap[pB] || "rgba(249,115,22,1)"
                : "rgba(233,238,245,0.6)",
          }}
        >
          {labelB}
        </button>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          aria-label="Refresh orderbook"
          title="Refresh orderbook"
          style={{
            width: 22,
            height: 22,
            padding: 0,
            borderRadius: 4,
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(233,238,245,0.6)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: loading ? 0.5 : 0.8,
            transition: "opacity 0.15s",
            flexShrink: 0,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: loading ? "spin 1s linear infinite" : "none" }}
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </button>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(233,238,245,0.5)",
            marginLeft: "auto",
            alignSelf: "center",
          }}
        >
          {sideLabel}
        </span>
      </div>

      {loading && !ob ? (
        <div style={{ padding: "8px 0" }}>
          <div
            className="skeleton skeleton-text"
            style={{ width: "90%", height: 10, marginBottom: 4 }}
          />
          <div
            className="skeleton skeleton-text"
            style={{ width: "80%", height: 10, marginBottom: 4 }}
          />
          <div
            className="skeleton skeleton-text"
            style={{ width: "85%", height: 10 }}
          />
        </div>
      ) : !ob ? (
        <div className="muted" style={{ fontSize: 10 }}>
          Failed to load
        </div>
      ) : (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.1,
            opacity: loading ? 0.45 : 1,
            transition: "opacity 0.15s ease",
            pointerEvents: loading ? "none" : "auto",
          }}
        >
          {/* Asks (reversed so lowest ask at bottom, closest to spread) */}
          {asks.length > 0 && (
            <div style={{ marginBottom: 3 }}>
              {[...asks].reverse().map((ask, i) => (
                <div
                  key={`ask-${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 4,
                    padding: "3px 4px",
                    borderRadius: 3,
                    position: "relative",
                    marginBottom: 1,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      bottom: 0,
                      width: `${Math.min(100, (ask.shares / maxShares) * 100)}%`,
                      background: "rgba(239,68,68,0.2)",
                      borderRadius: 3,
                      transition: "width 0.2s ease",
                    }}
                  />
                  <span
                    style={{
                      fontWeight: 800,
                      color: "rgba(239,68,68,0.9)",
                      position: "relative",
                      zIndex: 1,
                    }}
                  >
                    {fmtCentsOb(ask.price)}
                  </span>
                  <span
                    style={{
                      color: "rgba(233,238,245,0.7)",
                      position: "relative",
                      zIndex: 1,
                      textAlign: "center",
                    }}
                  >
                    {fmtSharesOb(ask.shares)}
                  </span>
                  <span
                    style={{
                      color: "rgba(233,238,245,0.5)",
                      position: "relative",
                      zIndex: 1,
                      textAlign: "right",
                    }}
                  >
                    {fmtTotal(ask.total)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Thin separator between asks and bids */}
          {asks.length > 0 && bids.length > 0 && (
            <div
              style={{
                height: 1,
                background: "rgba(255,255,255,0.08)",
                marginBottom: 3,
              }}
            />
          )}

          {/* Bids */}
          {bids.length > 0 && (
            <div>
              {bids.map((bid, i) => (
                <div
                  key={`bid-${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 4,
                    padding: "3px 4px",
                    borderRadius: 3,
                    position: "relative",
                    marginBottom: 1,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      bottom: 0,
                      width: `${Math.min(100, (bid.shares / maxShares) * 100)}%`,
                      background: "rgba(34,197,94,0.18)",
                      borderRadius: 3,
                      transition: "width 0.2s ease",
                    }}
                  />
                  <span
                    style={{
                      fontWeight: 800,
                      color: "rgba(34,197,94,0.9)",
                      position: "relative",
                      zIndex: 1,
                    }}
                  >
                    {fmtCentsOb(bid.price)}
                  </span>
                  <span
                    style={{
                      color: "rgba(233,238,245,0.7)",
                      position: "relative",
                      zIndex: 1,
                      textAlign: "center",
                    }}
                  >
                    {fmtSharesOb(bid.shares)}
                  </span>
                  <span
                    style={{
                      color: "rgba(233,238,245,0.5)",
                      position: "relative",
                      zIndex: 1,
                      textAlign: "right",
                    }}
                  >
                    {fmtTotal(bid.total)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {asks.length === 0 && bids.length === 0 && (
            <div className="muted" style={{ fontSize: 10 }}>
              Please try again later
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  r,
  priceMode,
  marchMadnessOnly,
  liveOnly,
  displayPlatformA,
  displayPlatformB,
  isBonus,
  isBoostedProbable,
  isBoostedPredictFun,
  pfBoostStartsAtMs,
  pfBoostEndsAtMs,
  onCalculatorClick,
}) {
  return (
    <div
      className="arb-row"
      style={{
        padding: "10px 14px",
        display: "grid",
        gridTemplateColumns:
          "var(--arbitrage-desktop-grid-columns, 1.1fr 0.45fr 0.42fr 0.42fr 0.55fr 0.32fr 0.24fr)",
        gap: 10,
        alignItems: "stretch",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Title col */}
      <div
        className="arb-row-title"
        style={{ display: "flex", gap: 12, minWidth: 0 }}
      >
        {/* Image (Opinion) */}
        <div className="arb-row-img" style={{ width: 120, flex: "0 0 auto" }}>
          <div
            className="arb-row-img-inner"
            style={{
              width: 120,
              height: 78,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.03)",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {r.imageUrl ? (
              <OptimizedImage
                src={r.imageUrl}
                alt=""
                width={120}
                height={78}
                sizes="120px"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
                Image
              </div>
            )}
          </div>
        </div>

        {/* Text + Links */}
        <div
          className="arb-row-info"
          style={{
            minWidth: 0,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            className="arb-row-market-title"
            style={{ fontSize: 15, fontWeight: 900, lineHeight: 1.2 }}
            title={
              r.parentTitle
                ? `${r.parentTitle} - ${r.outcome || r.title}`
                : r.title || r.opinionTitle || r.polyTitle
            }
          >
            {r.parentTitle ? (
              <>
                <span style={{ color: "rgba(180,195,214,0.75)" }}>
                  {r.parentTitle}
                </span>
                <span
                  style={{ margin: "0 6px", color: "rgba(180,195,214,0.5)" }}
                >
                  —
                </span>
                <span>{r.outcome || r.title}</span>
              </>
            ) : (
              r.title || r.opinionTitle || r.polyTitle || "Untitled Market"
            )}
          </div>

          <div
            className="arb-row-links"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <VenueLine
              logoSrc={
                platformLogoMap[
                  r.sideA?.platform || r.platformA || platformA
                ] || "/2polymarket_600.webp"
              }
              label={
                platformDisplayMap[
                  r.sideA?.platform || r.platformA || platformA
                ] || "Exchange A"
              }
              url={r.sideA?.url || r.opinion?.url}
              isBonus={
                r.sideA?.platform === "opinion" || r.platformA === "opinion"
                  ? isBonus
                  : false
              }
              isBoostProbable={
                (r.sideA?.platform === "probable" ||
                  r.platformA === "probable") &&
                isBoostedProbable
              }
              boostMultiplier={r.probableMultiplier}
              isBoostPredictFun={
                (r.sideA?.platform === "predictfun" ||
                  r.platformA === "predictfun") &&
                isBoostedPredictFun
              }
              pfBoostStartsAtMs={pfBoostStartsAtMs}
              pfBoostEndsAtMs={pfBoostEndsAtMs}
            />
            <VenueLine
              logoSrc={
                platformLogoMap[
                  r.sideB?.platform || r.platformB || platformB
                ] || "/2logo-opinion.webp"
              }
              label={
                platformDisplayMap[
                  r.sideB?.platform || r.platformB || platformB
                ] || "Exchange B"
              }
              url={r.sideB?.url || r.poly?.url}
              isBonus={
                r.sideB?.platform === "opinion" || r.platformB === "opinion"
                  ? isBonus
                  : false
              }
              isBoostProbable={
                (r.sideB?.platform === "probable" ||
                  r.platformB === "probable") &&
                isBoostedProbable
              }
              boostMultiplier={r.probableMultiplier}
              isBoostPredictFun={
                (r.sideB?.platform === "predictfun" ||
                  r.platformB === "predictfun") &&
                isBoostedPredictFun
              }
              pfBoostStartsAtMs={pfBoostStartsAtMs}
              pfBoostEndsAtMs={pfBoostEndsAtMs}
            />
          </div>

          {/* Mobile-only strategy - shows first 2 lines below links */}
          <div
            className="arb-row-strategy-mobile"
            style={{
              display: "none",
              flexDirection: "row",
              gap: 12,
              marginTop: 8,
            }}
          >
            {(r.strategy ?? []).slice(0, 2).map((line, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "rgb(255, 255, 255)",
                  whiteSpace: "nowrap",
                }}
              >
                {line.replace(/\(Opinion\)/gi, "(OPN)")}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Strat col */}
      <div
        className="arb-row-strategy"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 4,
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          paddingLeft: 10,
        }}
      >
        {(() => {
          const lines = (r.strategy ?? []).slice(0, 2);
          const strategyMode =
            r.strategyMode ||
            (lines.some((line) => /\bsell\b/i.test(line)) ? "sell" : "buy");
          // Parse which price applies to each strategy line.
          // prices.poly* = sideB prices, prices.op* = sideA prices.
          // prices.polyTag = sideB tag (e.g. "Probable"), prices.opTag = sideA tag (e.g. "Poly")
          const getPriceForLine = (line) => {
            if (!r.prices) return null;
            const text = String(line || "").toLowerCase();
            const polyTag = r.prices.polyTag || "Poly"; // sideB tag
            const isSideB = line.includes(`(${polyTag})`);

            const resolveOutcome = (yesLabel, noLabel) => {
              const yesText = String(yesLabel || "").toLowerCase();
              const noText = String(noLabel || "").toLowerCase();
              if (
                yesText &&
                text.includes(yesText) &&
                (!noText || !text.includes(noText) || yesText === noText)
              )
                return "yes";
              if (
                noText &&
                text.includes(noText) &&
                (!yesText || !text.includes(yesText) || yesText === noText)
              )
                return "no";
              const fallback = text.match(/\b(yes|no)\b/i)?.[1]?.toLowerCase();
              if (fallback === "yes" || fallback === "no") return fallback;
              return "yes";
            };

            if (isSideB) {
              return resolveOutcome(
                r.prices.polyYesLabel || "YES",
                r.prices.polyNoLabel || "NO",
              ) === "yes"
                ? r.prices.polyYes
                : r.prices.polyNo;
            } else {
              return resolveOutcome(
                r.prices.opYesLabel || "YES",
                r.prices.opNoLabel || "NO",
              ) === "yes"
                ? r.prices.opYes
                : r.prices.opNo;
            }
          };
          const price1 = getPriceForLine(lines[0] || "");
          const price2 = getPriceForLine(lines[1] || "");
          const total =
            price1 != null && price2 != null ? price1 + price2 : null;
          const edge =
            total != null
              ? strategyMode === "sell"
                ? total - 100
                : 100 - total
              : null;
          const fmtC = (v) =>
            v != null
              ? `${Number(v).toFixed(1).replace(/\.0$/, "")}\u00a2`
              : "";
          return (
            <>
              {lines.map((line, idx) => {
                const p = idx === 0 ? price1 : price2;
                return (
                  <div key={idx} style={{ fontSize: 13, fontWeight: 900 }}>
                    {line.replace(/\(Opinion\)/gi, "(OPN)")}
                    {p != null && (
                      <span className="muted" style={{ fontWeight: 700 }}>
                        {" "}
                        - {fmtC(p)}
                      </span>
                    )}
                  </div>
                );
              })}
              {total != null && edge != null && (
                <div style={{ marginTop: 2 }}>
                  <div
                    className="muted"
                    style={{ fontSize: 12, fontWeight: 700 }}
                  >
                    {strategyMode === "sell"
                      ? `${fmtC(price1)} + ${fmtC(price2)} = ${fmtC(total)} (${total > 100 ? ">" : "\u2264"}100\u00a2)`
                      : `${fmtC(price1)} + ${fmtC(price2)} = ${fmtC(total)} (${total < 100 ? "<" : "\u2265"}100\u00a2)`}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color:
                        edge >= 0
                          ? "rgba(80,200,120,0.95)"
                          : "rgba(239,68,68,0.92)",
                    }}
                  >
                    {strategyMode === "sell"
                      ? `${fmtC(total)} - 100\u00a2 = ${fmtC(edge)}`
                      : `100\u00a2 - ${fmtC(total)} = ${fmtC(edge)}`}{" "}
                    (${(edge / 100).toFixed(3)}) per share (
                    {edge.toFixed(1).replace(/\.0$/, "")}%)
                  </div>
                </div>
              )}
              {(r.strategy ?? []).length > 2 && (
                <div
                  className="muted"
                  style={{ fontSize: 12, fontWeight: 800 }}
                >
                  +{(r.strategy ?? []).length - 2} more...
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Platform A Stats col — dynamically mapped to correct stats based on display order */}
      {(() => {
        const { statsA } = getStatsForDisplay(
          r,
          displayPlatformA,
          displayPlatformB,
        );
        const colorA =
          platformColorMap[displayPlatformA] || "rgba(96,165,250,0.95)";
        return (
          <div
            className="arb-row-poly-stats"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 6,
              padding: "2px 0",
              borderLeft: "1px solid rgba(255,255,255,0.10)",
              paddingLeft: 10,
            }}
          >
            <div style={{ display: "flex", gap: 32 }}>
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "rgba(148,163,184,0.7)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 3,
                  }}
                >
                  24H Volume
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: colorA }}>
                  {formatDollarFull(statsA?.volume)}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "rgba(148,163,184,0.7)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 3,
                  }}
                >
                  Liquidity
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: colorA }}>
                  {formatDollarFull(statsA?.liquidity)}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Platform B Stats col — dynamically mapped to correct stats based on display order */}
      {(() => {
        const { statsB } = getStatsForDisplay(
          r,
          displayPlatformA,
          displayPlatformB,
        );
        const colorB =
          platformColorMap[displayPlatformB] || "rgba(249,115,22,1)";
        return (
          <div
            className="arb-row-opinion-stats"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 6,
              padding: "2px 0",
              borderLeft: "1px solid rgba(255,255,255,0.10)",
              paddingLeft: 10,
            }}
          >
            <div style={{ display: "flex", gap: 35 }}>
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "rgba(148,163,184,0.7)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 3,
                  }}
                >
                  24H Volume
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: colorB }}>
                  {formatDollarFull(statsB?.volume)}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "rgba(148,163,184,0.7)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 3,
                  }}
                >
                  Liquidity
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: colorB }}>
                  {formatDollarFull(statsB?.liquidity)}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Order Book col */}
      <div
        className="arb-row-orderbook"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          paddingLeft: 10,
          minWidth: 0,
        }}
      >
        <MiniOrderbook row={r} priceMode={priceMode} />
      </div>

      {/* Expires col */}
      <div
        className="arb-row-expires"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          paddingLeft: 10,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: "rgba(233,238,245,0.75)",
          }}
        >
          {formatExpires(r.endDate)}
        </div>
      </div>

      {/* Arb col */}
      <div
        className="arb-row-arb"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          margin: 0,
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          paddingLeft: 10,
        }}
      >
        <div
          className="arb-row-pct-wrapper"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
          }}
        >
          <div
            className="arb-row-pct"
            style={{
              fontSize: 24,
              fontWeight: 1000,
              color:
                (r.arbPct ?? 0) > 0
                  ? "rgba(80,200,120,1)"
                  : (r.arbPct ?? 0) < 0 && (marchMadnessOnly || liveOnly)
                    ? "rgba(248,113,113,1)"
                    : "rgba(233,238,245,0.85)",
            }}
          >
            {formatPct(r.arbPct)}
          </div>
          <div
            className="muted"
            style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}
          >
            Spread
          </div>
        </div>
        {/* Calculator button */}
        <button
          type="button"
          onClick={onCalculatorClick}
          className="arb-calc-btn"
          aria-label="Open arbitrage calculator"
          style={{
            marginTop: 8,
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: "rgba(255,180,50,0.15)",
            border: "1px solid rgba(255,180,50,0.3)",
            borderRadius: 6,
            color: "rgba(255,180,50,1)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          title="Calculate PNL"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="3" y="2" width="18" height="20" rx="3" fill="#FF9500" />
            <rect x="5" y="4" width="14" height="5" rx="1" fill="#fff" />
            <circle cx="7" cy="12" r="1.2" fill="#fff" />
            <circle cx="12" cy="12" r="1.2" fill="#fff" />
            <circle cx="17" cy="12" r="1.2" fill="#fff" />
            <circle cx="7" cy="16" r="1.2" fill="#fff" />
            <circle cx="12" cy="16" r="1.2" fill="#fff" />
            <circle cx="17" cy="16" r="1.2" fill="#fff" />
            <circle cx="7" cy="20" r="1.2" fill="#fff" />
            <rect x="10.5" y="19" width="8" height="2.4" rx="1" fill="#fff" />
          </svg>
          Calculate
        </button>
      </div>
    </div>
  );
}

function VenueLine({
  logoSrc,
  label,
  url,
  isBonus,
  isBoostProbable,
  boostMultiplier,
  isBoostPredictFun,
  pfBoostStartsAtMs,
  pfBoostEndsAtMs,
}) {
  // Compute Predict.fun boost status inline (board re-renders every 30s via forceUpdate)
  let pfBoostStatus = null;
  let pfCountdown = null;
  if (isBoostPredictFun && pfBoostStartsAtMs && pfBoostEndsAtMs) {
    const now = Date.now();
    if (now < pfBoostEndsAtMs) {
      if (now >= pfBoostStartsAtMs) {
        pfBoostStatus = "active";
      } else {
        pfBoostStatus = "upcoming";
        const totalMin = Math.floor((pfBoostStartsAtMs - now) / 60000);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        pfCountdown = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
      }
    }
  } else if (isBoostPredictFun && (!pfBoostStartsAtMs || !pfBoostEndsAtMs)) {
    // Boost flag set but no window — show as active
    pfBoostStatus = "active";
  }
  return (
    <a
      href={url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="arb-venue-link"
      aria-label={`Open ${label} market`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        textDecoration: "none",
        opacity: url ? 1 : 0.5,
        pointerEvents: url ? "auto" : "none",
        padding: "4px 0",
        borderRadius: 6,
        transition: "background 0.15s ease",
      }}
      title={url || ""}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoSrc}
        alt=""
        width={18}
        height={18}
        loading="lazy"
        decoding="async"
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          opacity: 0.95,
          flexShrink: 0,
        }}
      />
      <span
        className="arb-venue-label"
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: "rgba(150,180,255,0.9)",
        }}
      >
        {label}
      </span>

      {/* External link icon box */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 4,
          border: "1px solid rgba(180,195,214,0.3)",
          marginLeft: 2,
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="rgba(180,195,214,0.7)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.5 2H2.5C1.95 2 1.5 2.45 1.5 3V9.5C1.5 10.05 1.95 10.5 2.5 10.5H9C9.55 10.5 10 10.05 10 9.5V7.5" />
          <path d="M7 1.5H10.5V5" />
          <path d="M10.5 1.5L5.5 6.5" />
        </svg>
      </span>

      {/* Bonus icon - only for Opinion with bonus */}
      {isBonus && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/gift_icon_24.svg"
          alt="Bonus"
          width={30}
          height={30}
          title="This market has bonus rewards"
          style={{
            width: 30,
            height: 30,
            marginLeft: 4,
          }}
        />
      )}

      {/* Boosted points badge - only for Probable boosted markets */}
      {isBoostProbable && (
        <span
          title={`This market has ${boostMultiplier ? `${boostMultiplier}x ` : ""}boosted points`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(168,85,247,0.2)",
            border: "1px solid rgba(168,85,247,0.45)",
            marginLeft: 4,
            flexShrink: 0,
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="rgba(216,180,254,0.9)"
            stroke="none"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span
            style={{
              fontSize: 10,
              fontWeight: 900,
              color: "rgba(216,180,254,0.95)",
              letterSpacing: 0.3,
              lineHeight: 1,
            }}
          >
            {boostMultiplier && boostMultiplier > 1
              ? `${boostMultiplier}x`
              : "BOOST"}
          </span>
        </span>
      )}

      {/* Predict.fun active boost badge */}
      {isBoostPredictFun && pfBoostStatus === "active" && (
        <span
          title="This Predict.fun market has boosted points"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(99,102,241,0.2)",
            border: "1px solid rgba(99,102,241,0.5)",
            marginLeft: 4,
            flexShrink: 0,
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="rgba(165,180,252,0.9)"
            stroke="none"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span
            style={{
              fontSize: 10,
              fontWeight: 900,
              color: "rgba(165,180,252,0.95)",
              letterSpacing: 0.3,
              lineHeight: 1,
            }}
          >
            BOOST
          </span>
        </span>
      )}

      {/* Predict.fun upcoming boost countdown */}
      {isBoostPredictFun && pfBoostStatus === "upcoming" && pfCountdown && (
        <span
          title={`Predict.fun boost starts in ${pfCountdown}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 7px",
            borderRadius: 4,
            background: "rgba(99,102,241,0.12)",
            border: "1px solid rgba(99,102,241,0.35)",
            marginLeft: 4,
            flexShrink: 0,
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(165,180,252,0.85)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span
            style={{
              fontSize: 10,
              fontWeight: 900,
              color: "rgba(165,180,252,0.85)",
              letterSpacing: 0.2,
              lineHeight: 1,
            }}
          >
            Boost in: {pfCountdown}
          </span>
        </span>
      )}
    </a>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: "10px 14px",
            display: "grid",
            gridTemplateColumns:
              "var(--arbitrage-desktop-grid-columns, 1.1fr 0.45fr 0.42fr 0.42fr 0.55fr 0.32fr 0.24fr)",
            gap: 10,
            alignItems: "stretch",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <div
              className="skeleton"
              style={{ width: 120, height: 78, borderRadius: 12 }}
            />
            <div style={{ flex: 1 }}>
              <div
                className="skeleton skeleton-text"
                style={{ width: "70%", height: 14, marginTop: 4 }}
              />
              <div
                className="skeleton skeleton-text"
                style={{ width: "40%", height: 12, marginTop: 10 }}
              />
              <div
                className="skeleton skeleton-text"
                style={{ width: "35%", height: 12, marginTop: 8 }}
              />
            </div>
          </div>
          <div>
            <div
              className="skeleton skeleton-text"
              style={{ width: "55%", height: 12, marginTop: 6 }}
            />
            <div
              className="skeleton skeleton-text"
              style={{ width: "45%", height: 12, marginTop: 10 }}
            />
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div
              className="skeleton skeleton-text"
              style={{ width: 50, height: 12, marginTop: 6 }}
            />
            <div
              className="skeleton skeleton-text"
              style={{ width: 50, height: 12, marginTop: 6 }}
            />
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div
              className="skeleton skeleton-text"
              style={{ width: 50, height: 12, marginTop: 6 }}
            />
            <div
              className="skeleton skeleton-text"
              style={{ width: 50, height: 12, marginTop: 6 }}
            />
          </div>
          <div>
            <div
              className="skeleton skeleton-text"
              style={{ width: "60%", height: 10, marginTop: 6 }}
            />
            <div
              className="skeleton skeleton-text"
              style={{ width: "80%", height: 10, marginTop: 4 }}
            />
            <div
              className="skeleton skeleton-text"
              style={{ width: "70%", height: 10, marginTop: 4 }}
            />
            <div
              className="skeleton skeleton-text"
              style={{ width: "50%", height: 10, marginTop: 4 }}
            />
          </div>
          <div>
            <div
              className="skeleton skeleton-text"
              style={{ width: "70%", height: 12, marginTop: 6 }}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <div
              className="skeleton skeleton-text"
              style={{ width: 70, height: 20 }}
            />
            <div
              className="skeleton skeleton-text"
              style={{ width: 50, height: 12, marginTop: 8 }}
            />
          </div>
        </div>
      ))}
    </>
  );
}

function formatPct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "--";
  return `${Number(x).toFixed(2)}%`;
}

function formatCents(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "--";
  return `${Number(x).toFixed(1)}¢`;
}

function formatExpires(dateStr) {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    // Format: Jan 31, 2026
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatShares(x) {
  if (x === null || x === undefined || Number.isNaN(x) || x === 0) return "--";
  const num = Number(x);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

function formatDollarFull(x) {
  if (
    x === null ||
    x === undefined ||
    Number.isNaN(x) ||
    !Number.isFinite(Number(x))
  )
    return "--";
  const num = Number(x);
  if (num === 0) return "--";
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
