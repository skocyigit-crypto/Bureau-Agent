import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuth, API_BASE } from "@/contexts/AuthContext";

export interface SharedCalendarEvent {
  id: number | string;
  title: string;
  startDate: string;
  endDate: string;
  allDay?: boolean;
  type: string;
  location?: string;
  color?: string;
  status?: string;
  contactName?: string;
}

interface CalendarEventsContextValue {
  todayEvents: SharedCalendarEvent[];
  todayCount: number;
  loading: boolean;
  refresh: () => void;
}

const CalendarEventsContext = createContext<CalendarEventsContextValue>({
  todayEvents: [],
  todayCount: 0,
  loading: false,
  refresh: () => {},
});

export function useCalendarEvents(): CalendarEventsContextValue {
  return useContext(CalendarEventsContext);
}

const POLL_MS = 5 * 60 * 1000;

export function CalendarEventsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, fetchAuth } = useAuth();
  const [todayEvents, setTodayEvents] = useState<SharedCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isFetchingRef = useRef(false);

  const fetchToday = useCallback(async () => {
    if (!isAuthenticated) return;
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
    });

    try {
      setLoading(true);
      const res = await fetchAuth(`${API_BASE}/api/calendar/events?${params}`);
      if (res.ok) {
        const data = await res.json();
        const all: SharedCalendarEvent[] = [
          ...(data.events ?? []),
          ...(data.taskEvents ?? []),
          ...(data.projetEvents ?? []),
        ];
        all.sort(
          (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        );
        setTodayEvents(all);
      }
    } catch {
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [isAuthenticated, fetchAuth]);

  useEffect(() => {
    if (!isAuthenticated) {
      setTodayEvents([]);
      return;
    }

    fetchToday();

    intervalRef.current = setInterval(() => {
      if (AppState.currentState === "active") fetchToday();
    }, POLL_MS);

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === "active" && (prev === "background" || prev === "inactive")) {
        fetchToday();
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, [isAuthenticated, fetchToday]);

  return (
    <CalendarEventsContext.Provider
      value={{
        todayEvents,
        todayCount: todayEvents.length,
        loading,
        refresh: fetchToday,
      }}
    >
      {children}
    </CalendarEventsContext.Provider>
  );
}
