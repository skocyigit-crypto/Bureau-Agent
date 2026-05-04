import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

interface Client {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  company?: string | null;
}

interface ClientDetail extends Client {
  stats: {
    devisCount: number;
    devisAcceptes: number;
    totalDevis: number;
    facturesCount: number;
    facturesPayees: number;
    totalFactures: number;
    totalPaid: number;
    totalDue: number;
    overdueCount: number;
    overdueAmount: number;
    projetsCount?: number;
    projetsActifs?: number;
  };
  devis: Array<{ id: number; reference: string; title: string; status: string; totalAmount: string; createdAt: string }>;
  factures: Array<{ id: number; reference: string; status: string; totalAmount: string; dueDate: string }>;
  projets?: Array<{ id: number; title: string; status: string; progress: number }>;
}

function fmtEur(v: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

const DEVIS_STATUS_COLORS: Record<string, string> = {
  brouillon: "#64748b", envoye: "#3b82f6", accepte: "#22c55e", refuse: "#ef4444", expire: "#f59e0b",
};
const FACTURE_STATUS_COLORS: Record<string, string> = {
  brouillon: "#64748b", envoye: "#3b82f6", partiel: "#f59e0b", paye: "#22c55e", en_retard: "#ef4444", annule: "#94a3b8",
};
const PROJET_STATUS_COLORS: Record<string, string> = {
  planifie: "#64748b", en_cours: "#3b82f6", en_pause: "#f59e0b", termine: "#22c55e", annule: "#94a3b8",
};

interface ClientDetailViewProps {
  client: Client;
  detail: ClientDetail | null;
  loading: boolean;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onClose: () => void;
  fetchDetail: () => void;
}

function ClientDetailView({ client, detail, loading, colors, onClose, fetchDetail }: ClientDetailViewProps) {
  if (loading && !detail) {
    return (
      <View style={styles.detailLoading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Chargement du profil client...</Text>
      </View>
    );
  }

  const s = detail?.stats;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={[styles.detailHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.avatarCircle, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>
            {(client.name || "?").charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.detailClientName, { color: colors.foreground }]}>{client.name}</Text>
          {client.company && (
            <Text style={[styles.detailCompany, { color: colors.mutedForeground }]}>
              <Feather name="briefcase" size={11} /> {client.company}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.contactRow}>
        {client.email ? (
          <Pressable style={[styles.contactBtn, { backgroundColor: "#3b82f618", borderColor: "#3b82f630" }]} onPress={() => Linking.openURL(`mailto:${client.email}`)}>
            <Feather name="mail" size={14} color="#3b82f6" />
            <Text style={[styles.contactBtnText, { color: "#3b82f6" }]}>{client.email}</Text>
          </Pressable>
        ) : null}
        {client.phone ? (
          <Pressable style={[styles.contactBtn, { backgroundColor: "#22c55e18", borderColor: "#22c55e30" }]} onPress={() => Linking.openURL(`tel:${client.phone}`)}>
            <Feather name="phone" size={14} color="#22c55e" />
            <Text style={[styles.contactBtnText, { color: "#22c55e" }]}>{client.phone}</Text>
          </Pressable>
        ) : null}
        {client.address ? (
          <View style={[styles.contactBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="map-pin" size={14} color={colors.mutedForeground} />
            <Text style={[styles.contactBtnText, { color: colors.mutedForeground }]}>{client.address}</Text>
          </View>
        ) : null}
      </View>

      {s && (
        <>
          <Text style={[styles.detailSection, { color: colors.foreground }]}>Résumé financier</Text>
          <View style={styles.statsGrid}>
            <View style={[styles.miniStat, { backgroundColor: "#22c55e10", borderColor: "#22c55e30" }]}>
              <Text style={[styles.miniStatVal, { color: "#22c55e" }]}>{fmtEur(s.totalPaid)}</Text>
              <Text style={[styles.miniStatLbl, { color: colors.mutedForeground }]}>Encaissé</Text>
            </View>
            <View style={[styles.miniStat, { backgroundColor: "#f59e0b10", borderColor: "#f59e0b30" }]}>
              <Text style={[styles.miniStatVal, { color: "#f59e0b" }]}>{fmtEur(s.totalDue)}</Text>
              <Text style={[styles.miniStatLbl, { color: colors.mutedForeground }]}>En attente</Text>
            </View>
            {s.overdueAmount > 0 && (
              <View style={[styles.miniStat, { backgroundColor: "#ef444410", borderColor: "#ef444430" }]}>
                <Text style={[styles.miniStatVal, { color: "#ef4444" }]}>{fmtEur(s.overdueAmount)}</Text>
                <Text style={[styles.miniStatLbl, { color: colors.mutedForeground }]}>En retard</Text>
              </View>
            )}
            <View style={[styles.miniStat, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.miniStatVal, { color: colors.foreground }]}>{s.devisCount}</Text>
              <Text style={[styles.miniStatLbl, { color: colors.mutedForeground }]}>Devis</Text>
            </View>
            <View style={[styles.miniStat, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.miniStatVal, { color: colors.foreground }]}>{s.facturesCount}</Text>
              <Text style={[styles.miniStatLbl, { color: colors.mutedForeground }]}>Factures</Text>
            </View>
            {s.projetsCount != null && (
              <View style={[styles.miniStat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.miniStatVal, { color: "#6366f1" }]}>{s.projetsCount}</Text>
                <Text style={[styles.miniStatLbl, { color: colors.mutedForeground }]}>Projets</Text>
              </View>
            )}
          </View>
        </>
      )}

      {detail?.devis && detail.devis.length > 0 && (
        <>
          <Text style={[styles.detailSection, { color: colors.foreground }]}>Devis récents</Text>
          {detail.devis.slice(0, 5).map(d => (
            <View key={d.id} style={[styles.subRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.subRowTitle, { color: colors.foreground }]}>{d.reference}</Text>
                <Text style={[styles.subRowSub, { color: colors.mutedForeground }]}>{d.title}</Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: (DEVIS_STATUS_COLORS[d.status] ?? "#64748b") + "20" }]}>
                <Text style={[styles.statusDotText, { color: DEVIS_STATUS_COLORS[d.status] ?? "#64748b" }]}>{d.status}</Text>
              </View>
              <Text style={[styles.subRowAmount, { color: colors.foreground }]}>
                {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parseFloat(d.totalAmount || "0"))}
              </Text>
            </View>
          ))}
        </>
      )}

      {detail?.factures && detail.factures.length > 0 && (
        <>
          <Text style={[styles.detailSection, { color: colors.foreground }]}>Factures récentes</Text>
          {detail.factures.slice(0, 5).map(f => (
            <View key={f.id} style={[styles.subRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.subRowTitle, { color: colors.foreground }]}>{f.reference}</Text>
                <Text style={[styles.subRowSub, { color: colors.mutedForeground }]}>
                  Éch: {f.dueDate ? new Date(f.dueDate).toLocaleDateString("fr-FR") : "—"}
                </Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: (FACTURE_STATUS_COLORS[f.status] ?? "#64748b") + "20" }]}>
                <Text style={[styles.statusDotText, { color: FACTURE_STATUS_COLORS[f.status] ?? "#64748b" }]}>{f.status}</Text>
              </View>
              <Text style={[styles.subRowAmount, { color: f.status === "en_retard" ? "#ef4444" : colors.foreground }]}>
                {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parseFloat(f.totalAmount || "0"))}
              </Text>
            </View>
          ))}
        </>
      )}

      {detail?.projets && detail.projets.length > 0 && (
        <>
          <Text style={[styles.detailSection, { color: colors.foreground }]}>Projets</Text>
          {detail.projets.slice(0, 4).map(p => (
            <View key={p.id} style={[styles.subRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.subRowTitle, { color: colors.foreground }]}>{p.title}</Text>
                <View style={[styles.progressBarContainer, { backgroundColor: colors.border }]}>
                  <View style={[styles.progressBar, { width: `${p.progress}%` as any, backgroundColor: PROJET_STATUS_COLORS[p.status] ?? "#6366f1" }]} />
                </View>
              </View>
              <Text style={[styles.subRowAmount, { color: colors.mutedForeground }]}>{p.progress}%</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

export default function ClientsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const { cached, isFromCache, updateCache } = useOfflineCache<Client[]>("clients_list", []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/clients?${params}`);
      if (res.ok) {
        const list: Client[] = await res.json();
        setClients(list);
        if (!search) updateCache(list);
      }
    } catch {
      if (cached.length > 0 && clients.length === 0) setClients(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, fetchAuth, cached, clients.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && clients.length === 0) setClients(cached);
  }, [isFromCache, cached, clients.length]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  async function openClient(client: Client) {
    setSelected(client);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/clients/${encodeURIComponent(client.name)}`);
      if (res.ok) {
        const d = await res.json();
        setDetail(d);
      }
    } catch {}
    finally { setDetailLoading(false); }
  }

  function onRefresh() { setRefreshing(true); load(); }

  if (selected) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <View style={styles.headerTop}>
            <Pressable onPress={() => { setSelected(null); setDetail(null); }} style={styles.backBtn}>
              <Feather name="arrow-left" size={20} color="#fff" />
            </Pressable>
            <Text style={[styles.headerTitle, { fontSize: 18 }]} numberOfLines={1}>{selected.name}</Text>
            {isFromCache && (
              <View style={[styles.cacheBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
                <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.6)" />
              </View>
            )}
          </View>
        </View>
        <View style={{ flex: 1, padding: 16 }}>
          <ClientDetailView
            client={selected}
            detail={detail}
            loading={detailLoading}
            colors={colors}
            onClose={() => { setSelected(null); setDetail(null); }}
            fetchDetail={() => openClient(selected)}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Clients</Text>
          {isFromCache && (
            <View style={[styles.cacheBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.6)" />
              <Text style={styles.cacheText}>Cache</Text>
            </View>
          )}
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un client..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={clients}
          keyExtractor={item => item.name}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            clients.length > 0 ? (
              <Text style={[styles.countText, { color: colors.mutedForeground }]}>
                {clients.length} client{clients.length !== 1 ? "s" : ""}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title="Aucun client"
              subtitle={search ? "Aucun client ne correspond à votre recherche." : "Vos clients apparaîtront ici."}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openClient(item)}
              style={({ pressed }) => [
                styles.clientRow,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && { opacity: 0.8 },
              ]}
            >
              <View style={[styles.clientAvatar, { backgroundColor: colors.primary + "20" }]}>
                <Text style={[styles.clientAvatarText, { color: colors.primary }]}>
                  {(item.name || "?").charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.clientName, { color: colors.foreground }]}>{item.name}</Text>
                {item.company && (
                  <Text style={[styles.clientCompany, { color: colors.mutedForeground }]} numberOfLines={1}>
                    <Feather name="briefcase" size={10} /> {item.company}
                  </Text>
                )}
                {(item.email || item.phone) && (
                  <Text style={[styles.clientContact, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.email ?? item.phone}
                  </Text>
                )}
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  cacheBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  cacheText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  countText: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10 },
  clientRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8, gap: 12 },
  clientAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  clientAvatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  clientName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  clientCompany: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  clientContact: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  detailLoading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  detailHeader: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 12, gap: 14 },
  avatarCircle: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  detailClientName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  detailCompany: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  contactRow: { gap: 8, marginBottom: 8 },
  contactBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  contactBtnText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  detailSection: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 16, marginBottom: 10 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  miniStat: { borderRadius: 10, borderWidth: 1, padding: 10, minWidth: "30%", flex: 1, alignItems: "center" },
  miniStatVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  miniStatLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  subRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8, gap: 10 },
  subRowTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  subRowSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  subRowAmount: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusDot: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusDotText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  progressBarContainer: { height: 4, borderRadius: 2, marginTop: 6, overflow: "hidden" },
  progressBar: { height: "100%", borderRadius: 2 },
});
