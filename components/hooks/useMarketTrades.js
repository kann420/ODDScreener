"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const HEARTBEAT_INTERVAL = 25000; // 25 seconds
const MAX_TRADES = 500; // Keep last 500 trades for scrolling

/**
 * Custom hook to subscribe to real-time market trades via WebSocket
 * @param {string|number} marketId - The market ID to subscribe to
 * @returns {{ trades: Array, connected: boolean, error: string|null }}
 */
export default function useMarketTrades(marketId) {
  const [trades, setTrades] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [wsUrl, setWsUrl] = useState(null);
  
  const wsRef = useRef(null);
  const heartbeatRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Fetch WebSocket URL from server
  useEffect(() => {
    async function fetchWsConfig() {
      try {
        const res = await fetch("/api/opinion/ws-config");
        const data = await res.json();
        if (data.wsUrl) {
          setWsUrl(data.wsUrl);
        } else {
          setError("Failed to get WebSocket config");
        }
      } catch (e) {
        console.error("[WS] Failed to fetch WS config:", e);
        setError("Failed to fetch WebSocket configuration");
      }
    }
    fetchWsConfig();
  }, []);

  const connect = useCallback(() => {
    if (!marketId || !wsUrl) {
      return;
    }

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] Connected to Opinion WebSocket");
        setConnected(true);
        setError(null);
        reconnectAttempts.current = 0;

        // Subscribe to market.last.trade channel
        const subscribeMsg = JSON.stringify({
          action: "SUBSCRIBE",
          channel: "market.last.trade",
          marketId: Number(marketId)
        });
        ws.send(subscribeMsg);
        console.log("[WS] Subscribed to market.last.trade for market", marketId);

        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: "HEARTBEAT" }));
          }
        }, HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle trade messages
          if (data.msgType === "market.last.trade") {
            const trade = {
              id: `${data.tokenId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              tokenId: data.tokenId,
              side: data.side, // "Buy" or "Sell"
              outcomeSide: data.outcomeSide, // 1 = YES, 2 = NO
              price: parseFloat(data.price),
              shares: parseFloat(data.shares),
              amount: parseFloat(data.amount),
              marketId: data.marketId,
              timestamp: Date.now()
            };

            setTrades(prev => {
              const newTrades = [trade, ...prev];
              // Keep only the last MAX_TRADES
              return newTrades.slice(0, MAX_TRADES);
            });
          }
        } catch (e) {
          console.warn("[WS] Failed to parse message:", e);
        }
      };

      ws.onerror = (event) => {
        console.error("[WS] WebSocket error:", event);
        setError("WebSocket connection error");
      };

      ws.onclose = (event) => {
        console.log("[WS] Connection closed:", event.code, event.reason);
        setConnected(false);
        
        // Clear heartbeat
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        // Attempt reconnection if not intentionally closed
        if (event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

    } catch (e) {
      console.error("[WS] Failed to create WebSocket:", e);
      setError("Failed to connect to WebSocket");
    }
  }, [marketId, wsUrl]);

  const disconnect = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clear heartbeat
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      // Unsubscribe first
      if (wsRef.current.readyState === WebSocket.OPEN && marketId) {
        wsRef.current.send(JSON.stringify({
          action: "UNSUBSCRIBE",
          channel: "market.last.trade",
          marketId: Number(marketId)
        }));
      }
      wsRef.current.close(1000, "Component unmounted");
      wsRef.current = null;
    }

    setConnected(false);
  }, [marketId]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (marketId && wsUrl) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [marketId, wsUrl, connect, disconnect]);

  // Clear trades when marketId changes
  useEffect(() => {
    setTrades([]);
  }, [marketId]);

  return { trades, connected, error };
}
