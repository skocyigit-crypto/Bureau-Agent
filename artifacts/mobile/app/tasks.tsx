import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

/**
 * `/tasks` -> `/(tabs)/tasks`.
 *
 * Meme duplication que `/calls` et `/contacts`. Ici l'ecart etait visible pour
 * l'utilisateur : seul l'onglet lit le parametre `open=<id>` pose par le tap
 * sur une notification (tache #83). Une notification "nouvelle tache" ouvrant
 * `/tasks` affichait donc la liste sans ouvrir la tache concernee. La route est
 * conservee et relaie desormais ses parametres a l'onglet.
 */
export default function TasksRedirect() {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname: "/(tabs)/tasks", params } as never} />;
}
