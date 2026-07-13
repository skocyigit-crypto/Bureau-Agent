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
          } catch (err) {
            // Cache corrompu: ne pas laisser un etat zombie, purger.
            console.warn(`[useOfflineCache] cache corrompu pour "${cacheKey}", purge:`, err);
            AsyncStorage.removeItem(cacheKey).catch((rmErr) =>
              console.warn(`[useOfflineCache] purge cache "${cacheKey}" echouee:`, rmErr),
            );
          }
        }
      })
      .catch((err) =>
        console.warn(`[useOfflineCache] lecture cache "${cacheKey}" echouee:`, err),
      );
  }, [cacheKey]);

  const updateCache = useCallback(
    (data: T) => {
      setCached(data);
      setIsFromCache(false);
      AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch((err) =>
        console.warn(`[useOfflineCache] ecriture cache "${cacheKey}" echouee:`, err),
      );
    },
    [cacheKey]
  );

  const clearCache = useCallback(() => {
    AsyncStorage.removeItem(cacheKey).catch((err) =>
      console.warn(`[useOfflineCache] suppression cache "${cacheKey}" echouee:`, err),
    );
  }, [cacheKey]);

  return { cached, isFromCache, updateCache, clearCache };
}
