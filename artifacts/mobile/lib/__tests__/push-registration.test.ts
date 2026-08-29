/**
 * Enregistrement des notifications push (`lib/push-registration.ts`).
 *
 * La desinscription est le point sensible: son role est d'empecher qu'un
 * telephone continue de recevoir les notifications de l'organisation quittee.
 *
 * L'ancienne implementation mettait `currentToken` a null AVANT l'appel reseau
 * et se contentait d'un `console.warn` en cas d'echec. Une deconnexion hors
 * ligne — ascenseur, metro, avion — laissait donc le jeton enregistre cote
 * serveur, et la seule copie locale venait d'etre perdue: plus aucune tentative
 * n'etait possible. Le jeton Expo identifiant l'APPAREIL et non le compte, le
 * telephone restait abonne aux alertes de l'organisation precedente.
 *
 * Le risque est borne — `POST /push/register` fait un upsert cible sur le
 * jeton, donc la connexion suivante, meme d'un autre compte, reprend la
 * propriete de la ligne. La fenetre reelle est "deconnexion hors ligne puis
 * plus aucune reconnexion". Ces tests figent le comportement qui la reduit:
 * reessais bornes, et jeton conserve tant que le serveur n'a pas confirme.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let fetchCalls: { url: string; body: any }[] = [];
/** Reponses servies dans l'ordre; une entree `null` simule une panne reseau. */
let fetchQueue: (number | null)[] = [];

const fetchMock = vi.fn(async (url: string, init: any) => {
  fetchCalls.push({ url, body: JSON.parse(init.body) });
  const next = fetchQueue.shift();
  if (next === null || next === undefined) {
    if (next === null) throw new Error("network down");
    return { ok: true, status: 200 };
  }
  return { ok: next >= 200 && next < 300, status: next };
});
vi.stubGlobal("fetch", fetchMock);

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { eas: { projectId: "proj-1" } } } },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ status: "granted" }),
  requestPermissionsAsync: async () => ({ status: "granted" }),
  getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[abc]" }),
}));

vi.mock("@/lib/api-config", () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
  MOBILE_APP_ORIGIN: "https://agentdebureau.fr",
}));

const { registerForPushNotifications, unregisterPushNotifications, isRemotePushActive } =
  await import("../push-registration");

const AUTH = { Authorization: "Bearer t", Origin: "https://agentdebureau.fr" };

beforeEach(() => {
  fetchCalls = [];
  fetchQueue = [];
  fetchMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Laisse les reessais temporises se derouler sans attendre reellement. */
async function runWithTimers<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe("enregistrement", () => {
  it("declare le jeton au serveur et s'active", async () => {
    fetchQueue = [200];
    expect(await registerForPushNotifications(AUTH)).toBe(true);
    expect(isRemotePushActive()).toBe(true);
    expect(fetchCalls[0].url).toBe("https://api.test/api/push/register");
    expect(fetchCalls[0].body.token).toBe("ExponentPushToken[abc]");
  });

  it("reste inactif si le serveur refuse", async () => {
    fetchQueue = [401];
    expect(await registerForPushNotifications(AUTH)).toBe(false);
    expect(isRemotePushActive()).toBe(false);
  });
});

describe("desinscription", () => {
  it("efface le jeton apres confirmation du serveur", async () => {
    fetchQueue = [200];
    await registerForPushNotifications(AUTH);

    fetchQueue = [200];
    expect(await runWithTimers(unregisterPushNotifications(AUTH))).toBe(true);
    expect(isRemotePushActive()).toBe(false);

    // Jeton efface: un second appel n'a plus rien a envoyer.
    fetchCalls = [];
    expect(await runWithTimers(unregisterPushNotifications(AUTH))).toBe(true);
    expect(fetchCalls).toHaveLength(0);
  });

  it("reessaie puis CONSERVE le jeton quand le reseau est coupe", async () => {
    fetchQueue = [200];
    await registerForPushNotifications(AUTH);

    fetchCalls = [];
    fetchQueue = [null, null, null];
    expect(await runWithTimers(unregisterPushNotifications(AUTH))).toBe(false);
    expect(fetchCalls).toHaveLength(3);

    // Regression centrale: le jeton n'a pas ete jete, donc une nouvelle
    // tentative reste possible une fois le reseau revenu.
    fetchCalls = [];
    fetchQueue = [200];
    expect(await runWithTimers(unregisterPushNotifications(AUTH))).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.test/api/push/unregister");
  });

  it("reessaie sur erreur serveur puis reussit", async () => {
    fetchQueue = [200];
    await registerForPushNotifications(AUTH);

    fetchCalls = [];
    fetchQueue = [503, 200];
    expect(await runWithTimers(unregisterPushNotifications(AUTH))).toBe(true);
    expect(fetchCalls).toHaveLength(2);
  });

  it("n'insiste pas sur un refus definitif", async () => {
    fetchQueue = [200];
    await registerForPushNotifications(AUTH);

    fetchCalls = [];
    fetchQueue = [401];
    expect(await runWithTimers(unregisterPushNotifications(AUTH))).toBe(false);
    // Une session expiree ne se repare pas en reessayant: on ne retarde pas
    // la deconnexion de l'utilisateur.
    expect(fetchCalls).toHaveLength(1);
  });

  it("desactive le mode distant meme sans jeton connu", async () => {
    expect(await runWithTimers(unregisterPushNotifications(AUTH))).toBe(true);
    expect(isRemotePushActive()).toBe(false);
  });
});
