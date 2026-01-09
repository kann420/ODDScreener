import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import { getMultiOutcomeMarkets } from "@/lib/opinionAnalytics";
import MarketListClient from "@/components/MarketListClient";
import DiscoverNewsBar from "@/components/DiscoverNewsBar";

export const dynamic = "force-dynamic";
export const revalidate = 30; // Cache for 30 seconds

/**
 * Convert various timestamp formats to milliseconds:
 * - unix seconds
 * - unix milliseconds
 * - numeric string
 * - ISO date string
 */
function toMs(v) {
  if (v === null || v === undefined) return null;

  // number or numeric string
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n; // auto-detect sec vs ms
  }

  // ISO date string
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }

  return null;
}

/**
 * Opinion Market Status Enum (from SDK):
 * - CREATED = 1
 * - ACTIVATED = 2 (active, tradeable)
 * - RESOLVING = 3 (being resolved)
 * - RESOLVED = 4 (already resolved/expired)
 * - FAILED = 5
 * - DELETED = 6
 */
const TOPIC_STATUS = {
  CREATED: 1,
  ACTIVATED: 2,
  RESOLVING: 3,
  RESOLVED: 4,
  FAILED: 5,
  DELETED: 6,
};

/**
 * Try to extract a date from market title for markets that haven't been resolved yet
 * but their deadline has clearly passed based on the title.
 */
function extractDateFromTitle(title) {
  if (!title) return null;

  const str = String(title).trim();

  const months = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    sept: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11,
    dec: 11,
  };

  // Pattern 1: "Month Day, Year" (e.g., "December 31, 2025")
  const pattern1 =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/i;
  const match1 = str.match(pattern1);
  if (match1) {
    const month = months[match1[1].toLowerCase()];
    const day = parseInt(match1[2], 10);
    const year = parseInt(match1[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020 && year <= 2030) {
      return new Date(year, month, day, 23, 59, 59, 999).getTime();
    }
  }

  // Pattern 2: "in Month Year?" or "in Month?"
  const pattern2 =
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\s*\??/i;
  const match2 = str.match(pattern2);
  if (match2) {
    const month = months[match2[1].toLowerCase()];
    let year = match2[2] ? parseInt(match2[2], 10) : null;

    if (!year) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      if (month < currentMonth) {
        year = currentYear;
      } else if (month === currentMonth) {
        year = currentYear;
      } else {
        year = currentYear - 1;
      }
    }

    if (month !== undefined && year >= 2020 && year <= 2030) {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return new Date(year, month, lastDay, 23, 59, 59, 999).getTime();
    }
  }

  return null;
}

/**
 * FAST filter using only list data (no detail fetch needed)
 * This uses: status, resolvedAt, resultTokenId from list + title extraction
 */
function isExpiredFast(market) {
  if (!market) return true;

  const now = Date.now();

  // 1) Check status
  const status = Number(market?.status ?? 0);
  if (status === TOPIC_STATUS.RESOLVED) return true;
  if (status === TOPIC_STATUS.RESOLVING) return true;
  if (status >= TOPIC_STATUS.FAILED) return true;

  const statusEnum = String(market?.statusEnum ?? market?.status_enum ?? "").toLowerCase();
  if (statusEnum === "resolved" || statusEnum === "resolving" || statusEnum === "failed" || statusEnum === "deleted") {
    return true;
  }

  // 2) Check resultTokenId
  const resultTokenId = String(market?.resultTokenId ?? market?.result_token_id ?? "").trim();
  if (resultTokenId.length > 0) return true;

  // 3) Check resolvedAt
  const resolvedAtMs = toMs(market?.resolvedAt ?? market?.resolved_at);
  if (resolvedAtMs && resolvedAtMs > 0) return true;

  // 4) Check cutoffAt if available
  const cutoffAtMs = toMs(market?.cutoffAt ?? market?.cutoff_at);
  if (cutoffAtMs && cutoffAtMs > 0 && cutoffAtMs < now) {
    return true;
  }

  // 5) Extract date from title
  const title = market?.marketTitle ?? market?.tittle ?? market?.title ?? "";
  const titleDateMs = extractDateFromTitle(title);
  if (titleDateMs && titleDateMs < now) {
    return true;
  }

  // 6) Only keep ACTIVATED markets
  if (status !== TOPIC_STATUS.ACTIVATED && status !== 0) {
    return true;
  }

  return false;
}

export default async function Home() {
  const startTime = Date.now();

  // Fetch both APIs in parallel - NO detail fetches
  const [opinionResult, analyticsResult] = await Promise.all([
    opinionFetch("/market", {
      // Higher limit so BONUS markets are reliably included.
      // (Bonus markets are sparse and can be missed in a small top-N fetch.)
      params: { status: "activated", sortBy: 5, limit: 500 },
    }),
    getMultiOutcomeMarkets(),
  ]);

  console.log(`[Discover] API fetch took ${Date.now() - startTime}ms`);

  if (opinionResult?.errno !== 0) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load markets. Please try again later.
        </p>
      </div>
    );
  }

  const { total, list: opinionList } = normalizeMarketList(opinionResult);
  const multiOutcomeList = analyticsResult.success ? analyticsResult.data : [];

  // Detect bonus markets from list data (check hasBonus flag)
  const bonusIdsFromList = opinionList
    .filter((m) => m.hasBonus === true)
    .map((m) => m.marketId);
  
  console.log(`[Discover] Found ${bonusIdsFromList.length} bonus markets in list data`);

  // Merge list + multi-outcome, dedup by marketId
  const baseList = [...(multiOutcomeList || []), ...(opinionList || [])];

  const byId = new Map();
  for (const m of baseList) {
    const id = m?.marketId;
    if (id === null || id === undefined) continue;
    const k = String(id);
    if (!byId.has(k)) byId.set(k, m);
  }

  const merged = Array.from(byId.values());

  // FAST filter - no API calls, just use existing data + title extraction
  const filtered = merged.filter((m) => !isExpiredFast(m));

  console.log(`[Discover] Total processing took ${Date.now() - startTime}ms`);
  console.log(`[Discover] Showing ${filtered.length}/${merged.length} markets after fast filter`);

  return (
    <div className="col" style={{ gap: 12 }}>
      {/* HEADER PANEL: replace Discover/Showing text with News bar */}
      <DiscoverNewsBar initialMarkets={filtered} />

      {/* Markets */}
      <MarketListClient markets={filtered} initialBonusIds={bonusIdsFromList} />
    </div>
  );
}
