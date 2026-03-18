const PREDICTFUN_GRAPHQL_URL =
  process.env.PREDICTFUN_GRAPHQL_URL || "https://graphql.predict.fun/graphql";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGraphqlErrorMessage(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  if (!errors.length) return null;
  return errors
    .map((item) => String(item?.message || item?.extensions?.code || "graphql_error").trim())
    .filter(Boolean)
    .join(" | ");
}

export async function predictFunGraphqlFetch(
  query,
  variables = {},
  { timeoutMs = 12_000, retries = 1 } = {}
) {
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(750 * 2 ** (attempt - 1), 3_000);
      await sleep(delayMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(PREDICTFUN_GRAPHQL_URL, {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`[PredictFun GraphQL] HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const payload = await res.json();
      const errorMessage = extractGraphqlErrorMessage(payload);
      if (errorMessage) {
        throw new Error(`[PredictFun GraphQL] ${errorMessage}`);
      }

      return payload?.data ?? null;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err?.name === "AbortError"
        ? new Error(`[PredictFun GraphQL] Timeout after ${timeoutMs}ms`)
        : err;
    }
  }

  throw lastErr || new Error("[PredictFun GraphQL] Request failed");
}

const MATCH_EVENT_LOG_QUERY = `
  query GetMatchEventLog($filter: MatchEventLogFilterInput, $pagination: ForwardPaginationInput) {
    matchEventLog(filter: $filter, pagination: $pagination) {
      pageInfo {
        hasNextPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          transactionHash
          timestamp
          amountFilled
          priceExecuted
          quoteType
          market {
            id
            title
          }
          outcome {
            id
            index
            name
          }
          account {
            address
            name
            imageUrl
            imageStatus
          }
        }
      }
    }
  }
`;

export async function fetchPredictFunMatchEventLog({ marketId, limit = 60 } = {}) {
  if (!marketId) return null;

  const pageSize = Math.min(200, Math.max(10, Math.round(Number(limit) || 60)));
  const data = await predictFunGraphqlFetch(MATCH_EVENT_LOG_QUERY, {
    filter: {
      marketId: String(marketId),
    },
    pagination: {
      first: pageSize,
    },
  });

  return data?.matchEventLog ?? null;
}

export async function fetchPredictFunMarketHolders({
  marketId,
  limitPerOutcome = 20,
  afterCursor = null,
} = {}) {
  if (!marketId) return [];

  const query = `
    query GetMarketHolders($marketId: ID!, $pagination: ForwardPaginationInput) {
      market(id: $marketId) {
        outcomes {
          edges {
            node {
              id
              index
              name
              positions(pagination: $pagination) {
                totalCount
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    id
                    shares
                    account {
                      address
                      name
                      imageUrl
                      imageStatus
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const pageSize = Math.min(50, Math.max(5, Math.round(Number(limitPerOutcome) || 20)));
  const data = await predictFunGraphqlFetch(query, {
    marketId: String(marketId),
    pagination: {
      first: pageSize,
      ...(afterCursor ? { after: String(afterCursor) } : {}),
    },
  });

  return Array.isArray(data?.market?.outcomes?.edges) ? data.market.outcomes.edges : [];
}

/**
 * Fetch account info (name, imageUrl, statistics) for a wallet address.
 * Uses the direct `account(address)` GraphQL query.
 */
export async function fetchPredictFunAccountInfo(walletAddress) {
  if (!walletAddress) return null;

  const query = `
    query GetAccount($address: Address!) {
      account(address: $address) {
        address
        name
        imageUrl
        imageStatus
        twitterUsername
        statistics {
          pnlUsd
          volumeUsd
          positionsValueUsd
          marketsCount
        }
      }
    }
  `;

  try {
    const data = await predictFunGraphqlFetch(query, {
      address: walletAddress,
    });

    const acc = data?.account;
    if (!acc) return null;

    return {
      address: acc.address || walletAddress,
      name: acc.name || null,
      imageUrl: acc.imageUrl || null,
      imageStatus: acc.imageStatus || null,
      twitterUsername: acc.twitterUsername || null,
      statistics: acc.statistics || null,
    };
  } catch (err) {
    console.warn("[PredictFun] Failed to fetch account info via GraphQL:", err?.message);
    return null;
  }
}

const ACCOUNT_POSITION_FIELDS = `
  id
  shares
  averageBuyPriceUsd
  valueUsd
  pnlUsd
  outcome {
    id
    index
    name
  }
  market {
    id
    title
    question
    imageUrl
    decimalPrecision
    category {
      id
      title
      imageUrl
      endsAt
      startsAt
    }
  }
`;

const ACCOUNT_POSITIONS_QUERY = `
  query GetAccountPositions($address: Address!, $pagination: ForwardPaginationInput) {
    account(address: $address) {
      address
      name
      imageUrl
      imageStatus
      twitterUsername
      statistics {
        pnlUsd
        volumeUsd
        positionsValueUsd
        marketsCount
      }
      positions(pagination: $pagination) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            ${ACCOUNT_POSITION_FIELDS}
          }
        }
      }
    }
  }
`;

const ACCOUNT_MARKET_POSITIONS_QUERY = `
  query GetAccountMarketPositions($address: Address!, $marketId: ID!, $pagination: ForwardPaginationInput) {
    account(address: $address) {
      address
      name
      imageUrl
      imageStatus
      twitterUsername
      statistics {
        pnlUsd
        volumeUsd
        positionsValueUsd
        marketsCount
      }
      positions(filter: { marketId: $marketId }, pagination: $pagination) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            ${ACCOUNT_POSITION_FIELDS}
          }
        }
      }
    }
  }
`;

export async function fetchPredictFunAccountPositions({
  walletAddress,
  marketId = null,
  maxPositions = 200,
  pageSize = 100,
  timeoutMs = 12_000,
  retries = 1,
} = {}) {
  if (!walletAddress) return { account: null, positions: [] };

  const allPositions = [];
  const safePageSize = marketId
    ? Math.min(10, Math.max(2, Math.round(Number(pageSize) || 10)))
    : Math.min(100, Math.max(10, Math.round(Number(pageSize) || 100)));
  const safeMaxPositions = marketId
    ? Math.min(20, Math.max(2, Math.round(Number(maxPositions) || 20)))
    : Math.min(1000, Math.max(20, Math.round(Number(maxPositions) || 200)));

  let cursor = null;
  let account = null;

  for (let page = 0; page < 20; page += 1) {
    const variables = {
      address: String(walletAddress),
      pagination: {
        first: safePageSize,
        ...(cursor ? { after: cursor } : {}),
      },
    };
    if (marketId) variables.marketId = String(marketId);

    const data = await predictFunGraphqlFetch(
      marketId ? ACCOUNT_MARKET_POSITIONS_QUERY : ACCOUNT_POSITIONS_QUERY,
      variables,
      { timeoutMs, retries }
    );

    const accountNode = data?.account || null;
    if (!accountNode) break;

    if (!account) {
      account = {
        address: accountNode.address || walletAddress,
        name: accountNode.name || null,
        imageUrl: accountNode.imageUrl || null,
        imageStatus: accountNode.imageStatus || null,
        twitterUsername: accountNode.twitterUsername || null,
        statistics: accountNode.statistics || null,
      };
    }

    const positions = accountNode?.positions || null;
    const edges = Array.isArray(positions?.edges) ? positions.edges : [];
    if (!edges.length) break;

    allPositions.push(...edges.map((edge) => edge?.node).filter(Boolean));
    if (allPositions.length >= safeMaxPositions) break;
    if (!positions?.pageInfo?.hasNextPage) break;

    cursor = positions?.pageInfo?.endCursor || null;
    if (!cursor) break;
  }

  return {
    account,
    positions: allPositions.slice(0, safeMaxPositions),
  };
}

/**
 * Fetch ALL match events for a market with pagination (up to maxEvents).
 * Returns flat array of edge nodes.
 */
export async function fetchPredictFunAllMatchEvents({ marketId, maxEvents = 500, pageSize = 100 } = {}) {
  if (!marketId) return [];

  const allEdges = [];
  let cursor = null;
  const safePage = Math.min(200, Math.max(20, Math.round(Number(pageSize) || 100)));
  const safeMax = Math.min(5000, Math.max(50, Math.round(Number(maxEvents) || 500)));
  const maxPages = Math.min(50, Math.max(1, Math.ceil(safeMax / safePage) + 1));

  for (let page = 0; page < maxPages; page++) {
    const data = await predictFunGraphqlFetch(MATCH_EVENT_LOG_QUERY, {
      filter: { marketId: String(marketId) },
      pagination: {
        first: safePage,
        ...(cursor ? { after: cursor } : {}),
      },
    });

    const result = data?.matchEventLog;
    const edges = Array.isArray(result?.edges) ? result.edges : [];
    if (!edges.length) break;

    allEdges.push(...edges);
    if (allEdges.length >= safeMax) break;
    if (!result?.pageInfo?.hasNextPage) break;

    cursor = result.pageInfo.endCursor;
    if (!cursor) break;
  }

  return allEdges.slice(0, safeMax);
}
