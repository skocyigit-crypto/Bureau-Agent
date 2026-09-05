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
import { useTranslation } from "@/lib/i18n";
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
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("locationConsentGate.kvkkTitle")}</Text>
      <Text style={styles.paragraph}>{t("locationConsentGate.kvkkIntro")}</Text>
      <Text style={styles.sectionHeading}>{t("locationConsentGate.sectionCollected")}</Text>
      <Text style={styles.bullet}>{t("locationConsentGate.bulletCollected1")}</Text>
      <Text style={styles.bullet}>{t("locationConsentGate.bulletCollected2")}</Text>
      {/* Quand la collecte a lieu — la premiere question que se pose un
          salarie, et celle a laquelle cet ecran ne repondait pas. Le suivi
          tournait 24 h sur 24; il est desormais borne aux horaires definis par
          l'employeur, et le serveur refuse d'enregistrer en dehors. */}
      <Text style={styles.sectionHeading}>{t("locationConsentGate.sectionHoraires")}</Text>
      <Text style={styles.bullet}>{t("locationConsentGate.bulletHoraires")}</Text>
      <Text style={styles.sectionHeading}>{t("locationConsentGate.sectionVisible")}</Text>
      <Text style={styles.bullet}>{t("locationConsentGate.bulletVisible")}</Text>
      <Text style={styles.sectionHeading}>{t("locationConsentGate.sectionRetention")}</Text>
      <Text style={styles.bullet}>{t("locationConsentGate.bulletRetention")}</Text>
      <Text style={styles.sectionHeading}>{t("locationConsentGate.sectionRights")}</Text>
      <Text style={styles.bullet}>{t("locationConsentGate.bulletRights")}</Text>
      <Text style={[styles.paragraph, styles.warning]}>{t("locationConsentGate.warning")}</Text>
      <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={onAccept}>
        <Text style={styles.primaryButtonText}>{t("locationConsentGate.acceptBtn")}</Text>
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
  const { t } = useTranslation();
  // İlk açılışta kullanıcının diyalog hiç görmemiş olması mümkün -> otomatik
  // tek seferlik request tetikle.
  useEffect(() => {
    if (permission === "unknown" && !requesting) onRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("locationConsentGate.permTitle")}</Text>
      <Text style={styles.paragraph}>{t("locationConsentGate.permIntro")}</Text>
      {permission === "denied" ? (
        <>
          <Text style={[styles.paragraph, styles.warning]}>{t("locationConsentGate.deniedWarning")}</Text>
          <TouchableOpacity accessibilityRole="button"
            style={styles.primaryButton}
            onPress={() => Linking.openSettings().catch(() => {})}
          >
            <Text style={styles.primaryButtonText}>{t("locationConsentGate.openSettings")}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={onRequest}>
            <Text style={styles.secondaryButtonText}>{t("locationConsentGate.retry")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity accessibilityRole="button"
          style={styles.primaryButton}
          disabled={requesting}
          onPress={onRequest}
        >
          <Text style={styles.primaryButtonText}>
            {requesting ? t("locationConsentGate.requesting") : t("locationConsentGate.allowLocation")}
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
