import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  subtitle?: string;
}

export function StatCard({ title, value, icon, color, subtitle }: StatCardProps) {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.iconContainer, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={20} color={color} />
      </View>
      <Text style={[styles.value, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.title, { color: colors.mutedForeground }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: color }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 140,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
    }),
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  value: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  title: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
});
