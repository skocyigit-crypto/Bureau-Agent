import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const QUERY_MAP: Record<string, string[][]> = {
  call:      [["calls"], ["dashboard"], ["stats"]],
  task:      [["tasks"], ["dashboard"], ["stats"]],
  contact:   [["contacts"], ["dashboard"]],
  message:   [["messages"], ["dashboard"]],
  checkin:   [["checkins"], ["attendance"]],
  calendar:  [["calendar-events"], ["calendar"]],
  prospect:  [["prospects"]],
  note:      [["notes-internes"]],
  projet:    [["projets"]],
  dashboard: [["dashboard"], ["stats"]],
};

export function useRealtimeSync() {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(`${BASE}/api/sync/events`, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => {
      reconnectDelay.current = 1000;
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as {
          type: string;
          action: string;
          resourceId?: number;
          triggeredBy?: number;
          ts: number;
        };

        if (event.type === "ping") return;

        const keys = QUERY_MAP[event.type] ?? [];
        for (const key of keys) {
          qc.invalidateQueries({ queryKey: key });
        }
      } catch {
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;

      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        connect();
      }, reconnectDelay.current);
    };
  }, [qc]);

  useEffect(() => {
    connect();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !esRef.current) {
        connect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);
}
