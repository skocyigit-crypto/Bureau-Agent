import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { purgeLegacyCacheKey, scopedCacheKey } from "@/lib/offline-cache";

/**
 * Cache hors-ligne cloisonne par utilisateur (cf. `@/lib/offline-cache`).
 * Tant qu'aucune session n'est ouverte, rien n'est lu ni ecrit: le cache
 * d'un compte ne peut donc pas s'afficher sous un autre.
 */
export function useOfflineCache<T>(cacheKey: string, initialValue: T) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const storageKey = userId === null ? null : scopedCacheKey(userId, cacheKey);

  const [cached, setCached] = useState<T>(initialValue);
  const [isFromCache, setIsFromCache] = useState(false);

  // `initialValue` est souvent un litteral (`[]`, `null`) recree a chaque
  // rendu: on le fige pour ne pas relancer l'effet en boucle.
  const initialRef = useRef(initialValue);
  const loadedFor = useRef<string | null>(null);

  // Purge unique de l'ancienne cle globale non cloisonnee (appareils
  // installes avant ce correctif).
  useEffect(() => {
    purgeLegacyCacheKey(cacheKey);
  }, [cacheKey]);

  useEffect(() => {
    if (!storageKey) {
      // Deconnexion / changement de compte: on repart de l'etat initial
      // plutot que de laisser en memoire les donnees du compte precedent.
      loadedFor.current = null;
      setCached(initialRef.current);
      setIsFromCache(false);
      return;
    }
    if (loadedFor.current === storageKey) return;
    loadedFor.current = storageKey;

    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          setCached(JSON.parse(raw));
          setIsFromCache(true);
        } catch (err) {
          // Cache corrompu: ne pas laisser un etat zombie, purger.
          console.warn(`[useOfflineCache] cache corrompu pour "${cacheKey}", purge:`, err);
          AsyncStorage.removeItem(storageKey).catch((rmErr) =>
            console.warn(`[useOfflineCache] purge cache "${cacheKey}" echouee:`, rmErr),
          );
        }
      })
      .catch((err) =>
        console.warn(`[useOfflineCache] lecture cache "${cacheKey}" echouee:`, err),
      );
    return () => {
      cancelled = true;
    };
  }, [storageKey, cacheKey]);

  const updateCache = useCallback(
    (data: T) => {
      setCached(data);
      setIsFromCache(false);
      if (!storageKey) return; // pas de session -> rien ne doit persister
      AsyncStorage.setItem(storageKey, JSON.stringify(data)).catch((err) =>
        console.warn(`[useOfflineCache] ecriture cache "${cacheKey}" echouee:`, err),
      );
    },
    [storageKey, cacheKey],
  );

  const clearCache = useCallback(() => {
    if (!storageKey) return;
    AsyncStorage.removeItem(storageKey).catch((err) =>
      console.warn(`[useOfflineCache] suppression cache "${cacheKey}" echouee:`, err),
    );
  }, [storageKey, cacheKey]);

  return { cached, isFromCache, updateCache, clearCache };
}
