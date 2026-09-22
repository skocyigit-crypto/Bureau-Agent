import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "@/lib/i18n";

/**
 * Ce que le rapport d'evaluation dit de lui-meme (registre des risques,
 * docs/conformite-ia : R-1a, R-5a, R-8a) — meme contenu que sur le web.
 *
 * Sans `cadre` (ancienne reponse du serveur), l'avertissement general
 * s'affiche quand meme.
 */
export interface CadreEvaluation {
  genereParIa: boolean;
  nature: string;
  effectif: number;
  petiteEquipe: boolean;
}

export function CadreEvaluationIa({ cadre }: { cadre?: CadreEvaluation | null }) {
  const { t } = useTranslation();
  return (
    <View style={styles.boite} accessible accessibilityRole="text" accessibilityLabel={t("cadreEvaluationIa.titre")}>
      <Text style={styles.texte}>{t("cadreEvaluationIa.hypothese")}</Text>
      {cadre?.petiteEquipe ? (
        <Text style={[styles.texte, styles.second]}>{t("cadreEvaluationIa.petiteEquipe", { count: cadre.effectif })}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boite: {
    borderWidth: 1,
    borderColor: "#c4b5fd",
    backgroundColor: "#f5f3ff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  // Violet 800 sur violet 50 : contraste superieur a 7:1.
  texte: { color: "#5b21b6", fontSize: 13, lineHeight: 18 },
  second: { marginTop: 6 },
});
