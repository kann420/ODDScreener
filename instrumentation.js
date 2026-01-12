import { startSmartMoneyHub } from "@/lib/smartMoneyHub";

export function register() {
  try {
    startSmartMoneyHub();
    console.log("[SmartMoney] hub started on server boot");
  } catch (e) {
    console.log("[SmartMoney] hub boot error", e);
  }
}
