import { useEffect, useState } from "react";

/**
 * Retourne une version "retardée" de `value` qui ne se met à jour qu'après
 * `delay` millisecondes sans changement. Utile pour éviter de déclencher une
 * requête (ou un filtre coûteux) à chaque frappe dans un champ de recherche.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
