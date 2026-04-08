import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ListItem } from "@/components/ListItem";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  email: string;
  category: string;
  totalCalls: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  client: "#22c55e",
  prospect: "#3b82f6",
  fournisseur: "#8b5cf6",
  partenaire: "#f59e0b",
  autre: "#64748b",
};

export default function ContactsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortBy: "lastName", sortOrder: "asc" });
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/contacts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts ?? []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [search, fetchAuth]);

  useEffect(() => {
    setLoading(true);
    fetchContacts();
  }, [fetchContacts]);

  function getCategoryLabel(cat: string) {
    const labels: Record<string, string> = {
      client: "Client",
      prospect: "Prospect",
      fournisseur: "Fournisseur",
      partenaire: "Partenaire",
      autre: "Autre",
    };
    return labels[cat] ?? cat;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.secondary,
            paddingTop: (isWeb ? 67 : insets.top) + 12,
          },
        ]}
      >
        <Text style={styles.headerTitle}>Contacts</Text>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un contact..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Feather
              name="x"
              size={16}
              color="rgba(255,255,255,0.5)"
              onPress={() => setSearch("")}
            />
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          scrollEnabled={contacts.length > 0}
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title="Aucun contact"
              subtitle="Vos contacts apparaitront ici"
            />
          }
          renderItem={({ item }) => {
            const catColor = CATEGORY_COLORS[item.category] ?? colors.mutedForeground;
            return (
              <ListItem
                title={`${item.firstName} ${item.lastName}`}
                subtitle={item.company || item.email}
                icon="user"
                iconColor={catColor}
                rightText={item.totalCalls > 0 ? `${item.totalCalls} appels` : undefined}
                rightSubtext={getCategoryLabel(item.category)}
                statusColor={catColor}
              />
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    marginBottom: 14,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    padding: 16,
  },
});
