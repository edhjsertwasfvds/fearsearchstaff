import { useEffect, useRef, useState, useCallback } from 'react';

interface WSMessage {
  type: string;
  players?: Record<string, any>;
  total?: number;
  servers?: Record<string, any>;
  time?: number;
}

interface UseWebSocketReturn {
  connected: boolean;
  lastMessage: WSMessage | null;
  reconnect: () => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    try {
      const socket = new WebSocket(url);

      socket.onopen = () => {
        setConnected(true);
        console.log('WS connected');
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
        } catch {
          // ignore parse errors
        }
      };

      socket.onclose = () => {
        setConnected(false);
        console.log('WS disconnected, reconnecting in 3s...');
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        socket.close();
      };

      ws.current = socket;
    } catch {
      reconnectTimer.current = setTimeout(connect, 3000);
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  return { connected, lastMessage, reconnect: connect };
}
