/**
 * LocationConsentGate — KVKK aydınlatması + izin sıralaması.
 *
 * Login olunca devreye girer. İki durumda blocking ekran gösterir:
 *  1. KVKK metni henüz kabul edilmemiş -> aydınlatma + tek "Kabul ediyorum"
 *     butonu. Kabul olmadan uygulamaya girilmez (patronun açık talebi).
 *  2. KVKK kabul edildi ama OS izni verilmedi -> "İzin ver" butonu, yeniden
 *     OS diyalogu açar; reddedilirse Ayarlar'a yönlendirme metni.
 *
 * İkisi de tamamsa children render edilir. Web'de hiç engellemez (mobil-only).
 */

import { useAuth } from "@/contexts/AuthContext";
import { useLocationTracking } from "@/contexts/LocationContext";
import React, { useEffect, useState } from "react";
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function LocationConsentGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { kvkkAcknowledged, acknowledgeKvkk, permission, requestPermission } =
    useLocationTracking();
  const [requesting, setRequesting] = useState(false);

  // Web ve henüz login olmamış kullanıcı için gate yok.
  if (Platform.OS === "web" || !isAuthenticated) return <>{children}</>;

  // İzin verilmiş + kabul edilmişse -> uygulamaya geç.
  if (kvkkAcknowledged && permission === "granted") return <>{children}</>;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!kvkkAcknowledged ? (
          <KvkkScreen onAccept={acknowledgeKvkk} />
        ) : (
          <PermissionScreen
            permission={permission}
            requesting={requesting}
            onRequest={async () => {
              setRequesting(true);
              try {
                await requestPermission();
              } finally {
                setRequesting(false);
              }
            }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KvkkScreen({ onAccept }: { onAccept: () => Promise<void> }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Suivi de presence — Information KVKK / RGPD</Text>
      <Text style={styles.paragraph}>
        Pour fonctionner, l&apos;application Agent de Bureau collecte en
        permanence votre position approximative pendant que vous etes
        connecte(e), y compris en arriere-plan.
      </Text>
      <Text style={styles.sectionHeading}>Ce qui est collecte</Text>
      <Text style={styles.bullet}>
        - Latitude / longitude transmises au serveur de votre employeur.
      </Text>
      <Text style={styles.bullet}>
        - Date/heure et niveau de batterie (optionnel) au moment de la mesure.
      </Text>
      <Text style={styles.sectionHeading}>Ce qui est visible par votre employeur</Text>
      <Text style={styles.bullet}>
        - Uniquement la zone (geofence) ou vous vous trouvez et l&apos;heure
          du dernier passage. La position GPS exacte n&apos;est PAS affichee.
      </Text>
      <Text style={styles.sectionHeading}>Duree de conservation</Text>
      <Text style={styles.bullet}>
        - Les evenements d&apos;entree/sortie sont conserves 30 jours, puis
          automatiquement supprimes.
      </Text>
      <Text style={styles.sectionHeading}>Vos droits</Text>
      <Text style={styles.bullet}>
        - Vous pouvez a tout moment demander a votre employeur l&apos;acces, la
          rectification ou la suppression de vos donnees, conformement au RGPD
          (UE) et a la loi KVKK n. 6698 (Turquie).
      </Text>
      <Text style={[styles.paragraph, styles.warning]}>
        Le suivi est une condition d&apos;utilisation de l&apos;application
        professionnelle. Refuser le suivi vous empechera d&apos;acceder aux
        ecrans de l&apos;application.
      </Text>
      <TouchableOpacity style={styles.primaryButton} onPress={onAccept}>
        <Text style={styles.primaryButtonText}>J&apos;ai lu et j&apos;accepte</Text>
      </TouchableOpacity>
    </View>
  );
}

function PermissionScreen({
  permission,
  requesting,
  onRequest,
}: {
  permission: string;
  requesting: boolean;
  onRequest: () => void;
}) {
  // İlk açılışta kullanıcının diyalog hiç görmemiş olması mümkün -> otomatik
  // tek seferlik request tetikle.
  useEffect(() => {
    if (permission === "unknown" && !requesting) onRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Autorisation de localisation requise</Text>
      <Text style={styles.paragraph}>
        L&apos;application a besoin d&apos;acceder a votre position en
        permanence (y compris en arriere-plan) pour signaler votre presence
        a votre employeur.
      </Text>
      {permission === "denied" ? (
        <>
          <Text style={[styles.paragraph, styles.warning]}>
            L&apos;autorisation a ete refusee. Ouvrez les Reglages systeme,
            choisissez Agent de Bureau, puis Localisation -&gt;
            &quot;Toujours&quot;.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => Linking.openSettings().catch(() => {})}
          >
            <Text style={styles.primaryButtonText}>Ouvrir les Reglages</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={onRequest}>
            <Text style={styles.secondaryButtonText}>Reessayer</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          style={styles.primaryButton}
          disabled={requesting}
          onPress={onRequest}
        >
          <Text style={styles.primaryButtonText}>
            {requesting ? "Demande en cours..." : "Autoriser la localisation"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0f1729" },
  scroll: { padding: 20, flexGrow: 1, justifyContent: "center" },
  card: {
    backgroundColor: "#1a2540",
    borderRadius: 16,
    padding: 24,
    gap: 8,
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  sectionHeading: {
    color: "#8ab4ff",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 14,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  paragraph: { color: "#dbe4ff", fontSize: 14, lineHeight: 20 },
  bullet: { color: "#dbe4ff", fontSize: 14, lineHeight: 20, marginLeft: 6 },
  warning: { color: "#ffb86b", marginTop: 12 },
  primaryButton: {
    backgroundColor: "#3b82f6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 20,
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 12, alignItems: "center", marginTop: 8 },
  secondaryButtonText: { color: "#8ab4ff", fontSize: 14, fontWeight: "500" },
});
