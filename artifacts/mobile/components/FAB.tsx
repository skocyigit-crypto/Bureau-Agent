import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, StyleSheet } from "react-native";

import { useColors } from "@/hooks/useColors";

interface FABProps {
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
  bottom?: number;
}

export function FAB({ icon = "plus", onPress, bottom = 100 }: FABProps) {
  const colors = useColors();
  const isWeb = Platform.OS === "web";

  function handlePress() {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: colors.primary,
          bottom: isWeb ? bottom + 18 : bottom,
          transform: [{ scale: pressed ? 0.92 : 1 }],
        },
      ]}
    >
      <Feather name={icon} size={24} color="#ffffff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
      web: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
      },
    }),
  },
});
