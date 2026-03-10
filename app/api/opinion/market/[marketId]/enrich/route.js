import { NextResponse } from "next/server";
import { opinionFetch } from "@/lib/opinion";
import { mapWithConcurrency } from "@/lib/concurrency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GP3+GP4: Client-side enrichment endpoint
 *
 * Called lazily by OrderbookView AFTER initial render.
 * Fetches parent title, rules, and other metadata for categorical child markets.
 *
 * GET /api/opinion/market/{marketId}/enrich
 *
 * Returns: { parentTitle, rules, parentEventId, volume, cutoffAt, thumbnailUrl }
 */

// ============ CHILD → PARENT CACHE (shared with page.jsx via globalThis) ============
const _parentCache = globalThis.__PARENT_CHILD_CACHE__ ?? (globalThis.__PARENT_CHILD_CACHE__ = {
  map: null,
  builtAt: 0,
  building: null,
  TTL: 10 * 60 * 1000,
});
if (!globalThis.__PARENT_CHILD_CACHE__) globalThis.__PARENT_CHILD_CACHE__ = _parentCache;

async function _buildParentMap() {
  const PAGE_SIZE = 20;
  const MAX_PAGES = 25;
  const parentIds = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const result = await opinionFetch("/market", {
        params: { sortBy: 5, limit: PAGE_SIZE, page, marketType: 1 },
      });
      if (result?.errno !== 0) break;
      const list = result?.result?.list || [];
      parentIds.push(...list.map((p) => p.marketId));
      if (list.length < PAGE_SIZE) break;
    } catch { break; }
  }
  const map = new Map();
  await mapWithConcurrency(parentIds, async (pid) => {
    try {
      const detail = await opinionFetch(`/market/categorical/${pid}`);
      const pd = detail?.result?.data;
      if (!pd) return;
      const children = pd.childMarkets || [];
      const parentTitle = pd.marketTitle || pd.tittle || pd.title || "";
      const parentRules = pd.rules || pd.description || pd.marketRules || pd.resolutionRules || "";
      const parentThumbnail = pd.thumbnailUrl || pd.thumbnail_url || pd.coverUrl || pd.cover_url || "";
      for (const c of children) {
        map.set(String(c.marketId), { parentId: pid, parentTitle, parentRules, parentThumbnail });
      }
    } catch {}
  }, { concurrency: 6 });
  return map;
}

async function getParentForChild(childMarketId) {
  const now = Date.now();
  if (_parentCache.map && (now - _parentCache.builtAt) < _parentCache.TTL) {
    return _parentCache.map.get(String(childMarketId)) || null;
  }
  if (!_parentCache.building) {
    _parentCache.building = _buildParentMap()
      .then((m) => { _parentCache.map = m; _parentCache.builtAt = Date.now(); _parentCache.building = null; return m; })
      .catch((e) => { console.error("[ParentCache] Build failed:", e.message); _parentCache.building = null; return _parentCache.map || new Map(); });
  }
  const map = await _parentCache.building;
  return (map || _parentCache.map)?.get(String(childMarketId)) || null;
}

// ── In-memory result cache (30s TTL) ──
const ENRICH_CACHE = globalThis.__ENRICH_CACHE__ ?? (globalThis.__ENRICH_CACHE__ = new Map());
if (!globalThis.__ENRICH_CACHE__) globalThis.__ENRICH_CACHE__ = ENRICH_CACHE;
const ENRICH_TTL = 30_000;

// Helper: extract all possible parent/root ID field names from a market object
function extractRootId(m) {
  return (
    m?.rootMarketId ||
    m?.root_market_id ||
    m?.parentEventId ||
    m?.parent_event_id ||
    m?.categoricalParentId ||
    m?.categorical_parent_id ||
    m?.categoricalId ||
    m?.categorical_id ||
    m?.parentId ||
    m?.parent_id ||
    m?.rootId ||
    m?.root_id ||
    null
  );
}

// Helper: extract all possible rules field names from a market object
function extractRules(m) {
  return (
    m?.rules ||
    m?.resolutionRules ||
    m?.resolution_rules ||
    m?.marketRules ||
    m?.market_rules ||
    m?.description ||
    m?.context ||
    ""
  );
}

// Helper: fetch & parse categorical parent data from Opinion API
async function fetchCategoricalParent(parentId) {
  if (!parentId) return null;
  try {
    const detail = await opinionFetch(`/market/categorical/${parentId}`);
    const pd = detail?.result?.data;
    if (!pd) return null;
    return {
      parentTitle: pd.marketTitle || pd.tittle || pd.title || "",
      rules: extractRules(pd),
      thumbnailUrl: pd.thumbnailUrl || pd.thumbnail_url || pd.coverUrl || pd.cover_url || "",
    };
  } catch {
    return null;
  }
}

export async function GET(req, { params }) {
  const marketId = params?.marketId;
  if (!marketId) {
    return NextResponse.json({ error: "missing_marketId" }, { status: 400 });
  }

  // Accept rootMarketId hint from client (passed when available from marketData or WS trades)
  const { searchParams } = new URL(req.url);
  const hintRootId = searchParams.get("rootMarketId") || null;

  // Cache key includes hint so a re-call with rootMarketId gets its own entry
  const cacheKey = `enrich:${marketId}${hintRootId ? `:r${hintRootId}` : ""}`;
  const cached = ENRICH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.t < ENRICH_TTL) {
    return NextResponse.json(cached.v, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30", "x-cache": "HIT" },
    });
  }

  try {
    let parentTitle = "";
    let rules = "";
    let parentEventId = hintRootId ? Number(hintRootId) : null;
    let thumbnailUrl = "";
    let volume = null;
    let volume24h = null;
    let cutoffAt = null;

    // ── Fast path: rootMarketId hint provided by client → call categorical directly ──
    if (hintRootId) {
      const pd = await fetchCategoricalParent(hintRootId);
      if (pd) {
        parentTitle = pd.parentTitle;
        rules = pd.rules;
        thumbnailUrl = pd.thumbnailUrl;
      }
    }

    // ── Standard path: fetch market by ID and look for rootMarketId in response ──
    if (!rules || !parentTitle) {
      const r = await opinionFetch(`/market/${marketId}`);
      const m = r?.result?.data ?? r?.result ?? {};

      // Pull base fields from market response
      if (!rules) rules = extractRules(m);
      if (!thumbnailUrl) thumbnailUrl = m.thumbnailUrl || m.thumbnail_url || m.coverUrl || m.cover_url || "";
      volume = m.volume || m.totalVolume || m.total_volume || null;
      cutoffAt = m.cutoffAt || m.resolvedAt || m.expiresAt || null;
      volume24h = m.volume24h || m.volume_24h || m.dayVolume || null;

      // Detect parent/root market ID from all known field names
      if (!parentEventId) parentEventId = extractRootId(m);

      // Fetch categorical parent if we now have its ID
      if (parentEventId && (!rules || !parentTitle)) {
        const pd = await fetchCategoricalParent(parentEventId);
        if (pd) {
          if (!parentTitle) parentTitle = pd.parentTitle;
          if (!rules) rules = pd.rules;
          if (!thumbnailUrl) thumbnailUrl = pd.thumbnailUrl;
        }
      }
    }

    // ── Fallback: global child→parent cache (covers markets with no parentId in API response) ──
    if (!rules || !parentTitle) {
      try {
        const pc = await getParentForChild(marketId);
        if (pc) {
          if (!parentTitle) parentTitle = pc.parentTitle || "";
          if (!rules) rules = pc.parentRules || "";
          if (!parentEventId) parentEventId = pc.parentId || null;
          if (!thumbnailUrl) thumbnailUrl = pc.parentThumbnail || "";
        }
      } catch {}
    }

    const result = {
      parentTitle,
      rules,
      parentEventId,
      volume,
      volume24h,
      cutoffAt,
      thumbnailUrl,
    };

    ENRICH_CACHE.set(cacheKey, { t: Date.now(), v: result });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30", "x-cache": "MISS" },
    });
  } catch (e) {
    return NextResponse.json({ error: "enrich_failed" }, { status: 500 });
  }
}
