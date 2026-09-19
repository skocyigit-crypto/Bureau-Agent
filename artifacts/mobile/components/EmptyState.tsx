import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useTranslation } from "@/lib/i18n";

interface EmptyStateProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  /**
   * Vrai quand la liste est vide parce que la LECTURE a echoue, et non parce
   * qu'il n'y a rien.
   *
   * Les deux se ressemblent a l'ecran — une liste vide — mais ne disent pas la
   * meme chose : « vous n'avez aucun utilisateur » est une information,
   * « je n'ai pas pu lire » est une panne. Confondre les deux amene a conclure
   * qu'il n'y a rien a faire.
   */
  erreur?: boolean;
}

export function EmptyState({ icon, title, subtitle, erreur }: EmptyStateProps) {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: colors.muted }]}>
        <Feather name={erreur ? "alert-circle" : icon} size={32} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {erreur ? t("common.lectureEchoueeTitre") : title}
      </Text>
      {erreur || subtitle ? (
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {erreur ? t("common.lectureEchoueeAide") : subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 6,
  },
});
