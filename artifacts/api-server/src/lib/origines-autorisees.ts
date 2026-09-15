/**
 * L'allowlist d'origines, en UN SEUL endroit.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * Elle etait resolue dans `app.ts` pour CORS et la protection CSRF HTTP — avec
 * un garde-fou explicite: en production, une liste vide arrete le processus,
 * pour eviter un deploiement accidentellement ouvert a tous.
 *
 * Le point d'entree WebSocket de la voix (`/api/voice/live`) en construisait
 * une SECONDE, a la main, a partir de `REPLIT_DOMAINS` et `REPLIT_DEV_DOMAIN`
 * uniquement. Or ces variables n'existent pas sur Cloud Run: verifie sur le
 * service de production, seules `ALLOWED_ORIGINS` et `PUBLIC_URL` y sont
 * definies. Sa liste etait donc VIDE, et sa condition
 *
 *     if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin))
 *
 * ne se declenchait jamais: le controle d'origine de l'upgrade WebSocket
 * etait inerte en production, exactement la situation que le commentaire
 * au-dessus de lui declarait insuffisante (« la verification du cookie de
 * session n'est PAS suffisante seule »).
 *
 * Deux listes pour la meme question donnent tot ou tard deux reponses. Il n'y
 * en a plus qu'une.
 */

/**
 * Resolution, dans cet ordre:
 *   1. `ALLOWED_ORIGINS` (CSV) — override explicite par l'administrateur.
 *   2. `REPLIT_DOMAINS` (CSV) — fournie par la plateforme Replit, sans schema.
 *   3. `PUBLIC_URL` / `APP_URL` / `REPLIT_DEPLOYMENT_URL` — repli final.
 *
 * Si la liste reste vide en production, l'appelant doit refuser de servir
 * plutot que d'ouvrir a tous (voir `exigerOriginesEnProduction`).
 */
export function resolveAllowedOrigins(): string[] {
  const out = new Set<string>();

  const explicit = process.env.ALLOWED_ORIGINS;
  if (explicit) {
    explicit.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => out.add(o));
  }

  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    replitDomains.split(",").map((d) => d.trim()).filter(Boolean).forEach((d) => {
      // REPLIT_DOMAINS vient sans schema -> on prefixe https.
      const url = d.startsWith("http://") || d.startsWith("https://") ? d : `https://${d}`;
      out.add(url);
    });
  }

  for (const envName of ["PUBLIC_URL", "APP_URL", "REPLIT_DEPLOYMENT_URL"]) {
    const v = process.env[envName];
    if (v) {
      try {
        out.add(new URL(v).origin);
      } catch {
        /* valeur malformee: ignoree plutot que de faire tomber le demarrage */
      }
    }
  }

  // Expo dev sert le bundle mobile depuis un sous-domaine distinct
  // (`...expo.spock.replit.dev`). Sans cette entree, le preview web mobile
  // recoit un preflight 204 sans `Access-Control-Allow-Origin` et le
  // navigateur bloque silencieusement le POST de login — seul l'OPTIONS
  // apparait dans les journaux, symptome typique.
  const expoDom = process.env.REPLIT_EXPO_DEV_DOMAIN;
  if (expoDom && expoDom.trim() !== "") {
    const url = expoDom.startsWith("http") ? expoDom : `https://${expoDom}`;
    out.add(url.replace(/\/+$/, ""));
  }

  // Auto-deriver le sous-domaine Expo depuis REPLIT_DOMAINS quand
  // REPLIT_EXPO_DEV_DOMAIN n'est pas defini.
  if (replitDomains) {
    replitDomains.split(",").map((d) => d.trim()).filter(Boolean).forEach((d) => {
      const expoVariant = d
        .replace(/\.spock\.replit\.dev$/, ".expo.spock.replit.dev")
        .replace(/^([^.]+)\.replit\.dev$/, "$1.expo.replit.dev");
      if (expoVariant !== d) out.add(`https://${expoVariant}`);
    });
  }

  return Array.from(out);
}

/**
 * Origines acceptees pour un upgrade WebSocket.
 *
 * Meme liste que HTTP, plus `http://localhost` HORS production — un
 * developpeur passe par le proxy Vite et n'a pas de domaine public.
 */
export function originesWebSocket(): string[] {
  const out = new Set(resolveAllowedOrigins());
  if (process.env.NODE_ENV !== "production") {
    out.add("http://localhost");
    out.add("http://localhost:80");
    out.add("http://localhost:5173");
  }
  return Array.from(out);
}

/**
 * Decide si un upgrade WebSocket peut etre accepte.
 *
 * FERME PAR DEFAUT, et c'est tout l'objet de cette fonction.
 *
 * L'implementation precedente laissait passer dans deux cas, tous deux
 * silencieux:
 *
 *   - l'en-tete `Origin` absent — un client non-navigateur suffit a
 *     contourner le controle, et il ne reste alors que le cookie de session,
 *     que le code lui-meme declare insuffisant contre le CSRF;
 *   - l'allowlist vide — exactement l'etat de la production, faute des
 *     variables Replit.
 *
 * Les deux sont desormais des refus. Un navigateur envoie toujours `Origin`
 * sur une poignee de main WebSocket, et le seul client de cet endpoint est
 * l'application web (`VoiceLive.tsx`, qui utilise `window.location.host`):
 * refuser ne coute donc rien de legitime.
 */
export function originWebSocketAutorisee(
  origin: string | undefined,
  autorisees: string[] = originesWebSocket(),
): { ok: boolean; raison?: string } {
  if (autorisees.length === 0) {
    return { ok: false, raison: "aucune origine autorisee configuree" };
  }
  if (!origin) {
    return { ok: false, raison: "en-tete Origin absent" };
  }
  if (!autorisees.includes(origin)) {
    return { ok: false, raison: "origine non autorisee" };
  }
  return { ok: true };
}
