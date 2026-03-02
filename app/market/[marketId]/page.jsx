import OrderbookView from "@/components/OrderbookView";
import { opinionFetch } from "@/lib/opinion";

export const dynamic = "force-dynamic";

/*
 * GP3+GP4: Minimal server component
 *
 * Server does ONLY 1 fast call: opinionFetch("/market/{id}") (~200-400ms)
 * All enrichment (parent title, rules, volume) is fetched CLIENT-SIDE
 * by OrderbookView via /api/opinion/market/{id}/enrich (lazy, non-blocking).
 *
 * This brings server response from ~1-10s down to ~200-400ms.
 */

function pickMarketFromApi(payload) {
  return payload?.result?.data ?? payload?.result ?? payload?.data ?? payload ?? {};
}

function checkHasBonus(marketData) {
  return (
    "incentiveFactor" in marketData ||
    "incentive_factor" in marketData ||
    "incentive" in marketData
  );
}

export default async function MarketPage({ params, searchParams }) {
  const marketId = params?.marketId;
  const parentTitleFromUrl = searchParams?.parentTitle || "";

  // ── GP3: Single fast server call ──
  const r = await opinionFetch(`/market/${marketId}`);

  const ok = r &&
    ((typeof r?.errno === "number" && r.errno === 0) ||
     (typeof r?.code === "number" && r.code === 0));

  let m = ok ? pickMarketFromApi({ errno: 0, result: { data: r?.result?.data ?? r?.result ?? r } }) : null;

  if (!m) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>Market #{marketId}</div>
        <p className="muted" style={{ marginTop: 8 }}>
          Failed to load market detail.
        </p>
        <div style={{ marginTop: 10 }}>
          <a className="btn" href="/">
            ← Back
          </a>
        </div>
      </div>
    );
  }

  // Basic title from Opinion API (may be child-only for multi-outcome)
  let title = m.marketTitle || m.title || m.tittle || m.marketName || `Market ${marketId}`;

  // If parentTitle from Discover page URL params, build full title immediately (free, no API call)
  if (parentTitleFromUrl) {
    const outcomeName = m.marketTitle || m.tittle || m.title || "";
    title = `${parentTitleFromUrl} - ${outcomeName}`;
    m.parentEventTitle = parentTitleFromUrl;
    m.isMultiOutcome = true;
  }

  const yesTokenId = m.yesTokenId || m.yes_token_id || m.yesToken || null;
  const noTokenId = m.noTokenId || m.no_token_id || m.noToken || null;
  const hasBonus = checkHasBonus(m);
  const yesLabel = m.yesLabel || m.yes_label || "YES";
  const noLabel  = m.noLabel  || m.no_label  || "NO";

  return (
    <OrderbookView
      marketId={marketId}
      title={title}
      yesTokenId={yesTokenId}
      noTokenId={noTokenId}
      marketData={m}
      hasBonus={hasBonus}
      yesLabel={yesLabel}
      noLabel={noLabel}
    />
  );
}
