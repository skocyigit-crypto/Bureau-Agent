import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type TabType = "scan" | "register" | "profiles" | "logs";

interface FaceProfile {
  id: number;
  name: string;
  role: string;
  contactId?: number;
  recognitionCount: number;
  lastSeenAt?: string;
  createdAt: string;
}

interface RecognitionResult {
  recognized: boolean;
  profile?: FaceProfile;
  confidence: number;
  greeting?: string;
  mood?: string;
  suggestedAction?: string;
  securityLevel?: string;
  reason?: string;
}

export default function FaceRecognitionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [activeTab, setActiveTab] = useState<TabType>("scan");
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [profiles, setProfiles] = useState<FaceProfile[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [regName, setRegName] = useState("");
  const [regRole, setRegRole] = useState("visiteur");
  const [registering, setRegistering] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<any[]>([]);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const cameraRef = useRef<CameraView>(null);

  const apiPost = useCallback(async (path: string, body?: any) => {
    const r = await fetchAuth(`${API_BASE}/api/face${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }, [fetchAuth]);

  const apiGet = useCallback(async (path: string) => {
    const r = await fetchAuth(`${API_BASE}/api/face${path}`);
    return r.json();
  }, [fetchAuth]);

  const loadStats = useCallback(async () => {
    try {
      const d = await apiGet("/stats");
      if (d.success) setStats(d.stats);
    } catch (e) {}
  }, [apiGet]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet("/profiles");
      if (d.success) setProfiles(d.profiles || []);
    } catch (e) {}
    setLoading(false);
  }, [apiGet]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet("/logs?limit=50");
      if (d.success) setLogs(d.logs || []);
    } catch (e) {}
    setLoading(false);
  }, [apiGet]);

  useEffect(() => {
    loadStats();
    loadProfiles();
  }, []);

  useEffect(() => {
    if (activeTab === "profiles") loadProfiles();
    if (activeTab === "logs") loadLogs();
  }, [activeTab]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setResult(null);
    try {
      let photoBase64 = "";
      if (cameraRef.current && Platform.OS !== "web") {
        try {
          const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
          if (photo?.base64) photoBase64 = photo.base64;
        } catch (e) {}
      }

      const d = await apiPost("/recognize", {
        photoBase64,
        location: "Bureau - Application mobile",
        deviceInfo: `${Platform.OS} - Agent de Bureau`,
      });

      if (d.success) {
        setResult(d);
        loadStats();
      } else {
        Alert.alert("Erreur", d.error || "Reconnaissance echouee");
      }
    } catch (err: any) {
      Alert.alert("Erreur", err.message);
    }
    setScanning(false);
  }, [apiPost, loadStats]);

  const handleRegister = useCallback(async () => {
    if (!regName.trim()) {
      Alert.alert("Erreur", "Veuillez entrer un nom");
      return;
    }
    setRegistering(true);
    try {
      let photoBase64 = "";
      if (cameraRef.current && Platform.OS !== "web") {
        try {
          const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
          if (photo?.base64) photoBase64 = photo.base64;
        } catch (e) {}
      }

      const d = await apiPost("/register", {
        name: regName.trim(),
        role: regRole,
        contactId: selectedContact?.id || null,
        photoBase64,
      });

      if (d.success) {
        Alert.alert("Succes", `${regName} a ete enregistre avec succes`);
        setRegName("");
        setRegRole("visiteur");
        setSelectedContact(null);
        setContactSearch("");
        loadProfiles();
        loadStats();
      } else {
        Alert.alert("Erreur", d.error || "Enregistrement echoue");
      }
    } catch (err: any) {
      Alert.alert("Erreur", err.message);
    }
    setRegistering(false);
  }, [regName, regRole, selectedContact, apiPost, loadProfiles, loadStats]);

  const searchContacts = useCallback(async (query: string) => {
    setContactSearch(query);
    if (query.length < 2) { setContactResults([]); return; }
    try {
      const d = await apiPost("/search-contact", { query });
      if (d.success) setContactResults(d.contacts || []);
    } catch (e) {}
  }, [apiPost]);

  const deleteProfile = useCallback(async (id: number, name: string) => {
    const doDelete = async () => {
      try {
        const r = await fetchAuth(`${API_BASE}/api/face/profiles/${id}`, { method: "DELETE" });
        const d = await r.json();
        if (d.success) {
          loadProfiles();
          loadStats();
        }
      } catch (e) {}
    };

    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert("Supprimer", `Supprimer le profil de ${name} ?`, [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: doDelete },
      ]);
    }
  }, [fetchAuth, loadProfiles, loadStats]);

  const securityColors: Record<string, string> = {
    normal: "#22c55e",
    attention: "#f59e0b",
    alerte: "#ef4444",
  };
  const getSecColor = (level?: string) => securityColors[level || "normal"] || securityColors.normal;

  const renderCameraView = () => {
    if (Platform.OS === "web") {
      return (
        <View style={[styles.cameraPlaceholder, { backgroundColor: colors.secondary }]}>
          <Feather name="camera" size={64} color={colors.mutedForeground} />
          <Text style={[styles.cameraPlaceholderText, { color: colors.mutedForeground }]}>
            Camera non disponible sur le web
          </Text>
          <Text style={[styles.cameraSubtext, { color: colors.mutedForeground }]}>
            La reconnaissance fonctionne via analyse IA du contexte
          </Text>
        </View>
      );
    }

    if (!permission) {
      return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />;
    }

    if (!permission.granted) {
      return (
        <View style={[styles.permissionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="camera-off" size={48} color={colors.mutedForeground} />
          <Text style={[styles.permissionTitle, { color: colors.foreground }]}>
            Acces a la camera requis
          </Text>
          <Text style={[styles.permissionText, { color: colors.mutedForeground }]}>
            La reconnaissance faciale necessite l'acces a votre camera
          </Text>
          {permission.canAskAgain ? (
            <Pressable
              onPress={requestPermission}
              style={[styles.permButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.permButtonText, { color: colors.primaryForeground }]}>
                Autoriser la camera
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => { try { Linking.openSettings(); } catch (e) {} }}
              style={[styles.permButton, { backgroundColor: colors.destructive }]}
            >
              <Text style={[styles.permButtonText, { color: "#fff" }]}>
                Ouvrir les parametres
              </Text>
            </Pressable>
          )}
        </View>
      );
    }

    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="front">
          <View style={styles.cameraOverlay}>
            <View style={styles.faceGuide}>
              <View style={[styles.cornerTL, { borderColor: colors.primary }]} />
              <View style={[styles.cornerTR, { borderColor: colors.primary }]} />
              <View style={[styles.cornerBL, { borderColor: colors.primary }]} />
              <View style={[styles.cornerBR, { borderColor: colors.primary }]} />
            </View>
            <Text style={styles.guideText}>Placez le visage dans le cadre</Text>
          </View>
        </CameraView>
      </View>
    );
  };

  const renderScanTab = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: isWeb ? 118 : 100 }}>
      {stats && (
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.primary + "15" }]}>
            <Text style={[styles.statNum, { color: colors.primary }]}>{stats.totalProfiles}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Profils</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: "#22c55e15" }]}>
            <Text style={[styles.statNum, { color: "#22c55e" }]}>{stats.todayRecognitions}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Aujourd'hui</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: "#8b5cf615" }]}>
            <Text style={[styles.statNum, { color: "#8b5cf6" }]}>{stats.totalRecognitions}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
          </View>
        </View>
      )}

      {renderCameraView()}

      <Pressable
        onPress={handleScan}
        disabled={scanning}
        style={({ pressed }) => [
          styles.scanButton,
          { backgroundColor: scanning ? colors.muted : colors.primary, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        {scanning ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <>
            <Feather name="aperture" size={22} color={colors.primaryForeground} />
            <Text style={[styles.scanButtonText, { color: colors.primaryForeground }]}>
              Scanner le visage
            </Text>
          </>
        )}
      </Pressable>

      {result && (
        <View style={[
          styles.resultCard,
          {
            backgroundColor: colors.card,
            borderColor: result.recognized ? getSecColor(result.securityLevel) : colors.border,
            borderWidth: 2,
          },
        ]}>
          <View style={[styles.resultHeader, { backgroundColor: (result.recognized ? getSecColor(result.securityLevel) : "#6b7280") + "15" }]}>
            <Feather
              name={result.recognized ? "check-circle" : "alert-circle"}
              size={28}
              color={result.recognized ? getSecColor(result.securityLevel) : "#6b7280"}
            />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.resultTitle, { color: colors.foreground }]}>
                {result.recognized ? result.profile?.name || "Identifie" : "Non reconnu"}
              </Text>
              <Text style={[styles.resultSubtitle, { color: colors.mutedForeground }]}>
                Confiance: {result.confidence}%
              </Text>
            </View>
            {result.securityLevel && (
              <View style={[styles.secBadge, { backgroundColor: getSecColor(result.securityLevel) + "20" }]}>
                <Text style={[styles.secBadgeText, { color: getSecColor(result.securityLevel) }]}>
                  {result.securityLevel?.toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {result.greeting && (
            <View style={[styles.greetingBox, { backgroundColor: colors.primary + "10" }]}>
              <Feather name="message-circle" size={16} color={colors.primary} />
              <Text style={[styles.greetingText, { color: colors.foreground }]}>{result.greeting}</Text>
            </View>
          )}

          <View style={styles.resultDetails}>
            {result.mood && (
              <View style={styles.detailRow}>
                <Feather name="smile" size={14} color={colors.mutedForeground} />
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Humeur:</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{result.mood}</Text>
              </View>
            )}
            {result.suggestedAction && (
              <View style={styles.detailRow}>
                <Feather name="zap" size={14} color="#f59e0b" />
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Action:</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{result.suggestedAction}</Text>
              </View>
            )}
            {result.reason && (
              <View style={styles.detailRow}>
                <Feather name="info" size={14} color={colors.mutedForeground} />
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Raison:</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{result.reason}</Text>
              </View>
            )}
            {result.recognized && result.profile && (
              <View style={styles.detailRow}>
                <Feather name="eye" size={14} color={colors.primary} />
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Vu:</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{result.profile.recognitionCount} fois</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );

  const renderRegisterTab = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: isWeb ? 118 : 100 }}>
      {renderCameraView()}

      <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.formTitle, { color: colors.foreground }]}>Enregistrer un nouveau visage</Text>

        <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Nom complet *</Text>
        <TextInput
          value={regName}
          onChangeText={setRegName}
          placeholder="Ex: Jean Dupont"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
        />

        <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Role</Text>
        <View style={styles.roleRow}>
          {["visiteur", "employe", "client", "fournisseur", "vip"].map(role => (
            <Pressable
              key={role}
              onPress={() => setRegRole(role)}
              style={[
                styles.roleChip,
                {
                  backgroundColor: regRole === role ? colors.primary : colors.background,
                  borderColor: regRole === role ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.roleChipText, { color: regRole === role ? colors.primaryForeground : colors.foreground }]}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Lier a un contact (optionnel)</Text>
        <TextInput
          value={contactSearch}
          onChangeText={searchContacts}
          placeholder="Rechercher un contact..."
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
        />
        {selectedContact && (
          <View style={[styles.selectedContact, { backgroundColor: colors.primary + "10", borderColor: colors.primary }]}>
            <Feather name="user-check" size={14} color={colors.primary} />
            <Text style={[styles.selectedContactText, { color: colors.primary }]}>
              {selectedContact.firstName} {selectedContact.lastName}
            </Text>
            <Pressable onPress={() => { setSelectedContact(null); setContactSearch(""); }}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}
        {contactResults.length > 0 && !selectedContact && (
          <View style={[styles.contactList, { borderColor: colors.border }]}>
            {contactResults.map((c: any) => (
              <Pressable
                key={c.id}
                onPress={() => { setSelectedContact(c); setContactResults([]); setContactSearch(`${c.firstName} ${c.lastName}`); }}
                style={[styles.contactItem, { borderBottomColor: colors.border }]}
              >
                <Feather name="user" size={14} color={colors.mutedForeground} />
                <Text style={[styles.contactItemText, { color: colors.foreground }]}>
                  {c.firstName} {c.lastName} {c.company ? `(${c.company})` : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          onPress={handleRegister}
          disabled={registering || !regName.trim()}
          style={({ pressed }) => [
            styles.registerButton,
            {
              backgroundColor: !regName.trim() ? colors.muted : colors.primary,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {registering ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="user-plus" size={18} color={colors.primaryForeground} />
              <Text style={[styles.registerButtonText, { color: colors.primaryForeground }]}>Enregistrer</Text>
            </>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );

  const renderProfilesTab = () => (
    <FlatList
      data={profiles}
      keyExtractor={item => String(item.id)}
      contentContainerStyle={{ paddingBottom: isWeb ? 118 : 100 }}
      scrollEnabled={profiles.length > 0}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.emptyState}>
            <Feather name="users" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Aucun profil enregistre</Text>
            <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>
              Utilisez l'onglet Enregistrement pour ajouter des visages
            </Text>
          </View>
        )
      }
      renderItem={({ item }) => (
        <View style={[styles.profileItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.profileAvatar, { backgroundColor: colors.primary + "15" }]}>
            <Text style={[styles.profileInitials, { color: colors.primary }]}>
              {item.name.split(" ").map((w: string) => w[0]).join("").substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>{item.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
              <View style={[styles.roleBadge, { backgroundColor: colors.primary + "15" }]}>
                <Text style={[styles.roleBadgeText, { color: colors.primary }]}>{item.role}</Text>
              </View>
              <Text style={[styles.profileMeta, { color: colors.mutedForeground }]}>
                {item.recognitionCount} scan{item.recognitionCount !== 1 ? "s" : ""}
              </Text>
            </View>
            {item.lastSeenAt && (
              <Text style={[styles.profileDate, { color: colors.mutedForeground }]}>
                Vu: {new Date(item.lastSeenAt).toLocaleDateString("fr-FR")}
              </Text>
            )}
          </View>
          <Pressable onPress={() => deleteProfile(item.id, item.name)} style={styles.deleteBtn}>
            <Feather name="trash-2" size={16} color={colors.destructive} />
          </Pressable>
        </View>
      )}
    />
  );

  const renderLogsTab = () => (
    <FlatList
      data={logs}
      keyExtractor={item => String(item.id)}
      contentContainerStyle={{ paddingBottom: isWeb ? 118 : 100 }}
      scrollEnabled={logs.length > 0}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.emptyState}>
            <Feather name="list" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Aucun historique</Text>
          </View>
        )
      }
      renderItem={({ item }) => (
        <View style={[styles.logItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[
            styles.logIcon,
            { backgroundColor: item.action === "registration" ? "#22c55e15" : item.confidence > 70 ? colors.primary + "15" : "#f59e0b15" },
          ]}>
            <Feather
              name={item.action === "registration" ? "user-plus" : item.confidence > 70 ? "check-circle" : "alert-circle"}
              size={16}
              color={item.action === "registration" ? "#22c55e" : item.confidence > 70 ? colors.primary : "#f59e0b"}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.logName, { color: colors.foreground }]}>
              {item.recognizedName || "Inconnu"}
            </Text>
            <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>
              {item.action === "registration" ? "Enregistrement" : `Reconnaissance (${item.confidence}%)`}
              {" • "}
              {new Date(item.createdAt).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
            </Text>
          </View>
        </View>
      )}
    />
  );

  const tabs: { key: TabType; icon: keyof typeof Feather.glyphMap; label: string }[] = [
    { key: "scan", icon: "aperture", label: "Scanner" },
    { key: "register", icon: "user-plus", label: "Enregistrer" },
    { key: "profiles", icon: "users", label: "Profils" },
    { key: "logs", icon: "list", label: "Historique" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Reconnaissance faciale</Text>
            <Text style={styles.headerSub}>Identification IA en temps reel</Text>
          </View>
          <View style={[styles.aiBadge, { backgroundColor: "#8b5cf620" }]}>
            <Feather name="cpu" size={14} color="#8b5cf6" />
            <Text style={{ color: "#8b5cf6", fontSize: 10, fontFamily: "Inter_600SemiBold" }}>IA</Text>
          </View>
        </View>
      </View>

      <View style={[styles.tabBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {tabs.map(t => (
          <Pressable
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[styles.tab, activeTab === t.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          >
            <Feather name={t.icon} size={16} color={activeTab === t.key ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.tabLabel, { color: activeTab === t.key ? colors.primary : colors.mutedForeground }]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.content}>
        {activeTab === "scan" && renderScanTab()}
        {activeTab === "register" && renderRegisterTab()}
        {activeTab === "profiles" && renderProfilesTab()}
        {activeTab === "logs" && renderLogsTab()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 2 },
  aiBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, gap: 4 },
  tabLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 12, padding: 14, alignItems: "center" },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2 },
  cameraContainer: { borderRadius: 16, overflow: "hidden", height: 280, marginBottom: 16 },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  faceGuide: { width: 200, height: 260, position: "relative" },
  cornerTL: { position: "absolute", top: 0, left: 0, width: 40, height: 40, borderTopWidth: 3, borderLeftWidth: 3, borderRadius: 8 },
  cornerTR: { position: "absolute", top: 0, right: 0, width: 40, height: 40, borderTopWidth: 3, borderRightWidth: 3, borderRadius: 8 },
  cornerBL: { position: "absolute", bottom: 0, left: 0, width: 40, height: 40, borderBottomWidth: 3, borderLeftWidth: 3, borderRadius: 8 },
  cornerBR: { position: "absolute", bottom: 0, right: 0, width: 40, height: 40, borderBottomWidth: 3, borderRightWidth: 3, borderRadius: 8 },
  guideText: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 16, textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  cameraPlaceholder: { height: 220, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 },
  cameraPlaceholderText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  cameraSubtext: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 20 },
  scanButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16, marginBottom: 16 },
  scanButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  resultCard: { borderRadius: 16, overflow: "hidden", marginBottom: 16 },
  resultHeader: { flexDirection: "row", alignItems: "center", padding: 16 },
  resultTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  resultSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  secBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  secBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  greetingBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginHorizontal: 12, borderRadius: 10, marginBottom: 8 },
  greetingText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  resultDetails: { padding: 16, gap: 10 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailLabel: { fontSize: 12, fontFamily: "Inter_500Medium", width: 60 },
  detailValue: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  formCard: { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 16 },
  formTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
  inputLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  roleChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  roleChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  selectedContact: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  selectedContactText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  contactList: { borderWidth: 1, borderRadius: 10, overflow: "hidden", marginTop: 4 },
  contactItem: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  contactItemText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  registerButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16, marginTop: 20 },
  registerButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  profileItem: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10, gap: 12 },
  profileAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  profileInitials: { fontSize: 16, fontFamily: "Inter_700Bold" },
  profileName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  profileMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  profileDate: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 4 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  roleBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  logItem: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8, gap: 10 },
  logIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  logName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  logMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySubtext: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 40 },
  permissionCard: { alignItems: "center", padding: 30, borderRadius: 16, borderWidth: 1, marginBottom: 16, gap: 12 },
  permissionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  permissionText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  permButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  permButtonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
