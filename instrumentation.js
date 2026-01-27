import { startSmartMoneyHub } from "@/lib/smartMoneyHub";
import { initAccessCodeDb } from "@/lib/accessCodeDb";

export async function register() {
  try {
    startSmartMoneyHub();
    console.log("[SmartMoney] hub started on server boot");
  } catch (e) {
    console.log("[SmartMoney] hub boot error", e);
  }
  
  // Initialize Turso access code database
  try {
    await initAccessCodeDb();
    console.log("[AccessCode] Turso database initialized");
  } catch (e) {
    console.log("[AccessCode] Turso init error:", e.message);
  }
}
