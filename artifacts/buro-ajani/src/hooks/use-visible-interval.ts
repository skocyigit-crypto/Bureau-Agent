import { useEffect, useRef } from "react";

/**
 * setInterval qui ne tourne QUE lorsque l'onglet est visible.
 *
 * Pourquoi: chaque requete d'un onglet en arriere-plan maintient une instance
 * Cloud Run eveillee, donc facturee, alors qu'aucun affichage n'a besoin d'etre
 * rafraichi. Un onglet oublie generait ainsi des centaines de requetes par
 * heure pour rien.
 *
 * react-query gere deja ce cas pour ses `refetchInterval`
 * (refetchIntervalInBackground vaut false par defaut). Ce hook couvre les
 * sondages ecrits a la main, qui n'ont pas cette protection.
 *
 * Au retour au premier plan, le callback est rappele immediatement: on ne fait
 * pas attendre l'utilisateur un intervalle complet pour revoir des donnees a
 * jour.
 *
 * @param callback  Appel a effectuer. La derniere reference est toujours
 *                  utilisee, pas besoin de la memoiser.
 * @param intervalMs Periode; `null` desactive le sondage.
 * @param options.runOnMount  Declencher un appel au montage (defaut: true).
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number | null,
  options: { runOnMount?: boolean } = {},
): void {
  const { runOnMount = true } = options;
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (intervalMs === null) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => savedCallback.current(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null; }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        savedCallback.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      if (runOnMount) savedCallback.current();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [intervalMs, runOnMount]);
}
