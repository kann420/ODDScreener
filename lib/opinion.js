const DEFAULT_BASE_URL = "https://proxy.opinion.trade:8443/openapi";

function getBaseUrl() {
  return (process.env.OPINION_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getApiKey() {
  return process.env.OPINION_API_KEY || "";
}

export async function opinionFetch(path, { method = "GET", params, body } = {}) {
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();

  if (!apiKey) {
    return { errno: -1, errormsg: "missing_api_key", result: null };
  }

  const url = new URL(baseUrl + path);

  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  let res;
  let text = "";
  try {
    res = await fetch(url.toString(), {
      method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    text = await res.text();
  } catch (e) {
    return {
      errno: -1,
      errormsg: "fetch_failed",
      result: null,
    };
  }

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    return {
      errno: -1,
      errormsg: "upstream_http_error",
      result: null,
    };
  }

  return data;
}

export function normalizeMarketList(raw) {
  const result = raw?.result ?? raw ?? {};
  const srcList = Array.isArray(result?.list)
    ? result.list
    : Array.isArray(raw?.list)
      ? raw.list
      : [];

  const total = Number(result?.total ?? raw?.total ?? srcList.length);

  const list = srcList.map((m) => {
    // Check if market has bonus (incentiveFactor field EXISTS, regardless of value)
    const hasBonus = 
      "incentiveFactor" in m ||
      "incentive_factor" in m ||
      "incentive" in m;

    return {
      marketId: m.marketId ?? m.id ?? m.market_id,
      title: m.tittle ?? m.title ?? m.question ?? m.marketTitle ?? m.name ?? "",
      status: m.status ?? "",
      statusEnum: m.statusEnum ?? m.status_enum ?? "",
      volume24h: Number(m.volume24h ?? m.vol24h ?? m.volume_24h ?? 0),
      volume: Number(m.volume ?? m.volTotal ?? m.volume_total ?? 0),
      cutoffAt:
        m.cutoffAt ??
        m.cutoff_at ??
        m.closeTime ??
        m.close_time ??
        m.endTime ??
        m.end_time ??
        m.expiresAt ??
        m.expires_at ??
        m.expireAt ??
        m.expire_at ??
        m.expiration ??
        m.expirationTime ??
        m.expiration_time ??
        null,
      resolvedAt: m.resolvedAt ?? m.resolved_at ?? m.resolveTime ?? m.resolve_time ?? null,
      // resultTokenId indicates market has been resolved with a result
      resultTokenId: m.resultTokenId ?? m.result_token_id ?? m.resultToken ?? null,
      yesTokenId: m.yesTokenId ?? m.yes_token_id ?? null,
      noTokenId: m.noTokenId ?? m.no_token_id ?? null,
      // Simple boolean flag for bonus markets
      hasBonus,
    };
  });

  return { total, list };
}
