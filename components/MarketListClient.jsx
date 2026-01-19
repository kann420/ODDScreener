"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarketRowV2 from "@/components/MarketRowV2";

const ITEMS_PER_PAGE = 10;
const TRENDING_COUNT = 20;

const NEW_LIMIT = 100; // ✅ top 100 newest active markets
const HOT_LIMIT = 20; // ✅ top 20 hot markets
const HOT_POOL = 150; // take top 150 newest active -> then rank by 24h vol

// ===== helpers =====
function parseCompactNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v).trim();
  if (!s) return 0;

  const cleaned = s.replace(/\$/g, "").replace(/,/g, "").trim();
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)([KMB])?$/i);
  if (!m) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  const num = Number(m[1]);
  if (!Number.isFinite(num)) return 0;

  const suf = (m[2] || "").toUpperCase();
  const mult = suf === "K" ? 1e3 : suf === "M" ? 1e6 : suf === "B" ? 1e9 : 1;
  return num * mult;
}

function getVolumeValue(m, mode) {
  if (!m) return 0;
  if (mode === "24h") {
    return parseCompactNumber(m?.volume24h ?? m?.vol24h ?? m?.volume_24h ?? 0);
  }
  return parseCompactNumber(m?.volume ?? m?.volTotal ?? m?.volume_total ?? m?.volumeAll ?? 0);
}

function toMs(v) {
  if (v === null || v === undefined) return 0;

  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;

  const s = String(v).trim();
  if (!s) return 0;

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }

  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

// ✅ If date has NO year and is in the past, do NOT always bump to next year.
// Only bump if it's "too far" in the past (> 90 days).
function maybeBumpYearIfTooOld(testDate, yearProvided) {
  if (yearProvided) return testDate;

  const now = new Date();
  if (testDate >= now) return testDate;

  const diffMs = now.getTime() - testDate.getTime();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  if (diffMs > ninetyDaysMs) {
    // past too far -> assume it refers to next year
    return new Date(testDate.getFullYear() + 1, testDate.getMonth(), testDate.getDate());
  }

  // recent past -> keep current year so it can be treated as expired
  return testDate;
}

/**
 * Extract expiration date from title
 * Returns Unix timestamp in SECONDS if found, 0 otherwise
 */
function extractExpiresFromTitle(title) {
  if (!title) return 0;
  const str = String(title).trim();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const months = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
  };

  // Helper: create timestamp from date
  const toTimestamp = (year, month, day) => {
    return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
  };

  // Helper: guess year for month without explicit year
  const guessYear = (month) => {
    if (month <= currentMonth) {
      return currentYear; // past or current month = this year
    }
    // Future month - if > 6 months ahead, might be previous year
    if (month - currentMonth > 6) {
      return currentYear - 1;
    }
    return currentYear;
  };

  // Pattern 1: "Month Day, Year" or "Month Day Year" (e.g., "December 31, 2025")
  const pattern1 =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/i;
  const match1 = str.match(pattern1);
  if (match1) {
    const month = months[match1[1].toLowerCase()];
    const day = parseInt(match1[2], 10);
    const year = parseInt(match1[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020 && year <= 2035) {
      return toTimestamp(year, month, day);
    }
  }

  // Pattern 2: "by/before/on/until Month Day" without year
  const pattern2 =
    /\b(?:by|before|on|until)\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
  const match2 = str.match(pattern2);
  if (match2) {
    const month = months[match2[1].toLowerCase()];
    const day = parseInt(match2[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = guessYear(month);
      return toTimestamp(year, month, day);
    }
  }

  // Pattern 3: "Month Day" at end of string (e.g., "...January 1?", "...January 1")
  const pattern3 =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*\?)?$/i;
  const match3 = str.match(pattern3);
  if (match3) {
    const month = months[match3[1].toLowerCase()];
    const day = parseInt(match3[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = guessYear(month);
      return toTimestamp(year, month, day);
    }
  }

  // Pattern 4: "in Month [Year]" -> end of month
  const pattern4 =
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/i;
  const match4 = str.match(pattern4);
  if (match4) {
    const month = months[match4[1].toLowerCase()];
    const year = match4[2] ? parseInt(match4[2], 10) : guessYear(month);
    if (month !== undefined && year >= 2020 && year <= 2035) {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return toTimestamp(year, month, lastDay);
    }
  }

  // Pattern 5: Standalone year at end (e.g., "...2025?", "...2025")
  const pattern5 = /\b(202[0-5])\s*\??$/;
  const match5 = str.match(pattern5);
  if (match5) {
    const year = parseInt(match5[1], 10);
    return toTimestamp(year, 11, 31); // End of year
  }

  // Pattern 6: Q1/Q2/Q3/Q4 Year
  const pattern6 = /\bQ([1-4])\s*(\d{4})\b/i;
  const match6 = str.match(pattern6);
  if (match6) {
    const quarter = parseInt(match6[1], 10);
    const year = parseInt(match6[2], 10);
    const endMonth = quarter * 3 - 1;
    const lastDay = new Date(year, endMonth + 1, 0).getDate();
    return toTimestamp(year, endMonth, lastDay);
  }

  // Pattern 7: Numeric date "M/D" or "MM/DD" (e.g., "1/15", "01/15")
  const pattern7 = /\b(?:on|by|before|until)?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:\?|$)/i;
  const match7 = str.match(pattern7);
  if (match7) {
    const monthNum = parseInt(match7[1], 10) - 1;
    const day = parseInt(match7[2], 10);
    let year = match7[3] ? parseInt(match7[3], 10) : guessYear(monthNum);
    if (year < 100) year += 2000;
    
    if (monthNum >= 0 && monthNum <= 11 && day >= 1 && day <= 31 && year >= 2020 && year <= 2035) {
      return toTimestamp(year, monthNum, day);
    }
  }

  // Pattern 8: "Month Day" anywhere in string (more aggressive fallback)
  const pattern8 =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
  const match8 = str.match(pattern8);
  if (match8) {
    const month = months[match8[1].toLowerCase()];
    const day = parseInt(match8[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = guessYear(month);
      return toTimestamp(year, month, day);
    }
  }

  return 0;
}

// ✅ more robust expiry selector (covers cutoffTime etc)
function getExpiresTimestamp(m) {
  if (!m) return 0;

  if (m.cutoffAt && m.cutoffAt > 0) return m.cutoffAt;
  if (m.cutoffTime && m.cutoffTime > 0) return m.cutoffTime;
  if (m.expiresAt && m.expiresAt > 0) return m.expiresAt;

  if (m.resolvedAt && m.resolvedAt > 0) return m.resolvedAt;

  return extractExpiresFromTitle(m.title);
}

/**
 * ✅ Opinion `status` is usually a NUMBER:
 * 1=Created, 2=Activated, 3=Resolving, 4=Resolved, 5=Failed, 6=Deleted
 */
function isResolvedByStatus(m) {
  const statusRaw = m?.status;
  
  // Direct check for status = 4 (RESOLVED) - most reliable
  if (statusRaw === 4 || statusRaw === "4") return true;
  if (statusRaw === 3 || statusRaw === "3") return true; // RESOLVING
  if (statusRaw === 5 || statusRaw === "5") return true; // FAILED  
  if (statusRaw === 6 || statusRaw === "6") return true; // DELETED
  
  // Also check as number
  const stNum = Number(statusRaw);
  if (Number.isFinite(stNum) && stNum >= 3 && stNum !== 2) {
    return true; // Any status >= 3 (except 2=ACTIVATED) is resolved/expired
  }

  // Check statusEnum - case insensitive, partial match
  const se = String(m?.statusEnum ?? m?.status_enum ?? "").toLowerCase();
  if (se.includes("resolved") || se.includes("resolving") || 
      se.includes("failed") || se.includes("deleted") ||
      se.includes("settled") || se.includes("closed")) {
    return true;
  }

  // Check status as string
  const s = String(statusRaw ?? "").toLowerCase();
  return (
    s.includes("resolved") ||
    s.includes("closed") ||
    s.includes("settled") ||
    s.includes("finalized") ||
    s.includes("cancelled") ||
    s.includes("canceled") ||
    s.includes("failed") ||
    s.includes("deleted")
  );
}

function isExpiredMarket(m, nowSec) {
  const expSec = getExpiresTimestamp(m);
  if (!expSec) return false;
  return expSec <= nowSec;
}

// ✅ active + not expired + not resolved
function isActiveNotExpired(m, nowMs) {
  if (!m) return false;

  // 1) Check resolved by status (number or string)
  if (isResolvedByStatus(m)) return false;
  
  // 2) Check resolvedAt - đáo hạn nếu khác 0/null/undefined
  const resolvedAt = m?.resolvedAt ?? m?.resolved_at;
  if (resolvedAt !== null && resolvedAt !== undefined && resolvedAt !== 0 && resolvedAt !== "") {
    const resolvedNum = Number(resolvedAt);
    if (Number.isFinite(resolvedNum) && resolvedNum > 0) return false;
  }
  
  // 3) Check resultTokenId - market đã có kết quả
  const resultTokenId = m?.resultTokenId ?? m?.result_token_id;
  if (resultTokenId !== null && resultTokenId !== undefined && resultTokenId !== "" && resultTokenId !== 0) {
    return false;
  }

  // 4) Check cutoffAt - đã hết hạn đặt cược
  const nowSec = Math.floor(nowMs / 1000);
  const cutoffAt = m?.cutoffAt ?? m?.cutoff_at ?? 0;
  if (cutoffAt && Number(cutoffAt) > 0 && Number(cutoffAt) <= nowSec) {
    return false;
  }

  // 5) Check by expiry from title or other fields
  if (isExpiredMarket(m, nowSec)) return false;

  return true;
}

/**
 * Recency key for NEW sorting (DESC):
 */
function recencyKey(m) {
  if (!m) return 0;

  const t =
    toMs(m?.createdAt ?? m?.created_at ?? 0) ||
    toMs(m?.openTime ?? 0) ||
    toMs(m?.listedAt ?? 0) ||
    toMs(m?.createdTime ?? 0);

  if (t) return t;

  const idNum = Number(m?.marketId);
  if (Number.isFinite(idNum)) return idNum; // [Chưa xác minh]
  return 0;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }
}

async function runWithConcurrency(items, worker, concurrency = 2) {
  const queue = [...items];
  const runners = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export default function MarketListClient({ initialMarkets, markets: marketsProp, initialBonusIds }) {
  const markets = (initialMarkets && Array.isArray(initialMarkets) ? initialMarkets : marketsProp) || [];

  const [activeTab, setActiveTab] = useState("trending"); // "new" | "hot" | "trending" | "bonus" | "all"
  const [volMode, setVolMode] = useState("24h"); // "24h" | "all"
  const [currentPage, setCurrentPage] = useState(1);
  const [visible, setVisible] = useState(6);
  const [refreshTick, setRefreshTick] = useState(0); // auto refresh trigger (no refetch)
  
  const [sortConfig, setSortConfig] = useState({ key: null, direction: null });

  const [chanceMap, setChanceMap] = useState({});
  const [volumeMap, setVolumeMap] = useState({});
  const [search, setSearch] = useState("");

  const [bonusIds, setBonusIds] = useState(initialBonusIds || []);
  const [bonusLoading, setBonusLoading] = useState(!initialBonusIds || initialBonusIds.length === 0);
  const bonusSet = useMemo(() => new Set((bonusIds || []).map((x) => String(x))), [bonusIds]);

  const [allTabLoaded, setAllTabLoaded] = useState(false);
  const initTrendingDoneRef = useRef(false);
  const hotPrefetchDoneRef = useRef(false);
    // ✅ Auto refresh by tab (NO refetch). Visibility-guarded to save TPS/CPU.
  // NEW: 6h/lần | HOT/TRENDING: 1h/lần
  useEffect(() => {
    let hours = 0;

    if (activeTab === "new") hours = 6;
    else if (activeTab === "hot" || activeTab === "trending") hours = 1;
    else return; // other tabs: no auto refresh

    const intervalMs = hours * 60 * 60 * 1000;

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        
        
        setRefreshTick((t) => t + 1);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [activeTab]);

  const bonusScanDoneRef = useRef(false);

  // ✅ Central active list to avoid showing/processing expired/resolved markets in Discover
  const activeMarkets = useMemo(() => {
    const nowMs = Date.now();
    return (markets || []).filter((m) => isActiveNotExpired(m, nowMs));
  }, [markets, refreshTick]);

  // Detect bonus markets from list data first (if incentiveFactor exists in list)
  // Fallback to API if list doesn't have incentiveFactor info
  useEffect(() => {
    if (initialBonusIds && initialBonusIds.length > 0) {
      setBonusIds(initialBonusIds);
      setBonusLoading(false);
      return;
    }

    let alive = true;

    const localBonusIds = (markets || [])
      .filter((m) => m?.hasBonus === true)
      .map((m) => m?.marketId)
      .filter(Boolean);

    if (localBonusIds.length > 0) {
      setBonusIds(localBonusIds);
      setBonusLoading(false);
      return;
    }

    (async () => {
      try {
        const r = await fetch(`/api/opinion/bonus-markets?limit=1000`, { cache: "no-store" });
        const j = await r.json();
        const ids = j?.ids || j?.result?.ids || [];
        if (alive && Array.isArray(ids)) setBonusIds(ids);
      } catch (e) {
        console.error("[Bonus] API fetch failed:", e);
      } finally {
        if (alive) setBonusLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [markets, initialBonusIds]);

  // PRE-SCAN: Fetch detail for ACTIVE markets only (avoid wasting on resolved/expired)
  useEffect(() => {
    if (bonusScanDoneRef.current) return;
    if (!activeMarkets || activeMarkets.length === 0) return;

    bonusScanDoneRef.current = true;

    const scanBonusMarkets = async () => {
      const detectedBonusIds = [];
      const marketIds = activeMarkets.map((m) => m?.marketId).filter(Boolean);

      const batchSize = 10;
      for (let i = 0; i < marketIds.length; i += batchSize) {
        const batch = marketIds.slice(i, i + batchSize);

        const results = await Promise.allSettled(
          batch.map(async (marketId) => {
            try {
              const res = await fetch(`/api/opinion/market/${encodeURIComponent(marketId)}`, { cache: "no-store" });
              if (!res.ok) return null;
              const j = await safeReadJson(res);
              const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};

              if ("incentiveFactor" in data) return marketId;
              return null;
            } catch {
              return null;
            }
          })
        );

        for (const r of results) {
          if (r.status === "fulfilled" && r.value) detectedBonusIds.push(r.value);
        }

        if (detectedBonusIds.length > 0) {
          setBonusIds((prev) => {
            const newIds = detectedBonusIds.filter((id) => !prev.includes(id) && !prev.includes(String(id)));
            if (newIds.length === 0) return prev;
            return [...prev, ...newIds];
          });
        }

        await sleep(50);
      }

      setBonusLoading(false);
      console.log(`[Bonus] Pre-scan complete: found ${detectedBonusIds.length} bonus markets`);
    };

    scanBonusMarkets();
  }, [activeMarkets]);

  const handleChanceLoaded = (marketId, chance) => {
    setChanceMap((prev) => (prev[marketId] === chance ? prev : { ...prev, [marketId]: chance }));
  };

  const handleVolumeLoaded = (marketId, vol) => {
    if (!marketId || !vol) return;
    setVolumeMap((prev) => {
      const next = {
        volume: parseCompactNumber(vol.volume),
        volume24h: parseCompactNumber(vol.volume24h),
      };
      const cur = prev[marketId];
      if (cur && cur.volume === next.volume && cur.volume24h === next.volume24h) return prev;
      return { ...prev, [marketId]: next };
    });
  };

  const handleBonusDetected = (marketId) => {
    if (!marketId) return;
    setBonusIds((prev) => {
      const idStr = String(marketId);
      if (prev.includes(idStr) || prev.includes(marketId)) return prev;
      return [...prev, marketId];
    });
  };

  const displayVolMode = activeTab === "all" ? volMode : "24h";

  // ✅ NEW: newest ACTIVE markets (from activeMarkets)
  const newestPool = useMemo(() => {
    return [...activeMarkets].sort((a, b) => recencyKey(b) - recencyKey(a));
  }, [activeMarkets]);

  const newMarkets = useMemo(() => {
    return newestPool.slice(0, NEW_LIMIT);
  }, [newestPool]);

  // ✅ HOT: from newestPool (top 150 newest active), rank by 24h vol, take top 20
  const hotMarkets = useMemo(() => {
    const pool = newestPool.slice(0, HOT_POOL);

    const ranked = [...pool].sort((a, b) => {
      const aOv = volumeMap[String(a.marketId)];
      const bOv = volumeMap[String(b.marketId)];
      const aVal = (aOv?.volume24h ?? 0) || getVolumeValue(a, "24h");
      const bVal = (bOv?.volume24h ?? 0) || getVolumeValue(b, "24h");
      return bVal - aVal;
    });

    return ranked.slice(0, HOT_LIMIT);
  }, [newestPool, volumeMap]);

  // ✅ TRENDING: top 20 by 24h vol, but ONLY ACTIVE markets
  const trendingMarkets = useMemo(() => {
    const arr = [...activeMarkets];
    arr.sort((a, b) => {
      const aOv = volumeMap[String(a.marketId)];
      const bOv = volumeMap[String(b.marketId)];
      const aVal = (aOv?.volume24h ?? 0) || getVolumeValue(a, "24h");
      const bVal = (bOv?.volume24h ?? 0) || getVolumeValue(b, "24h");
      return bVal - aVal;
    });
    return arr.slice(0, TRENDING_COUNT);
  }, [activeMarkets, volumeMap]);

  // ✅ BONUS: only ACTIVE bonus markets
  const bonusMarkets = useMemo(() => {
    if (!activeMarkets || activeMarkets.length === 0) return [];
    return activeMarkets.filter((m) => bonusSet.has(String(m?.marketId)));
  }, [activeMarkets, bonusSet]);

  // ✅ ALL: only ACTIVE markets (this is what drops 922 -> smaller)
  const allMarkets = useMemo(() => {
    return activeMarkets;
  }, [activeMarkets]);

  const currentTabMarkets = useMemo(() => {
    if (activeTab === "new") return newMarkets;
    if (activeTab === "hot") return hotMarkets;
    if (activeTab === "trending") return trendingMarkets;
    if (activeTab === "bonus") return bonusMarkets;
    return allMarkets;
  }, [activeTab, newMarkets, hotMarkets, trendingMarkets, bonusMarkets, allMarkets]);

  const filteredMarkets = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return currentTabMarkets;
    return currentTabMarkets.filter((m) => {
      const title = String(m?.title ?? m?.marketTitle ?? "").toLowerCase();
      const id = String(m?.marketId ?? "");
      return title.includes(s) || id.includes(s);
    });
  }, [currentTabMarkets, search]);

  // Prefetch for trending (top 30 by estimated 24h vol from LIST, but only ACTIVE)
  useEffect(() => {
    if (initTrendingDoneRef.current) return;
    if (!activeMarkets || activeMarkets.length === 0) return;

    initTrendingDoneRef.current = true;

    const sortedByVol = [...activeMarkets].sort((a, b) => getVolumeValue(b, "24h") - getVolumeValue(a, "24h"));

    const ids = sortedByVol
      .map((m) => String(m.marketId))
      .filter(Boolean)
      .slice(0, 30);

    const run = async () => {
      await runWithConcurrency(
        ids,
        async (id) => {
          try {
            const ov = volumeMap[id];
            if (ov && ov.volume24h > 0) return;

            const res = await fetch(`/api/opinion/market/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (!res.ok) return;

            const j = await safeReadJson(res);
            if (!j) return;

            const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};
            const vAll = Number(data?.volume ?? 0) || 0;
            const v24h = Number(data?.volume24h ?? 0) || 0;

            if (vAll > 0 || v24h > 0) handleVolumeLoaded(id, { volume: vAll, volume24h: v24h });
          } catch {
            // ignore
          } finally {
            await sleep(25);
          }
        },
        3
      );
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMarkets]);

  // ✅ Prefetch volumes for HOT when user opens HOT (for accuracy)
  useEffect(() => {
    if (activeTab !== "hot") return;
    if (hotPrefetchDoneRef.current) return;
    if (!newestPool || newestPool.length === 0) return;

    hotPrefetchDoneRef.current = true;

    const idsNeed = newestPool
      .slice(0, HOT_POOL)
      .map((m) => String(m.marketId))
      .filter(Boolean)
      .filter((id) => {
        const ov = volumeMap[id];
        return !ov || (ov.volume24h <= 0 && ov.volume <= 0);
      })
      .slice(0, 120);

    if (idsNeed.length === 0) return;

    const run = async () => {
      await runWithConcurrency(
        idsNeed,
        async (id) => {
          try {
            const res = await fetch(`/api/opinion/market/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (!res.ok) return;

            const j = await safeReadJson(res);
            if (!j) return;

            const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};
            const vAll = Number(data?.volume ?? 0) || 0;
            const v24h = Number(data?.volume24h ?? 0) || 0;

            if (vAll > 0 || v24h > 0) handleVolumeLoaded(id, { volume: vAll, volume24h: v24h });
          } catch {
            // ignore
          } finally {
            await sleep(15);
          }
        },
        4
      );
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, newestPool]);

  // Prefetch volumes when ALL tab is activated (only ACTIVE markets)
  useEffect(() => {
    if (activeTab !== "all") return;
    if (allTabLoaded) return;
    if (!allMarkets || allMarkets.length === 0) return;

    setAllTabLoaded(true);

    const idsNeed = allMarkets
      .map((m) => String(m.marketId))
      .filter(Boolean)
      .filter((id) => {
        const ov = volumeMap[id];
        return !ov || (ov.volume24h <= 0 && ov.volume <= 0);
      })
      .slice(0, 200);

    if (idsNeed.length === 0) return;

    const run = async () => {
      await runWithConcurrency(
        idsNeed,
        async (id) => {
          try {
            const res = await fetch(`/api/opinion/market/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (!res.ok) return;

            const j = await safeReadJson(res);
            if (!j) return;

            const data = j?.result?.data ?? j?.result ?? j?.data ?? j ?? {};
            const vAll = Number(data?.volume ?? 0) || 0;
            const v24h = Number(data?.volume24h ?? 0) || 0;

            if (vAll > 0 || v24h > 0) handleVolumeLoaded(id, { volume: vAll, volume24h: v24h });
          } catch {
            // ignore
          } finally {
            await sleep(15);
          }
        },
        4
      );
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, allMarkets]);

  // ===== sort =====
  const sortedMarkets = useMemo(() => {
    const arr = [...(filteredMarkets || [])];

    let effectiveSortKey = sortConfig.key;
    let effectiveSortDir = sortConfig.direction;

    // Default volume desc for trending/hot if user hasn't chosen sort
    if ((activeTab === "trending" || activeTab === "hot") && !sortConfig.key) {
      effectiveSortKey = "volume";
      effectiveSortDir = "desc";
    }

    if (!effectiveSortKey) return arr;

    arr.sort((a, b) => {
      let aVal = 0;
      let bVal = 0;

      if (effectiveSortKey === "chance") {
        aVal = chanceMap[a.marketId] ?? 0;
        bVal = chanceMap[b.marketId] ?? 0;
      } else if (effectiveSortKey === "volume") {
        const aOv = volumeMap[String(a.marketId)];
        const bOv = volumeMap[String(b.marketId)];

        if (displayVolMode === "24h") {
          aVal = (aOv?.volume24h ?? 0) || getVolumeValue(a, "24h");
          bVal = (bOv?.volume24h ?? 0) || getVolumeValue(b, "24h");
        } else {
          aVal = (aOv?.volume ?? 0) || getVolumeValue(a, "all");
          bVal = (bOv?.volume ?? 0) || getVolumeValue(b, "all");
        }
      } else if (effectiveSortKey === "expires") {
        const aTsSeconds = getExpiresTimestamp(a);
        const bTsSeconds = getExpiresTimestamp(b);
        aVal = aTsSeconds > 0 ? aTsSeconds * 1000 : Infinity;
        bVal = bTsSeconds > 0 ? bTsSeconds * 1000 : Infinity;
      }

      return effectiveSortDir === "asc" ? aVal - bVal : bVal - aVal;
    });

    return arr;
  }, [activeTab, filteredMarkets, sortConfig, chanceMap, volumeMap, displayVolMode]);

  // ===== pagination =====
  const totalPages = Math.ceil((sortedMarkets.length || 0) / ITEMS_PER_PAGE);

  const pageList = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedMarkets.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedMarkets, currentPage]);

  useEffect(() => {
    const total = pageList.length;
    setVisible(Math.min(6, total));
    const t = setInterval(() => setVisible((v) => (v >= total ? v : Math.min(total, v + 2))), 320);
    return () => clearInterval(t);
  }, [pageList.length, currentPage]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        if (prev.direction === "desc") return { key, direction: "asc" };
        if (prev.direction === "asc") return { key: null, direction: null };
      }
      return { key, direction: "desc" };
    });
    setCurrentPage(1);
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === "desc" ? "↓" : "↑";
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setCurrentPage(1);
    setSearch("");
  };

  return (
    <div className="panel" style={{ padding: 12 }}>
      {/* Top Bar: Tabs + Search + Volume Mode */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        {/* Tabs: NEW | HOT | TRENDING | BONUS | ALL */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => handleTabChange("new")}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "new" ? "rgba(0, 136, 255, 0.5)" : "rgba(255,255,255,0.12)",
              background: activeTab === "new" ? "rgba(0, 136, 255, 0.15)" : "transparent",
              color: activeTab === "new" ? "#0088ff" : "#fff",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
            }}
          >
            NEW
          </button>

          <button
            onClick={() => handleTabChange("hot")}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "hot" ? "rgba(255, 153, 0, 0.55)" : "rgba(255,255,255,0.12)",
              background: activeTab === "hot" ? "rgba(255, 153, 0, 0.16)" : "transparent",
              color: activeTab === "hot" ? "#ff9900" : "#fff",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
            }}
          >
            HOT
          </button>

          <button
            onClick={() => handleTabChange("trending")}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "trending" ? "rgba(0, 255, 136, 0.5)" : "rgba(255,255,255,0.12)",
              background: activeTab === "trending" ? "rgba(0, 255, 136, 0.15)" : "transparent",
              color: activeTab === "trending" ? "#00ff88" : "#fff",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
            }}
          >
            TRENDING
          </button>

          <button
            onClick={() => handleTabChange("bonus")}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "bonus" ? "rgba(245, 200, 75, 0.55)" : "rgba(255,255,255,0.12)",
              background: activeTab === "bonus" ? "rgba(245, 200, 75, 0.12)" : "transparent",
              color: activeTab === "bonus" ? "#F5C84B" : "#fff",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
            }}
          >
            BONUS
          </button>

          <button
            onClick={() => handleTabChange("all")}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: activeTab === "all" ? "rgba(0, 136, 255, 0.5)" : "rgba(255,255,255,0.12)",
              background: activeTab === "all" ? "rgba(0, 136, 255, 0.15)" : "transparent",
              color: activeTab === "all" ? "#0088ff" : "#fff",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.2,
              transition: "all 0.2s",
            }}
          >
            ALL
          </button>
        </div>

        {/* Search */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            type="text"
            placeholder={`Search in ${
              activeTab === "new"
                ? "New"
                : activeTab === "hot"
                ? "Hot"
                : activeTab === "trending"
                ? "Trending"
                : activeTab === "bonus"
                ? "BONUS"
                : "All"
            } Markets...`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              width: "100%",
              padding: "10px 16px",
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

        {/* Volume mode toggle - only show in ALL tab */}
        {activeTab === "all" && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12, marginRight: 4 }}>
              Volume:
            </span>
            <button
              className="btn ghost"
              onClick={() => setVolMode("24h")}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                borderColor: volMode === "24h" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)",
                background: volMode === "24h" ? "rgba(255,255,255,0.10)" : "transparent",
              }}
            >
              24h
            </button>
            <button
              className="btn ghost"
              onClick={() => setVolMode("all")}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                borderColor: volMode === "all" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)",
                background: volMode === "all" ? "rgba(255,255,255,0.10)" : "transparent",
              }}
            >
              ALL
            </button>
          </div>
        )}
      </div>

      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 64,
          zIndex: 20,
          padding: "10px 12px",
          borderRadius: 12,
          background: "rgba(10, 16, 18, 0.65)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 1.6fr) 140px 110px 140px 130px",
            gap: 12,
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <div className="muted">Market</div>
          <div className="muted">Chart</div>

          <div
            className="muted"
            onClick={() => {
              setSortConfig((prev) => {
                if (prev.key === "chance") {
                  if (prev.direction === "desc") return { key: "chance", direction: "asc" };
                  if (prev.direction === "asc") return { key: null, direction: null };
                }
                return { key: "chance", direction: "desc" };
              });
              setCurrentPage(1);
            }}
            style={{
              cursor: "pointer",
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Chance{" "}
            <span style={{ fontSize: 10, opacity: sortConfig.key === "chance" ? 1 : 0.5 }}>
              {getSortIcon("chance")}
            </span>
          </div>

          <div
            className="muted"
            onClick={() => {
              setSortConfig((prev) => {
                if (prev.key === "volume") {
                  if (prev.direction === "desc") return { key: "volume", direction: "asc" };
                  if (prev.direction === "asc") return { key: null, direction: null };
                }
                return { key: "volume", direction: "desc" };
              });
              setCurrentPage(1);
            }}
            style={{
              cursor: "pointer",
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Volume (24h){" "}
            <span style={{ fontSize: 10, opacity: sortConfig.key === "volume" ? 1 : 0.5 }}>
              {getSortIcon("volume")}
            </span>
          </div>

          <div
            className="muted"
            onClick={() => {
              setSortConfig((prev) => {
                if (prev.key === "expires") {
                  if (prev.direction === "desc") return { key: "expires", direction: "asc" };
                  if (prev.direction === "asc") return { key: null, direction: null };
                }
                return { key: "expires", direction: "desc" };
              });
              setCurrentPage(1);
            }}
            style={{
              cursor: "pointer",
              userSelect: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Expires{" "}
            <span style={{ fontSize: 10, opacity: sortConfig.key === "expires" ? 1 : 0.5 }}>
              {getSortIcon("expires")}
            </span>
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {pageList.length === 0 ? (
          <div className="muted" style={{ textAlign: "center", padding: 20 }}>
            {activeTab === "bonus" && bonusLoading
              ? "Scanning for bonus markets... Please wait."
              : search
              ? "No markets found"
              : activeTab === "bonus"
              ? "Loading..."
              : "Loading..."}
          </div>
        ) : (
          pageList.slice(0, visible).map((m, idx) => (
            <MarketRowV2
              key={m.marketId}
              market={m}
              volMode={displayVolMode}
              volumeOverride={volumeMap[String(m.marketId)]}
              priority={idx < 6}
              onChanceLoaded={handleChanceLoaded}
              onVolumeLoaded={handleVolumeLoaded}
              onBonusDetected={handleBonusDetected}
              isBonus={bonusSet.has(String(m.marketId))}
              onOpen={(mk) => (window.location.href = `/market/${mk.marketId}`)}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 16 }}>
          <button
            className="btn ghost"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{ opacity: currentPage === 1 ? 0.4 : 1 }}
          >
            ←
          </button>

          <div className="muted" style={{ paddingTop: 8 }}>
            Page {currentPage} / {totalPages}
          </div>

          <button
            className="btn ghost"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{ opacity: currentPage === totalPages ? 0.4 : 1 }}
          >
            →
          </button>
        </div>
      )}

      {/* Tab info */}
      <div className="muted" style={{ textAlign: "center", marginTop: 12, fontSize: 11 }}>
        {activeTab === "hot"
          ? `Top ${Math.min(HOT_LIMIT, sortedMarkets.length)} hot new markets (ranked by 24h volume)`
          : activeTab === "new"
          ? `Top ${Math.min(NEW_LIMIT, sortedMarkets.length)} newest active markets`
          : activeTab === "trending"
          ? `Top ${Math.min(TRENDING_COUNT, sortedMarkets.length)} markets by 24h volume`
          : activeTab === "bonus"
          ? bonusLoading
            ? `Scanning... Found ${sortedMarkets.length} bonus markets so far`
            : `${sortedMarkets.length} bonus markets`
          : `${sortedMarkets.length} markets total`}
      </div>
    </div>
  );
}
