import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

/**
 * `/contacts` -> `/(tabs)/contacts`.
 *
 * Meme duplication que `/calls` : une copie autonome (~500 lignes) et l'onglet,
 * qui avaient diverge. On garde la route pour ne casser aucun lien existant
 * (menu "Plus", recherche, commandant IA, assistant proactif) et on relaie les
 * parametres a l'onglet, seule version maintenue.
 */
export default function ContactsRedirect() {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname: "/(tabs)/contacts", params } as never} />;
}
