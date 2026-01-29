/**
 * Shared Date Utilities for Market Expiration Detection
 * Extracted to reduce bundle duplication across components
 */

// Month name mapping (used by multiple functions)
const MONTHS = {
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

/**
 * Convert various timestamp formats to milliseconds
 */
export function toMs(v) {
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

/**
 * Guess year for a month without explicit year
 */
function guessYear(month) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  if (month <= currentMonth) {
    return currentYear;
  }
  if (month - currentMonth > 6) {
    return currentYear - 1;
  }
  return currentYear;
}

/**
 * Create timestamp from date components
 */
function toTimestamp(year, month, day) {
  return Math.floor(new Date(year, month, day, 23, 59, 59).getTime() / 1000);
}

// Compiled regex patterns (created once, reused)
const PATTERNS = {
  // "Month Day, Year" or "Month Day Year"
  monthDayYear: /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/i,
  
  // "by/before/on/until Month Day"
  byMonthDay: /\b(?:by|before|on|until)\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  
  // "Month Day" at end
  monthDayEnd: /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*\?)?$/i,
  
  // "in Month [Year]"
  inMonth: /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/i,
  
  // Year at end
  yearEnd: /\b(202[0-9])\s*\??$/,
  
  // Q1/Q2/Q3/Q4
  quarter: /\bQ([1-4])\s*(\d{4})\b/i,
  
  // Numeric date M/D or MM/DD
  numericDate: /\b(?:on|by|before|until)?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:\?|$)/i,
  
  // "Month Day" anywhere (fallback)
  monthDayAny: /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
};

/**
 * Extract expiration date from market title
 * Returns Unix timestamp in SECONDS if found, 0 otherwise
 */
export function extractExpiresFromTitle(title) {
  if (!title) return 0;
  const str = String(title).trim();

  // Pattern 1: "Month Day, Year" or "Month Day Year"
  const match1 = str.match(PATTERNS.monthDayYear);
  if (match1) {
    const month = MONTHS[match1[1].toLowerCase()];
    const day = parseInt(match1[2], 10);
    const year = parseInt(match1[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020 && year <= 2035) {
      return toTimestamp(year, month, day);
    }
  }

  // Pattern 2: "by/before/on/until Month Day"
  const match2 = str.match(PATTERNS.byMonthDay);
  if (match2) {
    const month = MONTHS[match2[1].toLowerCase()];
    const day = parseInt(match2[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      return toTimestamp(guessYear(month), month, day);
    }
  }

  // Pattern 3: "Month Day" at end
  const match3 = str.match(PATTERNS.monthDayEnd);
  if (match3) {
    const month = MONTHS[match3[1].toLowerCase()];
    const day = parseInt(match3[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      return toTimestamp(guessYear(month), month, day);
    }
  }

  // Pattern 4: "in Month [Year]"
  const match4 = str.match(PATTERNS.inMonth);
  if (match4) {
    const month = MONTHS[match4[1].toLowerCase()];
    const year = match4[2] ? parseInt(match4[2], 10) : guessYear(month);
    if (month !== undefined && year >= 2020 && year <= 2035) {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return toTimestamp(year, month, lastDay);
    }
  }

  // Pattern 5: Year at end
  const match5 = str.match(PATTERNS.yearEnd);
  if (match5) {
    const year = parseInt(match5[1], 10);
    return toTimestamp(year, 11, 31);
  }

  // Pattern 6: Q1/Q2/Q3/Q4
  const match6 = str.match(PATTERNS.quarter);
  if (match6) {
    const quarter = parseInt(match6[1], 10);
    const year = parseInt(match6[2], 10);
    const endMonth = quarter * 3 - 1;
    const lastDay = new Date(year, endMonth + 1, 0).getDate();
    return toTimestamp(year, endMonth, lastDay);
  }

  // Pattern 7: Numeric date
  const match7 = str.match(PATTERNS.numericDate);
  if (match7) {
    const monthNum = parseInt(match7[1], 10) - 1;
    const day = parseInt(match7[2], 10);
    let year = match7[3] ? parseInt(match7[3], 10) : guessYear(monthNum);
    if (year < 100) year += 2000;
    
    if (monthNum >= 0 && monthNum <= 11 && day >= 1 && day <= 31 && year >= 2020 && year <= 2035) {
      return toTimestamp(year, monthNum, day);
    }
  }

  // Pattern 8: "Month Day" anywhere (fallback)
  const match8 = str.match(PATTERNS.monthDayAny);
  if (match8) {
    const month = MONTHS[match8[1].toLowerCase()];
    const day = parseInt(match8[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      return toTimestamp(guessYear(month), month, day);
    }
  }

  return 0;
}

/**
 * Get expiration timestamp from market object
 */
export function getExpiresTimestamp(m) {
  if (!m) return 0;

  if (m.cutoffAt && m.cutoffAt > 0) return m.cutoffAt;
  if (m.cutoffTime && m.cutoffTime > 0) return m.cutoffTime;
  if (m.expiresAt && m.expiresAt > 0) return m.expiresAt;
  if (m.resolvedAt && m.resolvedAt > 0) return m.resolvedAt;

  return extractExpiresFromTitle(m.title);
}

/**
 * Check if market is resolved by status
 */
export function isResolvedByStatus(m) {
  const statusRaw = m?.status;
  
  // Direct check for numeric status
  if (statusRaw === 4 || statusRaw === "4") return true;
  if (statusRaw === 3 || statusRaw === "3") return true;
  if (statusRaw === 5 || statusRaw === "5") return true;
  if (statusRaw === 6 || statusRaw === "6") return true;
  
  const stNum = Number(statusRaw);
  if (Number.isFinite(stNum) && stNum >= 3 && stNum !== 2) {
    return true;
  }

  // Check statusEnum
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

/**
 * Check if market is expired
 */
export function isExpiredMarket(m, nowSec) {
  const expSec = getExpiresTimestamp(m);
  if (!expSec) return false;
  return expSec <= nowSec;
}

/**
 * Check if market is active and not expired
 */
export function isActiveNotExpired(m, nowMs) {
  if (!m) return false;

  if (isResolvedByStatus(m)) return false;
  
  const resolvedAt = m?.resolvedAt ?? m?.resolved_at;
  if (resolvedAt !== null && resolvedAt !== undefined && resolvedAt !== 0 && resolvedAt !== "") {
    const resolvedNum = Number(resolvedAt);
    if (Number.isFinite(resolvedNum) && resolvedNum > 0) return false;
  }
  
  const resultTokenId = m?.resultTokenId ?? m?.result_token_id;
  if (resultTokenId !== null && resultTokenId !== undefined && resultTokenId !== "" && resultTokenId !== 0) {
    return false;
  }

  const nowSec = Math.floor(nowMs / 1000);
  const cutoffAt = m?.cutoffAt ?? m?.cutoff_at ?? 0;
  if (cutoffAt && Number(cutoffAt) > 0 && Number(cutoffAt) <= nowSec) {
    return false;
  }

  if (isExpiredMarket(m, nowSec)) return false;

  return true;
}

/**
 * Parse compact number format (e.g., "1.5K", "2.3M")
 */
export function parseCompactNumber(v) {
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

/**
 * Get volume value from market object
 */
export function getVolumeValue(m, mode) {
  if (!m) return 0;
  if (mode === "24h") {
    return parseCompactNumber(m?.volume24h ?? m?.vol24h ?? m?.volume_24h ?? 0);
  }
  return parseCompactNumber(m?.volume ?? m?.volTotal ?? m?.volume_total ?? m?.volumeAll ?? 0);
}
