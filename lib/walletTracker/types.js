/**
 * Wallet Tracker Types (JSDoc)
 * 
 * Type definitions for Opinion OpenAPI wallet endpoints.
 * These are used for documentation and IDE IntelliSense support.
 */

/**
 * @typedef {Object} Position
 * @property {string} marketId - Unique market identifier
 * @property {string} marketTitle - Market title/question
 * @property {string} marketStatus - Status string (e.g., "active", "resolved")
 * @property {number} statusEnum - Status as enum value
 * @property {string} outcome - Outcome name (e.g., "Yes", "No")
 * @property {string} outcomeSide - Side string (e.g., "YES", "NO")
 * @property {number} outcomeSideEnum - Side as enum (0=No, 1=Yes typically)
 * @property {number} sharesOwned - Total shares owned
 * @property {number} sharesFrozen - Shares currently frozen/locked
 * @property {number} unrealizedPnl - Unrealized profit/loss in quote token
 * @property {number} unrealizedPnlPercent - Unrealized PnL as percentage
 * @property {number} dailyPnlChange - Daily PnL change amount
 * @property {number} dailyPnlChangePercent - Daily PnL change percentage
 * @property {number} avgEntryPrice - Average entry price (0-1 scale)
 * @property {number} currentValueInQuoteToken - Current position value in quote token (e.g., USDC)
 * @property {string} conditionId - Condition ID for the market
 * @property {string} tokenId - Token ID for this outcome
 * @property {string} claimStatus - Claim status string
 * @property {number} claimStatusEnum - Claim status enum
 * @property {string} quoteToken - Quote token address
 * @property {string} [marketIcon] - Optional market icon URL
 */

/**
 * @typedef {Object} Trade
 * @property {string} txHash - Transaction hash on blockchain
 * @property {string} marketId - Market identifier
 * @property {string} marketTitle - Market title/question
 * @property {'BUY'|'SELL'} side - Trade side (BUY or SELL)
 * @property {string} outcome - Outcome name
 * @property {string} outcomeSide - Outcome side string
 * @property {number} outcomeSideEnum - Outcome side enum
 * @property {number} price - Trade price (0-1 scale)
 * @property {number} shares - Number of shares traded
 * @property {number} amount - Total amount in quote token
 * @property {number} fee - Fee paid
 * @property {number} profit - Realized profit (if applicable)
 * @property {string} quoteToken - Quote token address
 * @property {number} quoteTokenUsdPrice - Quote token USD price at time of trade
 * @property {number} usdAmount - Trade amount in USD
 * @property {string} status - Trade status string
 * @property {number} statusEnum - Trade status enum
 * @property {number} chainId - Blockchain chain ID
 * @property {string} createdAt - ISO timestamp of trade creation
 * @property {string} [marketIcon] - Optional market icon URL
 */

/**
 * @typedef {Object} ClosedPosition
 * @property {string} marketId - Market identifier
 * @property {string} marketTitle - Market title/question
 * @property {string} outcomeSide - Outcome side (YES/NO)
 * @property {'won'|'lost'|'unknown'} result - Position result if market resolved
 * @property {number} totalBet - Total amount invested
 * @property {number} totalShares - Total shares bought
 * @property {number} avgPrice - Average entry price
 * @property {number} closedPnl - Realized profit/loss
 * @property {number} closedPnlPercent - PnL as percentage
 * @property {string} closedAt - ISO timestamp when position was closed
 * @property {Trade[]} trades - All trades for this position
 * @property {string} [marketIcon] - Optional market icon URL
 */

/**
 * @typedef {Object} WalletStats
 * @property {number} positionsValue - Total value of active positions
 * @property {number} biggestWin - Largest single win amount
 * @property {number} predictionsCount - Number of unique market predictions
 * @property {number} totalPnl - Total realized PnL
 * @property {number} winRate - Win rate percentage
 */

/**
 * @typedef {Object} APIResponse
 * @property {number} code - Response code (0 = success)
 * @property {string} msg - Response message
 * @property {Object} result - Result payload
 * @property {number} result.total - Total count
 * @property {Array} result.list - List of items
 */

export default {};
