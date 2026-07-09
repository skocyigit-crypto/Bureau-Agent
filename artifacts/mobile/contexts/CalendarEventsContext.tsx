import AsyncStorage from "@react-native-async-storage/async-storage";
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
  /** Badge count — 0 once the user has opened the calendar screen; resets when new events appear. */
  badgeCount: number;
  loading: boolean;
  refresh: () => void;
  /** Call when the user opens the calendar screen to clear the home-tab badge. */
  clearBadge: () => void;
}

const CalendarEventsContext = createContext<CalendarEventsContextValue>({
  todayEvents: [],
  todayCount: 0,
  badgeCount: 0,
  loading: false,
  refresh: () => {},
  clearBadge: () => {},
});

export function useCalendarEvents(): CalendarEventsContextValue {
  return useContext(CalendarEventsContext);
}

const POLL_MS = 5 * 60 * 1000;

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildCacheKey(userId: number | string): string {
  return `calendar-today:${userId}:${todayDateString()}`;
}

export function CalendarEventsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, fetchAuth, user } = useAuth();
  const [todayEvents, setTodayEvents] = useState<SharedCalendarEvent[]>([]);
  const [badgeCount, setBadgeCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isFetchingRef = useRef(false);
  /** The event count the user last acknowledged by opening the calendar screen. */
  const lastSeenCountRef = useRef(0);
  /** Mirror of todayEvents.length so clearBadge can read it without stale closures. */
  const currentCountRef = useRef(0);
  const cacheHydratedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      cacheHydratedRef.current = false;
      return;
    }

    if (cacheHydratedRef.current) return;
    cacheHydratedRef.current = true;

    const key = buildCacheKey(user.id);
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (raw) {
          try {
            const cached = JSON.parse(raw) as SharedCalendarEvent[];
            setTodayEvents(cached);
          } catch {
            AsyncStorage.removeItem(key).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [isAuthenticated, user]);

  const fetchToday = useCallback(async () => {
    if (!isAuthenticated || !user) return;
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
        currentCountRef.current = all.length;
        // Show badge only when the fetched count exceeds what the user last saw.
        if (all.length > lastSeenCountRef.current) {
          setBadgeCount(all.length);
        }

        const key = buildCacheKey(user.id);
        AsyncStorage.setItem(key, JSON.stringify(all)).catch(() => {});
      }
    } catch {
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [isAuthenticated, fetchAuth, user]);

  const clearBadge = useCallback(() => {
    lastSeenCountRef.current = currentCountRef.current;
    setBadgeCount(0);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setTodayEvents([]);
      setBadgeCount(0);
      lastSeenCountRef.current = 0;
      currentCountRef.current = 0;
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
        badgeCount,
        loading,
        refresh: fetchToday,
        clearBadge,
      }}
    >
      {children}
    </CalendarEventsContext.Provider>
  );
}
