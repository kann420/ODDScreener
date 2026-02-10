// lib/accessCodeDb.js
// Turso (libSQL) database for access codes management
// Works both locally and on production with shared database

import { createClient } from "@libsql/client";
import crypto from "crypto";

// Database client singleton
let db = null;
let initialized = false;

function getDb() {
  if (!db) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    
    if (!url) {
      throw new Error("TURSO_DATABASE_URL is not set. Please add it to your environment variables.");
    }
    
    db = createClient({
      url,
      authToken,
    });
  }
  return db;
}

/**
 * Ensure database is initialized (auto-creates table if needed)
 */
async function ensureInit() {
  if (initialized) return;
  
  const db = getDb();
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS access_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      duration_hours INTEGER NOT NULL,
      device_id TEXT,
      activated_at INTEGER,
      expires_at INTEGER,
      is_revoked INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      note TEXT
    )
  `);
  
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_code ON access_codes(code)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_device ON access_codes(device_id)`);
  
  initialized = true;
  console.log("[AccessCodeDb] Turso table initialized");
}

/**
 * Initialize database tables (call once on startup) - kept for compatibility
 */
export async function initAccessCodeDb() {
  await ensureInit();
}

/**
 * Parse and validate code format
 */
function parseCode(code) {
  if (!code || typeof code !== "string") return null;
  
  const normalized = code.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
  
  if (normalized.length !== 8) return null;
  if (!/^[A-Z0-9]+$/.test(normalized)) return null;
  
  return { code: normalized };
}

/**
 * Generate a new access code
 * @param {number} durationHours - 24, 48, 72, etc.
 * @param {string} note - Optional note for tracking
 * @returns {Promise<string>} - Generated code like "ABCD1234"
 */
export async function generateAccessCode(durationHours = 24, note = "") {
  await ensureInit();
  
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const randomBytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[randomBytes[i] % chars.length];
  }
  
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO access_codes (code, duration_hours, created_at, note) VALUES (?, ?, ?, ?)`,
    args: [code, durationHours, Date.now(), note || null],
  });
  
  return code;
}

/**
 * Generate multiple access codes
 */
export async function generateMultipleCodes(count, durationHours = 24, note = "") {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = await generateAccessCode(durationHours, note);
    codes.push(code);
  }
  return codes;
}

/**
 * Validate and activate an access code for a device
 */
export async function validateAndActivateCode(code, deviceId) {
  await ensureInit();
  
  if (!code || !deviceId) {
    return { valid: false, error: "Missing code or device ID" };
  }
  
  const parsed = parseCode(code);
  if (!parsed) {
    return { valid: false, error: "Invalid code format" };
  }
  
  const db = getDb();
  const normalizedCode = code.toUpperCase().trim();
  
  const result = await db.execute({
    sql: `SELECT * FROM access_codes WHERE code = ?`,
    args: [normalizedCode],
  });
  
  const codeRecord = result.rows[0];
  
  if (!codeRecord) {
    return { valid: false, error: "Code not found" };
  }
  
  if (codeRecord.is_revoked) {
    return { valid: false, error: "Code has been revoked" };
  }
  
  if (codeRecord.device_id && codeRecord.device_id !== deviceId) {
    return { valid: false, error: "Code already used on another device" };
  }
  
  if (codeRecord.expires_at && Date.now() > codeRecord.expires_at) {
    return { valid: false, error: "Code has expired" };
  }
  
  if (codeRecord.device_id === deviceId && codeRecord.expires_at) {
    return { 
      valid: true, 
      expiresAt: codeRecord.expires_at,
      alreadyActivated: true,
    };
  }
  
  const now = Date.now();
  const expiresAt = now + (codeRecord.duration_hours * 60 * 60 * 1000);
  
  await db.execute({
    sql: `UPDATE access_codes SET device_id = ?, activated_at = ?, expires_at = ? WHERE code = ?`,
    args: [deviceId, now, expiresAt, normalizedCode],
  });
  
  return { 
    valid: true, 
    expiresAt,
    newlyActivated: true,
  };
}

/**
 * Check if a device has valid access
 */
export async function checkDeviceAccess(deviceId) {
  await ensureInit();
  
  if (!deviceId) {
    return { hasAccess: false };
  }
  
  const db = getDb();
  const now = Date.now();
  
  const result = await db.execute({
    sql: `SELECT * FROM access_codes 
          WHERE device_id = ? AND is_revoked = 0 AND expires_at > ?
          ORDER BY expires_at DESC LIMIT 1`,
    args: [deviceId, now],
  });
  
  const record = result.rows[0];
  
  if (!record) {
    return { hasAccess: false };
  }
  
  return {
    hasAccess: true,
    expiresAt: record.expires_at,
    // SECURITY: never send the actual code to the client
  };
}

/**
 * Revoke an access code
 */
export async function revokeCode(code) {
  await ensureInit();
  
  const db = getDb();
  const result = await db.execute({
    sql: `UPDATE access_codes SET is_revoked = 1 WHERE code = ?`,
    args: [code.toUpperCase().trim()],
  });
  
  return result.rowsAffected > 0;
}

/**
 * List all access codes (for admin)
 */
export async function listAllCodes({ limit = 100, offset = 0, includeExpired = true } = {}) {
  await ensureInit();
  
  const db = getDb();
  const now = Date.now();
  
  let sql = `SELECT * FROM access_codes`;
  const args = [];
  
  if (!includeExpired) {
    sql += ` WHERE (expires_at IS NULL OR expires_at > ?) AND is_revoked = 0`;
    args.push(now);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  args.push(limit, offset);
  
  const result = await db.execute({ sql, args });
  return result.rows;
}

/**
 * Get code statistics
 */
export async function getCodeStats() {
  await ensureInit();
  
  const db = getDb();
  const now = Date.now();
  
  const [totalRes, usedRes, activeRes, revokedRes, unusedRes] = await Promise.all([
    db.execute(`SELECT COUNT(*) as count FROM access_codes`),
    db.execute(`SELECT COUNT(*) as count FROM access_codes WHERE device_id IS NOT NULL`),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM access_codes WHERE device_id IS NOT NULL AND expires_at > ? AND is_revoked = 0`,
      args: [now],
    }),
    db.execute(`SELECT COUNT(*) as count FROM access_codes WHERE is_revoked = 1`),
    db.execute(`SELECT COUNT(*) as count FROM access_codes WHERE device_id IS NULL AND is_revoked = 0`),
  ]);
  
  return {
    total: Number(totalRes.rows[0].count),
    used: Number(usedRes.rows[0].count),
    active: Number(activeRes.rows[0].count),
    revoked: Number(revokedRes.rows[0].count),
    unused: Number(unusedRes.rows[0].count),
  };
}
