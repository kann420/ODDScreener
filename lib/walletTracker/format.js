/**
 * Wallet Tracker Formatting Utilities
 * 
 * Helper functions for formatting prices, currencies, dates, and wallet addresses.
 */

// Opinion Leaderboard Top Whales - embedded for build compatibility
// To update: edit this object and public/opinionWhales.json
const opinionWhales = {
  whales: {
    "0x34d8619e909aa917cd176b733a5bfbafcdc0483e": "beoakd",
    "0x0edf1a0759ced1b9a09413ff774404c56e296d53": "reikd",
    "0x9f5948c84d2567bd5ff9127ac14898334e66d002": "Big_Winner",
    "0x8a3d9b06ab28daddbae7f51c1f1d83bd9c1bd7a2": "chealce",
    "0x578608c2be0004e501016a13ced75b35e33466b0": "HNB",
    "0x06a881c591e1cad6651b97d0e06b6ab4b4ca52ba": "jax",
    "0x91a75b2554de4c70c393025a411a4064276303f4": "mmmmmmm",
    "0xe44d4bb0a00b54ca6c7d8066aa04727842666666": "zong",
    "0x4bf5e3d097ff2ec2bd082166042cfedb49b00000": "세계",
    "0x98e8ffae7df736663a955e2b4b4e5f020042230d": "lo",
    "0x64a21f59af6f5592bd03a0b240592dd5aaec7517": "Bishop",
    "0x8bebef60dddfaaa451a5867f704ecb431ad8c77a": "User_d8c77a",
    "0x8604ce9941d4f1ae20fe02e0d004ceca41393e0f": "fight",
    "0xacdee9bf6a824632b01e94fddbd98fac50d7d546": "ak88",
    "0x82bba64fc3a7f87f3d3e639de7b044c644921064": "User_921064"
  }
};

/**
 * Get whale info from wallet address
 * @param {string} address - Wallet address
 * @returns {{ name: string, topPnl: boolean, avatar: string|null } | null} - Whale info or null if not a whale
 */
export function getWhaleInfo(address) {
  if (!address || typeof address !== 'string') return null;
  const normalized = address.toLowerCase();
  const whales = opinionWhales?.whales || {};
  
  // Check each key case-insensitively
  for (const [addr, value] of Object.entries(whales)) {
    if (addr.toLowerCase() === normalized) {
      // Support both string format and object format
      if (typeof value === 'string') {
        return { name: value, topPnl: false, avatar: null };
      }
      return { 
        name: value.name, 
        topPnl: !!value.topPnl,
        avatar: value.avatar ? `/leaderboard/${value.avatar}` : null
      };
    }
  }
  return null;
}

/**
 * Get whale display name from wallet address
 * @param {string} address - Wallet address
 * @returns {string|null} - Display name or null if not a whale
 */
export function getWhaleName(address) {
  const info = getWhaleInfo(address);
  return info ? info.name : null;
}

/**
 * Get display name for wallet - returns whale name or shortened address
 * @param {string} address - Wallet address  
 * @param {number} startChars - Characters to show at start (default 6)
 * @param {number} endChars - Characters to show at end (default 4)
 * @returns {string} - Whale name or shortened address
 */
export function getDisplayName(address, startChars = 6, endChars = 4) {
  const whaleName = getWhaleName(address);
  if (whaleName) return whaleName;
  return shortenAddress(address, startChars, endChars);
}

/**
 * Safely convert value to number
 * @param {*} v - Value to convert
 * @returns {number} - Number or 0 if invalid
 */
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format price (0-1 scale) as cents display
 * e.g., 0.88 => "88¢", 0.07 => "7¢"
 * @param {number} price - Price in 0-1 scale
 * @returns {string} - Formatted cents string
 */
export function formatCents(price) {
  const p = num(price);
  
  // Detect if price is already in cents (>1.5 suggests it's already cents)
  const inCents = p > 1.5 ? p : p * 100;
  
  // Round to 1 decimal, remove trailing .0
  const formatted = inCents.toFixed(1).replace(/\.0$/, '');
  return `${formatted}¢`;
}

/**
 * Format price as percentage
 * e.g., 0.88 => "88%"
 * @param {number} price - Price in 0-1 scale
 * @returns {string} - Formatted percentage string
 */
export function formatPercent(price) {
  const p = num(price);
  const pct = Math.max(0, Math.min(100, p * 100));
  const formatted = pct.toFixed(1).replace(/\.0$/, '');
  return `${formatted}%`;
}

/**
 * Format USD currency
 * @param {number} value - Value in USD
 * @param {number} decimals - Decimal places (default 2)
 * @returns {string} - Formatted USD string (e.g., "$123.45")
 */
export function formatUSD(value, decimals = 2) {
  const n = num(value);
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format USD with sign (+ or -)
 * @param {number} value - Value in USD
 * @param {number} decimals - Decimal places
 * @returns {string} - Formatted string with explicit sign
 */
export function formatUSDSigned(value, decimals = 2) {
  const n = num(value);
  const formatted = Math.abs(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}

/**
 * Format percentage with sign
 * @param {number} value - Percentage value (e.g., 5.42 for 5.42%)
 * @returns {string} - Formatted percentage with sign
 */
export function formatPercentSigned(value) {
  const n = num(value);
  const formatted = Math.abs(n).toFixed(2);
  
  if (n > 0) return `+${formatted}%`;
  if (n < 0) return `-${formatted}%`;
  return `${formatted}%`;
}

/**
 * Format relative time (time ago)
 * @param {string|Date} date - Date to format
 * @returns {string} - Relative time string (e.g., "5 minutes ago")
 */
export function timeAgo(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  
  if (isNaN(diffMs)) return 'Unknown';
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  
  if (seconds < 60) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  if (weeks === 1) return '1 week ago';
  if (weeks < 4) return `${weeks} weeks ago`;
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  
  return then.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

/**
 * Format date for display
 * @param {string|Date} date - Date to format
 * @returns {string} - Formatted date string
 */
export function formatDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Unknown';
  
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Shorten wallet address for display
 * e.g., "0x1234567890abcdef..." => "0x1234…cdef"
 * @param {string} address - Full wallet address
 * @param {number} startChars - Characters to show at start (default 6)
 * @param {number} endChars - Characters to show at end (default 4)
 * @returns {string} - Shortened address
 */
export function shortenAddress(address, startChars = 6, endChars = 4) {
  if (!address || typeof address !== 'string') return '';
  if (address.length <= startChars + endChars + 3) return address;
  
  return `${address.slice(0, startChars)}…${address.slice(-endChars)}`;
}

/**
 * Validate wallet address format (basic check)
 * @param {string} address - Address to validate
 * @returns {boolean} - True if valid format
 */
export function isValidWalletAddress(address) {
  if (!address || typeof address !== 'string') return false;
  // Basic Ethereum/BSC address check: 0x followed by 40 hex characters
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Format shares count
 * @param {number} shares - Number of shares
 * @returns {string} - Formatted shares (e.g., "100.0 shares")
 */
export function formatShares(shares) {
  const n = num(shares);
  return `${n.toFixed(1)} shares`;
}

/**
 * Get BSCScan URL for transaction
 * @param {string} txHash - Transaction hash
 * @param {number} chainId - Chain ID (56 for BSC mainnet)
 * @returns {string} - Explorer URL
 */
export function getExplorerTxUrl(txHash, chainId = 56) {
  if (!txHash) return '';
  
  // BSC Mainnet
  if (chainId === 56) {
    return `https://bscscan.com/tx/${txHash}`;
  }
  // BSC Testnet
  if (chainId === 97) {
    return `https://testnet.bscscan.com/tx/${txHash}`;
  }
  // Default to BSC mainnet
  return `https://bscscan.com/tx/${txHash}`;
}

/**
 * Get BSCScan URL for wallet address
 * @param {string} address - Wallet address
 * @param {number} chainId - Chain ID
 * @returns {string} - Explorer URL
 */
export function getExplorerAddressUrl(address, chainId = 56) {
  if (!address) return '';
  
  if (chainId === 56) {
    return `https://bscscan.com/address/${address}`;
  }
  if (chainId === 97) {
    return `https://testnet.bscscan.com/address/${address}`;
  }
  return `https://bscscan.com/address/${address}`;
}

/**
 * Determine PnL color class
 * @param {number} pnl - PnL value
 * @returns {string} - CSS class name
 */
export function getPnlColorClass(pnl) {
  const n = num(pnl);
  if (n > 0) return 'text-green';
  if (n < 0) return 'text-red';
  return 'text-muted';
}

/**
 * Format compact number (K, M, B)
 * @param {number} value - Number to format
 * @returns {string} - Compact string
 */
export function formatCompact(value) {
  const n = num(value);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}
