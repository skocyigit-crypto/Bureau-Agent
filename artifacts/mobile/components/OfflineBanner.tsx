import React, { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiUrl } from "@/lib/api-config";

/**
 * Banniere de connectivite globale (equivalent mobile du `NetworkStatusBanner`
 * web). Le mobile n'avait jusqu'ici qu'un cache passif (`useOfflineCache`):
 * quand le reseau tombait, les ecrans affichaient silencieusement de vieilles
 * donnees sans rien signaler. Cette banniere informe explicitement la
 * secretaire qu'elle est hors-ligne et que les donnees peuvent etre perimees.
 *
 * Implementation volontairement SANS dependance native supplementaire
 * (NetInfo / expo-network): on sonde periodiquement l'endpoint de sante de
 * l'API. Cela fonctionne en Expo Go sans build custom et reste robuste car ce
 * qui compte pour l'app, c'est de pouvoir joindre SON serveur (pas juste
 * d'avoir une interface reseau active).
 *
 * Economie de batterie: la sonde ne tourne que lorsque l'app est au premier
 * plan (pause via AppState), avec un budget de 5s par requete.
 */

const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

async function probeConnectivity(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl("/api/healthz"), {
      method: "GET",
      signal: controller.signal,
      cache: "no-store" as RequestCache,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  // On part du principe que la connexion est OK pour eviter un flash de
  // banniere au demarrage avant la premiere sonde.
  const [isOnline, setIsOnline] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const check = async () => {
      const ok = await probeConnectivity();
      if (mountedRef.current) setIsOnline(ok);
    };

    const startPolling = () => {
      if (intervalRef.current) return;
      void check();
      intervalRef.current = setInterval(() => void check(), POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const handleAppState = (state: AppStateStatus) => {
      if (state === "active") startPolling();
      else stopPolling();
    };

    startPolling();
    const sub = AppState.addEventListener("change", handleAppState);

    return () => {
      mountedRef.current = false;
      stopPolling();
      sub.remove();
    };
  }, []);

  if (isOnline) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { paddingTop: insets.top + 6 }]}
    >
      <View style={styles.banner}>
        <Text style={styles.icon}>⚠</Text>
        <Text style={styles.text}>
          Hors ligne — les donnees affichees peuvent etre perimees
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: "#7c2d12",
    alignItems: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    color: "#fed7aa",
    fontSize: 14,
    fontWeight: "700",
  },
  text: {
    color: "#ffedd5",
    fontSize: 13,
    fontWeight: "600",
  },
});
