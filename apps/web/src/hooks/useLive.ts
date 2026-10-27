import { useEffect, useState } from "react";
import { serverMessage } from "@ffb/contracts";
import { apiBase, refresh } from "../lib/api.ts";
export function useLive(userId: string | undefined, matchId: string | undefined) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let stopped = false,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined,
      attempt = 0,
      lastRefresh = 0,
      debounce: ReturnType<typeof setTimeout> | undefined;
    const resync = () => {
      if (Date.now() - lastRefresh >= 1000) {
        lastRefresh = Date.now();
        refresh();
      } else if (!debounce)
        debounce = setTimeout(() => {
          debounce = undefined;
          lastRefresh = Date.now();
          refresh();
        }, 1000);
    };
    function connect() {
      const url = new URL("/api/ws", apiBase || window.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        refresh();
        if (matchId)
          socket?.send(JSON.stringify({ v: 1, type: "subscribe", matchId, afterRevision: 0 }));
      };
      socket.onmessage = (e) => {
        try {
          const value = serverMessage.safeParse(JSON.parse(String(e.data)));
          if (value.success && value.data.type === "changed") resync();
        } catch {
          /* Next HTTP snapshot repairs missed updates. */
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped)
          retry = setTimeout(connect, Math.min(15000, 500 * 2 ** attempt++) + Math.random() * 300);
      };
      socket.onerror = () => socket?.close();
    }
    connect();
    const heartbeat = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ v: 1, type: "ping" }));
      refresh();
    }, 15000);
    const visible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      socket?.close();
      clearInterval(heartbeat);
      clearTimeout(retry);
      clearTimeout(debounce);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [userId, matchId]);
  return !!userId && connected;
}
