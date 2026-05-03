import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

export function useOfflineCache<T>(cacheKey: string, initialValue: T) {
  const [cached, setCached] = useState<T>(initialValue);
  const [isFromCache, setIsFromCache] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (raw) {
          try {
            setCached(JSON.parse(raw));
            setIsFromCache(true);
          } catch {}
        }
      })
      .catch(() => {});
  }, [cacheKey]);

  const updateCache = useCallback(
    (data: T) => {
      setCached(data);
      setIsFromCache(false);
      AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
    },
    [cacheKey]
  );

  const clearCache = useCallback(() => {
    AsyncStorage.removeItem(cacheKey).catch(() => {});
  }, [cacheKey]);

  return { cached, isFromCache, updateCache, clearCache };
}
