import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiUrl } from "@/lib/api-config";

/**
 * Notifications push distantes (Expo) — enregistrement de l'appareil.
 *
 * AVANT: l'app ne produisait que des notifications LOCALES, planifiees par son
 * propre flux SSE. Elles n'existent donc que tant que le JS tourne — c'est-a-
 * dire jamais quand l'app est fermee, et rarement plus de quelques secondes
 * apres un passage en arriere-plan sur iOS. Un nouveau message ou un appel
 * manque restait invisible jusqu'a la prochaine ouverture manuelle.
 *
 * APRES: l'appareil declare son jeton Expo au serveur, qui relaie les
 * evenements metier (`services/push-notifications.ts`). Les notifications
 * locales restent en secours quand aucun jeton n'a pu etre obtenu (emulateur,
 * permission refusee, projet EAS absent) — voir `isRemotePushActive`.
 */

/** Vrai une fois le jeton accepte par le serveur. Faux sinon (secours local). */
let remotePushActive = false;
let currentToken: string | null = null;

/**
 * La desinscription part sur le chemin de deconnexion: quelques tentatives
 * rapides suffisent a absorber une coupure reseau passagere sans faire
 * patienter l'utilisateur qui veut juste sortir.
 */
const MAX_UNREGISTER_ATTEMPTS = 3;
const UNREGISTER_RETRY_MS = 300;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRemotePushActive(): boolean {
  return remotePushActive;
}

/**
 * `projectId` est indispensable a `getExpoPushTokenAsync` dans un build EAS.
 * Il vit dans app.json (`extra.eas.projectId`); en son absence on n'essaie meme
 * pas, plutot que de laisser une exception opaque remonter a chaque demarrage.
 */
function getProjectId(): string | null {
  const fromExpo = Constants.expoConfig?.extra?.eas?.projectId;
  const fromEas = (Constants as any)?.easConfig?.projectId;
  const id = fromExpo ?? fromEas;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Demande la permission si besoin, obtient le jeton Expo et l'enregistre cote
 * serveur. Idempotent et silencieux en cas d'echec: l'app doit rester
 * utilisable sans notifications distantes.
 *
 * @param headers en-tetes d'authentification (Bearer + Origin), fournis par
 *   AuthContext — un build natif n'envoie pas d'Origin, sans quoi la
 *   verification CSRF du backend rejette le POST.
 */
export async function registerForPushNotifications(
  headers: Record<string, string>,
): Promise<boolean> {
  if (Platform.OS === "web") return false;
  // Sur simulateur/emulateur, `getExpoPushTokenAsync` leve — c'est traite comme
  // un echec ordinaire plus bas (secours notifications locales), sans
  // dependance supplementaire juste pour detecter l'environnement.

  // L'etat repart de zero a chaque tentative, et n'est remis a vrai qu'apres
  // acceptation du serveur. Sans cela, une RE-inscription qui echoue (session
  // expiree, serveur indisponible) laissait `remotePushActive` a vrai depuis la
  // fois precedente: l'app croyait le push distant operationnel et n'activait
  // donc pas le secours par notifications locales — l'utilisateur ne recevait
  // plus rien du tout, en silence. `currentToken` est conserve pour que la
  // deconnexion puisse encore tenter de desinscrire l'appareil.
  remotePushActive = false;

  const projectId = getProjectId();
  if (!projectId) {
    console.warn("[push] projectId EAS absent — notifications distantes desactivees");
    return false;
  }

  try {
    // Android exige un canal declare pour que la notification soit affichee
    // avec un son/une importance; sans lui elle arrive en silence.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Alertes Ajant Bureau",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return false;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return false;

    const res = await fetch(apiUrl("/api/push/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    if (!res.ok) {
      console.warn("[push] enregistrement refuse par le serveur:", res.status);
      return false;
    }
    currentToken = token;
    remotePushActive = true;
    return true;
  } catch (err) {
    console.warn("[push] enregistrement impossible:", err);
    return false;
  }
}

/**
 * Detache l'appareil du compte a la deconnexion. Sans cela, le telephone
 * continuerait a recevoir les notifications de l'organisation quittee —
 * y compris apres un changement de compte sur le meme appareil.
 */
export async function unregisterPushNotifications(
  headers: Record<string, string>,
): Promise<boolean> {
  const token = currentToken;
  // Quoi qu'il arrive cote reseau, l'app cesse de se considerer abonnee.
  remotePushActive = false;
  if (!token) {
    currentToken = null;
    return true;
  }

  // Le jeton n'est efface localement qu'apres confirmation du serveur.
  //
  // L'ancienne version le mettait a null AVANT l'appel et se contentait d'un
  // warn en cas d'echec: une deconnexion hors ligne laissait donc le jeton
  // enregistre cote serveur, sans plus aucun moyen de reessayer puisque la
  // seule copie venait d'etre perdue. Le telephone continuait a recevoir les
  // notifications de l'organisation quittee — precisement ce que cette
  // fonction existe pour empecher.
  //
  // Portee du risque residuel: `POST /push/register` fait un upsert cible sur
  // le jeton (une seule ligne par appareil), donc la prochaine connexion, meme
  // sur un autre compte, reprend la propriete du jeton et purge la fuite. La
  // fenetre problematique est donc "deconnexion hors ligne suivie d'aucune
  // reconnexion" — reelle, mais bornee.
  for (let attempt = 0; attempt < MAX_UNREGISTER_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(apiUrl("/api/push/unregister"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        currentToken = null;
        return true;
      }
      // 4xx hors 429: la requete est refusee sur le fond (jeton invalide,
      // session expiree). Reessayer ne ferait que retarder la deconnexion.
      if (res.status < 500 && res.status !== 429) {
        console.warn("[push] desinscription refusee:", res.status);
        return false;
      }
    } catch (err) {
      if (attempt === MAX_UNREGISTER_ATTEMPTS - 1) {
        console.warn("[push] desinscription impossible:", err);
      }
    }
    if (attempt < MAX_UNREGISTER_ATTEMPTS - 1) {
      await delay(UNREGISTER_RETRY_MS * 2 ** attempt);
    }
  }
  return false;
}
