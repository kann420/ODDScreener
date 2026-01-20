#!/usr/bin/env bash
set -e

# 1) BASE_URL trỏ về chính web service (localhost) để collector gọi /api/opinion/markets
export BASE_URL="http://127.0.0.1:${PORT}"

# 2) Start collector *sau vài giây* để Next server kịp lên (tránh fetch fail rồi đợi 1h)
(sleep 8; node scripts/recentTradesCollector.js) &

# 3) Start Next app (foreground)
exec npm start
