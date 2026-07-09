import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth, API_BASE } from "@/contexts/AuthContext";

const STORAGE_KEY = "calendar_seen_marker";

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  /**
   * True once AsyncStorage hydration has completed (success or error).
   * The polling effect waits for this before issuing the first fetch so that
   * lastSeenCountRef.current is always restored from storage before the first
   * badge comparison runs — preventing the relaunch flicker.
   */
  const [seenMarkerReady, setSeenMarkerReady] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isFetchingRef = useRef(false);
  /** The event count the user last acknowledged by opening the calendar screen. */
  const lastSeenCountRef = useRef(0);
  /** Mirror of todayEvents.length so clearBadge can read it without stale closures. */
  const currentCountRef = useRef(0);
  const cacheHydratedRef = useRef(false);
  const stalePurgedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      cacheHydratedRef.current = false;
      return;
    }

    if (cacheHydratedRef.current) return;
    cacheHydratedRef.current = true;

    const key = buildCacheKey(user.id);
    const prefix = `calendar-today:${user.id}:`;

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

    if (!stalePurgedRef.current) {
      stalePurgedRef.current = true;
      AsyncStorage.getAllKeys()
        .then((allKeys) => {
          const stale = allKeys.filter(
            (k) => k.startsWith(prefix) && k !== key,
          );
          if (stale.length > 0) {
            AsyncStorage.multiRemove(stale).catch(() => {});
          }
        })
        .catch(() => {});
    }
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
    const count = currentCountRef.current;
    lastSeenCountRef.current = count;
    setBadgeCount(0);
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: todayString(), count }),
    ).catch(() => {});
  }, []);

  // Hydrate lastSeenCountRef from AsyncStorage so the badge doesn't flicker
  // on app restart when the user already opened the calendar today.
  // Marks seenMarkerReady=true (or resets it to false on logout) so the
  // polling effect can gate the first fetch on hydration being complete.
  useEffect(() => {
    if (!isAuthenticated) {
      setSeenMarkerReady(false);
      return;
    }
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const { date, count } = JSON.parse(raw) as { date: string; count: number };
            if (date === todayString() && typeof count === "number") {
              lastSeenCountRef.current = count;
            }
          } catch {
            // Malformed entry — ignore and let the default (0) stand.
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setSeenMarkerReady(true);
      });
  }, [isAuthenticated]);

  // Start polling only after hydration is complete so the first badge comparison
  // always uses the restored lastSeenCountRef value from AsyncStorage.
  useEffect(() => {
    if (!isAuthenticated) {
      setTodayEvents([]);
      setBadgeCount(0);
      lastSeenCountRef.current = 0;
      currentCountRef.current = 0;
      return;
    }
    if (!seenMarkerReady) return;

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
  }, [isAuthenticated, seenMarkerReady, fetchToday]);

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
