"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const MAX_TRADES = 500; // Keep last 500 trades for scrolling

/**
 * Custom hook to subscribe to real-time market trades via SSE
 * Uses server-side proxy to keep API key secure
 * @param {string|number} marketId - The market ID to subscribe to
 * @returns {{ trades: Array, connected: boolean, error: string|null }}
 */
export default function useMarketTrades(marketId) {
  const [trades, setTrades] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    if (!marketId) {
      return;
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      // Connect to SSE endpoint - API key stays on server
      const sseUrl = `/api/opinion/token/trades/stream?marketId=${marketId}`;
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log("[SSE] Connected to trades stream for market", marketId);
        setConnected(true);
        setError(null);
        reconnectAttempts.current = 0;
      };

      // Handle initial snapshot
      eventSource.addEventListener("snapshot", (event) => {
        try {
          const snapshot = JSON.parse(event.data);
          if (Array.isArray(snapshot)) {
            setTrades(snapshot.slice(0, MAX_TRADES));
            console.log("[SSE] Received snapshot with", snapshot.length, "trades");
          }
        } catch (e) {
          console.warn("[SSE] Failed to parse snapshot:", e);
        }
      });

      // Handle new trades
      eventSource.addEventListener("trade", (event) => {
        try {
          const trade = JSON.parse(event.data);
          setTrades(prev => {
            const newTrades = [trade, ...prev];
            return newTrades.slice(0, MAX_TRADES);
          });
        } catch (e) {
          console.warn("[SSE] Failed to parse trade:", e);
        }
      });

      eventSource.onerror = (event) => {
        console.error("[SSE] Connection error:", event);
        setConnected(false);
        
        // EventSource will auto-reconnect, but we track attempts
        if (eventSource.readyState === EventSource.CLOSED) {
          setError("Connection lost");
          
          // Attempt manual reconnection with backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            reconnectAttempts.current++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
            console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, delay);
          }
        }
      };

    } catch (e) {
      console.error("[SSE] Failed to create EventSource:", e);
      setError("Failed to connect to trades stream");
    }
  }, [marketId]);

  const disconnect = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setConnected(false);
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (marketId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [marketId, connect, disconnect]);

  // Clear trades when marketId changes
  useEffect(() => {
    setTrades([]);
  }, [marketId]);

  return { trades, connected, error };
}
