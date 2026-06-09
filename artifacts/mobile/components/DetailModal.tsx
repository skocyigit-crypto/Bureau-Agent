import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

interface DetailField {
  label: string;
  value: string;
  icon?: keyof typeof Feather.glyphMap;
  color?: string;
  action?: "call" | "email" | "link";
}

interface ExtraAction {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color?: string;
  onPress: () => void;
}

interface DetailModalProps {
  visible: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  title: string;
  subtitle?: string;
  icon: keyof typeof Feather.glyphMap;
  iconColor?: string;
  fields: DetailField[];
  badge?: { label: string; color: string };
  extraActions?: ExtraAction[];
  refreshing?: boolean;
}

export function DetailModal({
  visible,
  onClose,
  onEdit,
  onDelete,
  title,
  subtitle,
  icon,
  iconColor,
  fields,
  badge,
  extraActions,
  refreshing,
}: DetailModalProps) {
  const colors = useColors();

  function handleAction(action: string | undefined, value: string) {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (action === "call") Linking.openURL(`tel:${value}`);
    else if (action === "email") Linking.openURL(`mailto:${value}`);
    else if (action === "link") Linking.openURL(value);
  }

  function handleDelete() {
    if (Platform.OS === "web") {
      onDelete?.();
      return;
    }
    Alert.alert("Supprimer", "Voulez-vous vraiment supprimer cet element ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: () => onDelete?.() },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Details</Text>
            <View style={styles.headerRight}>
              {refreshing ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topSection}>
              <View style={[styles.bigIcon, { backgroundColor: (iconColor || colors.primary) + "18" }]}>
                <Feather name={icon} size={32} color={iconColor || colors.primary} />
              </View>
              <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
              ) : null}
              {badge ? (
                <View style={[styles.badge, { backgroundColor: badge.color + "20" }]}>
                  <View style={[styles.badgeDot, { backgroundColor: badge.color }]} />
                  <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.fieldsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {fields.map((field, i) => (
                <Pressable
                  key={i}
                  onPress={field.action ? () => handleAction(field.action, field.value) : undefined}
                  style={[
                    styles.fieldRow,
                    i < fields.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  ]}
                >
                  {field.icon ? (
                    <Feather name={field.icon} size={16} color={field.color || colors.mutedForeground} style={styles.fieldIcon} />
                  ) : null}
                  <View style={styles.fieldContent}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{field.label}</Text>
                    <Text
                      style={[
                        styles.fieldValue,
                        { color: field.action ? colors.primary : colors.foreground },
                      ]}
                    >
                      {field.value}
                    </Text>
                  </View>
                  {field.action ? (
                    <Feather
                      name={field.action === "call" ? "phone" : field.action === "email" ? "mail" : "external-link"}
                      size={16}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            {onDelete ? (
              <Pressable
                onPress={handleDelete}
                style={[styles.actionBtn, { borderColor: colors.destructive }]}
              >
                <Feather name="trash-2" size={18} color={colors.destructive} />
              </Pressable>
            ) : null}
            {extraActions?.map((action, idx) => (
              <Pressable
                key={idx}
                onPress={action.onPress}
                style={[styles.actionBtn, { borderColor: action.color || colors.primary }]}
              >
                <Feather name={action.icon} size={16} color={action.color || colors.primary} />
              </Pressable>
            ))}
            {onEdit ? (
              <Pressable
                onPress={onEdit}
                style={[styles.editBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="edit-2" size={16} color={colors.primaryForeground} />
                <Text style={[styles.editText, { color: colors.primaryForeground }]}>Modifier</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  container: {
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  headerRight: {
    width: 22,
    alignItems: "flex-end",
  },
  body: {
    padding: 20,
  },
  topSection: {
    alignItems: "center",
    marginBottom: 20,
  },
  bigIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    textAlign: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 10,
    gap: 6,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  fieldsCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fieldIcon: {
    marginRight: 12,
  },
  fieldContent: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fieldValue: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  editText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
