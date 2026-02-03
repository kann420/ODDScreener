// Quick test script to verify whitelist matching logic

const MANUAL_MATCH_WHITELIST = [
  // ===== CRYPTO / FDV MARKETS =====
  { opinionPattern: /standx fdv/i, polyPattern: /standx fdv/i },
  { opinionPattern: /standx/i, polyPattern: /standx/i },
  { opinionPattern: /nansen.*token/i, polyPattern: /nansen.*token/i },
  { opinionPattern: /megaeth/i, polyPattern: /megaeth/i },
  { opinionPattern: /fabric.*public.*sale/i, polyPattern: /fabric.*public.*sale/i },
  { opinionPattern: /fabric/i, polyPattern: /fabric/i },
  { opinionPattern: /microstrategy.*bitcoin/i, polyPattern: /microstrategy.*bitcoin/i },
  
  // ===== BUSINESS / COMPANIES =====
  { opinionPattern: /largest company/i, polyPattern: /largest company/i },
  
  // ===== AI RANKINGS =====
  { opinionPattern: /best ai model/i, polyPattern: /best ai model/i },
  
  // ===== COMMODITIES =====
  { opinionPattern: /silver.*hit/i, polyPattern: /silver.*hit/i },
  { opinionPattern: /silver/i, polyPattern: /silver/i },
  { opinionPattern: /gold.*hit/i, polyPattern: /gold.*hit/i },
  { opinionPattern: /gold/i, polyPattern: /gold/i },
  
  // Companies acquired
  { opinionPattern: /companies.*acquired/i, polyPattern: /companies.*acquired/i },
  { opinionPattern: /acquired/i, polyPattern: /acquired/i },
];

function isWhitelistedMarket(title) {
  if (!title) return false;
  const norm = title.toLowerCase();
  
  for (const rule of MANUAL_MATCH_WHITELIST) {
    const matchesOpinionPattern = rule.opinionPattern instanceof RegExp 
      ? rule.opinionPattern.test(norm)
      : norm.includes(rule.opinionPattern.toLowerCase());
    
    if (matchesOpinionPattern) return true;
  }
  return false;
}

// Test market titles from Opinion API
const testTitles = [
  "StandX FDV above ... one day after launch?",
  "Will Nansen launch a token by ...?",
  "MegaETH market cap (FDV) one day after launch?",
  "Fabric public sale total commitments?",
  "Will Silver hit ... by end of February?",
  "What will Gold hit ... by end of February?",
  "Which companies will be acquired before 2027?",
  "Which company has the best AI model end of March?",
  "Largest Company end of 2026?",
  "What price will Gold hit by end of January?",
  // Some that should NOT match (negative tests)
  "Bitcoin above ... on December 17?(By 12:00 ET)",
  "NFC Champion 2026",
];

console.log("=== Testing whitelist matching ===\n");
for (const title of testTitles) {
  const match = isWhitelistedMarket(title);
  console.log(`${match ? "✓" : "✗"} "${title}" => ${match ? "WHITELISTED" : "NOT matched"}`);
}
