import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface ListItemProps {
  title: string;
  subtitle?: string;
  rightText?: string;
  rightSubtext?: string;
  icon: keyof typeof Feather.glyphMap;
  iconColor?: string;
  statusColor?: string;
  onPress?: () => void;
}

export function ListItem({
  title,
  subtitle,
  rightText,
  rightSubtext,
  icon,
  iconColor,
  statusColor,
  onPress,
}: ListItemProps) {
  const colors = useColors();
  const resolvedIconColor = iconColor ?? colors.primary;

  function handlePress() {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.();
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.iconContainer, { backgroundColor: resolvedIconColor + "18" }]}>
        <Feather name={icon} size={18} color={resolvedIconColor} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        {rightText ? (
          <Text style={[styles.rightText, { color: colors.mutedForeground }]}>{rightText}</Text>
        ) : null}
        {rightSubtext ? (
          <View style={styles.badgeRow}>
            {statusColor ? (
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            ) : null}
            <Text style={[styles.rightSubtext, { color: statusColor ?? colors.mutedForeground }]}>
              {rightSubtext}
            </Text>
          </View>
        ) : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  right: {
    alignItems: "flex-end",
    marginRight: 8,
  },
  rightText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  rightSubtext: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
});
