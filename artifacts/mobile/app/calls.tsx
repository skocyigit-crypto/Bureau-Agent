import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

/**
 * `/calls` -> `/(tabs)/calls`.
 *
 * Cet ecran existait en DOUBLE : une copie autonome (~500 lignes) atteignable
 * depuis le menu "Plus", l'assistant proactif, la recherche et le commandant
 * IA, et l'onglet du meme nom. Les deux avaient diverge — seule la version
 * onglet utilise le client API genere et suit l'etat AppState. Selon le chemin
 * emprunte, l'utilisateur tombait donc sur un ecran plus ancien, et chaque
 * correction devait etre appliquee deux fois (avec le risque, deja realise, de
 * ne l'etre qu'une).
 *
 * La route est conservee plutot que supprimee pour que tous les liens existants
 * continuent de fonctionner; les parametres eventuels (`open`, filtres) sont
 * relayes tels quels a l'onglet.
 */
export default function CallsRedirect() {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname: "/(tabs)/calls", params } as never} />;
}
