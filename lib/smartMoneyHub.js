// lib/smartMoneyHub.js
import { opinionFetch, normalizeMarketList } from "@/lib/opinion";
import { insertTrade, pruneOldTrades } from "@/lib/smartMoneyDb"; // ✅ persist trades

let hub = globalThis.__SMART_MONEY_HUB__;

if (!hub) {
  hub = {
    ws: null,
    wsReady: false,
    clients: new Set(), // { push, minAmount }
    latest: [],
    maxLatest: 200,
    
    // ✅ UPDATED: Track subscriptions by type
    // For binary: subscribe with marketId
    // For categorical: subscribe with rootMarketId (receives all child trades)
    subscribedBinaryIds: new Set(),      // binary marketIds
    subscribedRootIds: new Set(),        // categorical rootMarketIds
    
    // Maps for title lookup
    marketTitleById: new Map(),          // marketId -> title (for binary & child markets)
    childToRootMap: new Map(),           // childMarketId -> rootMarketId
    rootTitleById: new Map(),            // rootMarketId -> parent title
    
    started: false,
    starting: false,
    heartbeat: null,
    lastSubscribedAt: 0,
    resubTimer: null,

    // ✅ NEW: background keepalive clients to MarketTradesHub (for Recent Trades)
    // key: marketId (number) -> cleanup fn returned by addMarketClient
    bgRecentUnsubs: new Map(),
  };
  globalThis.__SMART_MONEY_HUB__ = hub;
}

const HEARTBEAT_INTERVAL = 25_000;

// ✅ ONLY keep last 24h trades (in-memory)
const TRADE_TTL_MS = 24 * 60 * 60 * 1000;

// ✅ Auto refresh subscriptions every 1 hour
const RESUBSCRIBE_INTERVAL_MS = 60 * 60 * 1000;

// ✅ subscribe top N markets (now includes binary + categorical child markets)
const TOP_N = 80;

// ✅ Fetch settings for market universe
const UNIVERSE_PAGES = 20; // pages for binary markets
const PAGE_LIMIT = 20;
const CATEGORICAL_DETAIL_BATCH = 10; // concurrent categorical detail fetches

function formatPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "";
  if (n >= 0 && n <= 1.2) return `${(n * 100).toFixed(1)}¢`;
  return `${n}`;
}

function normalizeOutcome(outcomeSide) {
  if (outcomeSide === 1 || outcomeSide === "1") return "YES";
  if (outcomeSide === 2 || outcomeSide === "2") return "NO";
  return outcomeSide ?? "";
}

function pruneLatest() {
  const cutoff = Date.now() - TRADE_TTL_MS;
  hub.latest = hub.latest
    .filter((x) => Number(x?.ts || 0) >= cutoff)
    .slice(0, hub.maxLatest);
}

function pushLatest(item) {
  hub.latest.unshift(item); // newest first
  pruneLatest();
}

function broadcast(item) {
  for (const c of hub.clients) {
    if (Number(item.amount) >= Number(c.minAmount || 1000)) {
      c.push(item);
    }
  }
}

/**
 * Extract 24h volume similar to how UI typically does.
 * Try multiple field names.
 */
function getVolume24h(m) {
  if (!m || typeof m !== "object") return 0;

  const candidates = [
    m.volume24h,
    m.volume_24h,
    m.volume24H,
    m.volume_24H,
    m.vol24h,
    m.vol_24h,
    m.volume24,
    m.volume_24,
    m.volume, // last fallback
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function getMarketId(m) {
  const id = Number(m?.marketId ?? m?.id ?? m?.market_id);
  return Number.isFinite(id) ? id : null;
}

function getMarketTitle(m) {
  // ✅ Opinion API uses 'marketTitle' as primary field, 'tittle' is a typo variant
  return m?.marketTitle ?? m?.tittle ?? m?.title ?? m?.name ?? "";
}

/**
 * Check if a market is resolved (skip subscribing)
 */
function isResolved(m) {
  if (!m) return false;
  if (Number(m?.status) === 4) return true;
  if (String(m?.statusEnum || "").toLowerCase() === "resolved") return true;
  const ra = Number(m?.resolvedAt ?? m?.resolved_at);
  if (Number.isFinite(ra) && ra !== 0) return true;
  return false;
}

function getWsUrl() {
  // ✅ Prefer WS key; fallback to API key if you only have 1 key
  const apiKey = process.env.OPINION_WS_KEY || process.env.OPINION_API_KEY || "";
  if (!apiKey) return null;
  return `wss://ws.opinion.trade?apikey=${encodeURIComponent(apiKey)}`;
}

function startHeartbeat() {
  if (hub.heartbeat) clearInterval(hub.heartbeat);
  hub.heartbeat = setInterval(() => {
    try {
      if (hub.ws && hub.wsReady && hub.ws.readyState === WebSocket.OPEN) {
        hub.ws.send(JSON.stringify({ action: "HEARTBEAT" }));
      }
    } catch (err) {
      console.warn("[SmartMoney] Heartbeat send failed:", err?.message || err);
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * ✅ NEW: Create a background MarketTradesHub client to keep Recent Trades tracking
 * even when no user tab is open. This prevents MarketTradesHub from auto-unsub.
 *
 * Works WITHOUT modifying MarketTradesHub (it simply keeps a client alive).
 */
async function ensureBgRecentClientForMarket(marketId) {
  const id = Number(marketId);
  if (!Number.isFinite(id)) return;

  // already has bg client
  if (hub.bgRecentUnsubs.has(id)) return;

  try {
    // dynamic import to avoid circular deps / build issues
    const mod = await import("./marketTradesHub");
    const addMarketClient = mod?.addMarketClient;

    if (typeof addMarketClient !== "function") {
      // MarketTradesHub not available or different build
      return;
    }

    const cleanup = addMarketClient(
      { marketId: id },
      {
        // no-op; we only need this client to exist to keep subscription alive
        push: () => {},
      }
    );

    hub.bgRecentUnsubs.set(id, cleanup);
    console.log(`[SmartMoney] Pinned recent-trades via bg client: marketId=${id}`);
  } catch (err) {
    console.warn("[SmartMoney] ensureBgRecentClient failed:", err?.message || err);
  }
}

function removeBgRecentClientForMarket(marketId) {
  const id = Number(marketId);
  if (!Number.isFinite(id)) return;

  const cleanup = hub.bgRecentUnsubs.get(id);
  if (typeof cleanup === "function") {
    try {
      cleanup();
    } catch (err) {
      console.warn("[SmartMoney] bgRecentUnsub cleanup error:", err?.message || err);
    }
  }
  hub.bgRecentUnsubs.delete(id);
  console.log(`[SmartMoney] Unpinned recent-trades bg client: marketId=${id}`);
}

/**
 * Fetch a wide market universe (binary + categorical) and compute Top N by volume24h locally.
 * ✅ NOW: Supports both binary markets AND child markets from categorical parents.
 * Top N is computed from childMarkets (categorical) + binary markets, NOT from parent categorical.
 * 
 * Returns: { binaryIds: number[], rootIds: number[], childToRoot: Map<childId, rootId> }
 */
async function fetchTopMarketIdsByVolume24h(topN = TOP_N) {
  const seen = new Set();
  const allTradableMarkets = []; // array of { id, title, volume24h, type: 'binary'|'categorical', rootId? }
  hub.marketTitleById.clear();
  hub.childToRootMap.clear();
  hub.rootTitleById.clear();

  // ================================
  // STEP 1: Fetch BINARY markets
  // ================================
  console.log(`[SmartMoney] Fetching binary markets (marketType=0)...`);
  for (let page = 1; page <= UNIVERSE_PAGES; page++) {
    const raw = await opinionFetch("/market", {
      params: {
        status: "activated",
        page,
        limit: PAGE_LIMIT,
        marketType: 0, // binary only
      },
    });

    const { list } = normalizeMarketList(raw);
    if (!list || list.length === 0) break;

    for (const m of list) {
      const id = getMarketId(m);
      if (!id || seen.has(id)) continue;
      if (isResolved(m)) continue;
      
      seen.add(id);
      const title = getMarketTitle(m);
      const vol = getVolume24h(m);
      
      if (title) hub.marketTitleById.set(id, title);
      allTradableMarkets.push({ id, title, volume24h: vol, type: 'binary' });
    }

    if (allTradableMarkets.length >= 300) break; // cap for performance
  }
  console.log(`[SmartMoney] Found ${allTradableMarkets.length} binary markets`);

  // ================================
  // STEP 2: Fetch CATEGORICAL parent markets
  // ================================
  console.log(`[SmartMoney] Fetching categorical parent markets (marketType=1)...`);
  const categoricalParents = [];
  const seenParents = new Set();

  for (let page = 1; page <= UNIVERSE_PAGES; page++) {
    const raw = await opinionFetch("/market", {
      params: {
        page,
        limit: PAGE_LIMIT,
        sortBy: 5, // volume desc
        marketType: 1, // categorical parent only
      },
    });

    const { list } = normalizeMarketList(raw);
    if (!list || list.length === 0) break;

    for (const m of list) {
      const id = getMarketId(m);
      if (!id || seenParents.has(id)) continue;
      if (isResolved(m)) continue;
      
      seenParents.add(id);
      categoricalParents.push(m);
    }

    if (categoricalParents.length >= 100) break; // cap for performance
  }
  console.log(`[SmartMoney] Found ${categoricalParents.length} categorical parents, fetching child markets...`);

  // ================================
  // STEP 3: Fetch categorical details to get childMarkets
  // ================================
  for (let i = 0; i < categoricalParents.length; i += CATEGORICAL_DETAIL_BATCH) {
    const batch = categoricalParents.slice(i, i + CATEGORICAL_DETAIL_BATCH);
    
    const detailPromises = batch.map(async (m) => {
      const rootId = getMarketId(m);
      // Get parent title from list data first
      let parentTitle = getMarketTitle(m);
      
      try {
        const detail = await opinionFetch(`/market/categorical/${rootId}`);
        const fullData = detail?.result?.data;
        if (!fullData) return [];
        
        // ✅ Prefer parent title from detail API (more reliable)
        const detailTitle = getMarketTitle(fullData);
        if (detailTitle) parentTitle = detailTitle;
        
        const children = Array.isArray(fullData.childMarkets) ? fullData.childMarkets : [];
        // Store parent title
        if (parentTitle) hub.rootTitleById.set(rootId, parentTitle);
        
        return children.map(c => ({ child: c, parentTitle, rootId }));
      } catch (err) {
        console.warn("[SmartMoney] Categorical detail fetch failed:", err?.message || err);
        return [];
      }
    });

    const results = await Promise.all(detailPromises);
    
    for (const childrenWithParent of results) {
      for (const { child, parentTitle, rootId } of childrenWithParent) {
        if (!child) continue;
        
        const childId = getMarketId(child);
        if (!childId || seen.has(childId)) continue;
        if (isResolved(child)) continue;
        
        seen.add(childId);
        
        // Map child -> root for later lookup
        hub.childToRootMap.set(childId, rootId);
        
        // ✅ Child market outcome is in: marketTitle, tittle (API typo), or title
        // Format: [ParentTitle] - [Outcome]
        const outcomeName = child.marketTitle || child.tittle || child.title || child.outcome || child.outcomeName || "";
        const childTitle = parentTitle && outcomeName 
          ? `${parentTitle} - ${outcomeName}` 
          : (parentTitle || outcomeName || "");
        const vol = getVolume24h(child);
        
        if (childTitle) hub.marketTitleById.set(childId, childTitle);
        allTradableMarkets.push({ id: childId, title: childTitle, volume24h: vol, type: 'categorical', rootId });
      }
    }
  }
  console.log(`[SmartMoney] Total tradable markets (binary + categorical children): ${allTradableMarkets.length}`);

  // ================================
  // STEP 4: Sort by volume24h and pick Top N
  // ================================
  allTradableMarkets.sort((a, b) => b.volume24h - a.volume24h);

  const binaryIds = [];
  const rootIdsSet = new Set();
  let count = 0;
  
  for (const m of allTradableMarkets) {
    if (!m.id) continue;
    if (count >= topN) break;
    
    if (m.type === 'binary') {
      binaryIds.push(m.id);
      count++;
    } else if (m.type === 'categorical' && m.rootId) {
      // For categorical, we subscribe to rootId (parent)
      // Only count as 1 if this rootId hasn't been added yet
      if (!rootIdsSet.has(m.rootId)) {
        rootIdsSet.add(m.rootId);
        count++;
      }
    }
  }

  const rootIds = Array.from(rootIdsSet);
  console.log(`[SmartMoney] Selected top ${count} markets: ${binaryIds.length} binary + ${rootIds.length} categorical roots`);
  
  return { binaryIds, rootIds };
}

/**
 * Keep subscription set aligned to current Top N:
 * - SUBSCRIBE newly added markets
 * - UNSUBSCRIBE markets that dropped out
 *
 * ✅ IMPORTANT: Use correct subscription format per Opinion docs:
 * - Binary: { action: "SUBSCRIBE", channel: "market.last.trade", marketId: <id> }
 * - Categorical: { action: "SUBSCRIBE", channel: "market.last.trade", rootMarketId: <parentId> }
 */
async function syncSubscriptionsToTop({ binaryIds, rootIds }, force = false) {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN) return;

  const nextBinarySet = new Set(binaryIds.map((x) => Number(x)).filter((x) => Number.isFinite(x)));
  const nextRootSet = new Set(rootIds.map((x) => Number(x)).filter((x) => Number.isFinite(x)));

  if (force) {
    // Unsubscribe all existing binary subscriptions
    for (const oldId of hub.subscribedBinaryIds) {
      try {
        hub.ws.send(
          JSON.stringify({
            action: "UNSUBSCRIBE",
            channel: "market.last.trade",
            marketId: Number(oldId),
          })
        );
      } catch (err) {
        console.warn("[SmartMoney] WS unsub binary failed:", err?.message || err);
      }
      removeBgRecentClientForMarket(oldId);
    }
    hub.subscribedBinaryIds.clear();

    // Unsubscribe all existing categorical (root) subscriptions
    for (const oldRootId of hub.subscribedRootIds) {
      try {
        hub.ws.send(
          JSON.stringify({
            action: "UNSUBSCRIBE",
            channel: "market.last.trade",
            rootMarketId: Number(oldRootId),
          })
        );
      } catch (err) {
        console.warn("[SmartMoney] WS unsub root failed:", err?.message || err);
      }
    }
    hub.subscribedRootIds.clear();
  } else {
    // Unsubscribe dropped binary markets
    for (const oldId of hub.subscribedBinaryIds) {
      if (!nextBinarySet.has(oldId)) {
        hub.subscribedBinaryIds.delete(oldId);
        try {
          hub.ws.send(
            JSON.stringify({
              action: "UNSUBSCRIBE",
              channel: "market.last.trade",
              marketId: Number(oldId),
            })
          );
        } catch (err) {
          console.warn("[SmartMoney] WS unsub binary failed:", err?.message || err);
        }
        removeBgRecentClientForMarket(oldId);
      }
    }

    // Unsubscribe dropped categorical roots
    for (const oldRootId of hub.subscribedRootIds) {
      if (!nextRootSet.has(oldRootId)) {
        hub.subscribedRootIds.delete(oldRootId);
        try {
          hub.ws.send(
            JSON.stringify({
              action: "UNSUBSCRIBE",
              channel: "market.last.trade",
              rootMarketId: Number(oldRootId),
            })
          );
        } catch (err) {
          console.warn("[SmartMoney] WS unsub root failed:", err?.message || err);
        }
      }
    }
  }

  // Subscribe new binary markets
  let addedBinary = 0;
  for (const id of nextBinarySet) {
    if (!hub.subscribedBinaryIds.has(id)) {
      hub.subscribedBinaryIds.add(id);
      addedBinary++;
      try {
        hub.ws.send(
          JSON.stringify({
            action: "SUBSCRIBE",
            channel: "market.last.trade",
            marketId: Number(id),
          })
        );
      } catch (err) {
        console.warn("[SmartMoney] WS sub binary failed:", err?.message || err);
      }
    }
    // Ensure background recent-trades tracking
    await ensureBgRecentClientForMarket(id);
  }

  // Subscribe new categorical roots
  let addedRoot = 0;
  for (const rootId of nextRootSet) {
    if (!hub.subscribedRootIds.has(rootId)) {
      hub.subscribedRootIds.add(rootId);
      addedRoot++;
      try {
        hub.ws.send(
          JSON.stringify({
            action: "SUBSCRIBE",
            channel: "market.last.trade",
            rootMarketId: Number(rootId),
          })
        );
      } catch (err) {
        console.warn("[SmartMoney] WS sub root failed:", err?.message || err);
      }
    }
  }

  console.log(
    `[SmartMoney] Synced subscriptions. binary=${hub.subscribedBinaryIds.size} (+${addedBinary}), categorical roots=${hub.subscribedRootIds.size} (+${addedRoot})`
  );
}

async function refreshTopSubscriptions(force = false) {
  const now = Date.now();
  if (!force && hub.lastSubscribedAt && now - hub.lastSubscribedAt < RESUBSCRIBE_INTERVAL_MS) return;

  const { binaryIds, rootIds } = await fetchTopMarketIdsByVolume24h(TOP_N);
  hub.lastSubscribedAt = now;

  console.log("[SmartMoney] Refresh top list:", binaryIds.length, "binary +", rootIds.length, "categorical roots");
  await syncSubscriptionsToTop({ binaryIds, rootIds }, force);
}

function startResubscribeTimer() {
  if (hub.resubTimer) clearInterval(hub.resubTimer);
  hub.resubTimer = setInterval(() => {
    refreshTopSubscriptions(false).catch(() => {});
  }, RESUBSCRIBE_INTERVAL_MS);
}

function ensureWS() {
  if (hub.ws && (hub.wsReady || hub.ws.readyState === 0 || hub.ws.readyState === 1)) {
    return;
  }

  const WS_URL = getWsUrl();
  if (!WS_URL) return;

  hub.ws = new WebSocket(WS_URL);

  hub.ws.onopen = async () => {
    hub.wsReady = true;
    startHeartbeat();
    startResubscribeTimer();
    await refreshTopSubscriptions(true); // force sync on open
  };

  hub.ws.onmessage = (ev) => {
    try {
      const text = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf-8");
      const data = JSON.parse(text);

      if (data?.msgType !== "market.last.trade") return;

      // ✅ For categorical markets, trades come with both rootMarketId and marketId (child)
      // marketId = the actual child market where trade happened
      // rootMarketId = the parent categorical market we subscribed to
      const marketId = Number(data.marketId);
      const rootMarketId = data.rootMarketId ? Number(data.rootMarketId) : null;

      // ✅ Get title from marketTitleById (already built with format [ParentTitle] - [Outcome] for categorical)
      // marketTitleById contains:
      // - Binary markets: their own title
      // - Categorical child markets: "[ParentTitle] - [Outcome]" format
      let marketTitle = hub.marketTitleById.get(marketId) || "";
      
      // Fallback: if not found in map but has rootMarketId, at least show parent title
      if (!marketTitle && rootMarketId) {
        marketTitle = hub.rootTitleById.get(rootMarketId) || "";
      }

      const item = {
        ts: Date.now(),
        marketId,
        rootMarketId: rootMarketId || null,
        side: data.side,
        amount: Number(data.amount || 0),
        price: formatPrice(data.price),
        outcome: normalizeOutcome(data.outcomeSide),
        marketTitle,
      };

      if (!Number.isFinite(item.marketId) || !Number.isFinite(item.amount)) return;

      pushLatest(item);
      insertTrade(item);

      if ((hub.latest?.length || 0) % 50 === 0) {
        pruneOldTrades({ days: 7 });
      }

      broadcast(item);
    } catch (err) {
      console.error("[SmartMoney] WS onmessage error:", err.message);
    }
  };

  hub.ws.onclose = () => {
    hub.wsReady = false;
    hub.ws = null;

    if (hub.heartbeat) clearInterval(hub.heartbeat);
    hub.heartbeat = null;

    if (hub.resubTimer) clearInterval(hub.resubTimer);
    hub.resubTimer = null;

    // Cleanup stale bgRecentUnsubs - they'll be recreated on reconnect by refreshTopSubscriptions(true)
    for (const [id, unsub] of hub.bgRecentUnsubs) {
      try { if (typeof unsub === "function") unsub(); } catch { /* ignore cleanup errors */ }
    }
    hub.bgRecentUnsubs.clear();

    setTimeout(() => ensureWS(), 1500);
  };

  hub.ws.onerror = () => {
    // onclose will reconnect
  };
}

export function startSmartMoneyHub() {
  if (hub.started || hub.starting) return;
  hub.starting = true;
  ensureWS();
  hub.started = true;
  hub.starting = false;
}

export function addClient(client) {
  hub.clients.add(client);
  return () => hub.clients.delete(client);
}

export function getLatest() {
  pruneLatest();
  return hub.latest;
}

export function getSmartMoneyHubStatus() {
  const binaryIds = Array.from(hub.subscribedBinaryIds || []);
  const rootIds = Array.from(hub.subscribedRootIds || []);
  
  return {
    started: !!hub.started,
    wsReady: !!hub.wsReady,
    latestCount: Array.isArray(hub.latest) ? hub.latest.length : 0,
    
    // Subscription counts
    subscribedBinaryCount: binaryIds.length,
    subscribedRootCount: rootIds.length,
    subscribedTotalCount: binaryIds.length + rootIds.length,
    lastSubscribedAt: hub.lastSubscribedAt || 0,

    // debug
    pinnedRecentCount: hub.bgRecentUnsubs ? hub.bgRecentUnsubs.size : 0,

    // Sample binary markets
    binaryMarketsSample: binaryIds
      .slice(0, 10)
      .map((id) => ({
        id,
        title: hub.marketTitleById.get(id) || "",
      })),
    
    // Sample categorical roots
    categoricalRootsSample: rootIds
      .slice(0, 10)
      .map((id) => ({
        rootId: id,
        title: hub.rootTitleById.get(id) || "",
      })),
  };
}
