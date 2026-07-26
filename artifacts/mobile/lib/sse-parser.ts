/**
 * Analyse d'un flux SSE — logique pure, extraite de `sse-stream.ts`.
 *
 * Elle vivait imbriquee dans la boucle de lecture reseau, donc intestable
 * (le module importe `expo/fetch`). C'est pourtant la partie ou une regression
 * est la plus silencieuse : un evenement mal decoupe ne provoque aucune erreur,
 * l'ecran reste simplement vide ou fige a mi-reponse, ce qui se lit comme "l'IA
 * ne repond pas" plutot que comme un bug d'analyse.
 */

export interface SseEvent {
  /** Nom d'evenement SSE; "message" par defaut, comme la spec. */
  event: string;
  /** Charge utile brute (concatenation des lignes `data:`). */
  data: string;
}

export interface SseParseResult {
  /** Evenements complets extraits du tampon. */
  events: SseEvent[];
  /** Reste incomplet, a reinjecter avec le prochain morceau recu. */
  rest: string;
}

/**
 * Extrait tous les evenements complets d'un tampon.
 *
 * Un evenement se termine par une ligne vide (`\n\n`). Tout ce qui suit le
 * dernier separateur est rendu tel quel dans `rest`: un evenement coupe en
 * plein milieu par la frontiere d'un paquet reseau doit etre complete au tour
 * suivant, jamais traite a moitie.
 *
 * Ignore les blocs vides et les commentaires (`:` en tete, utilises comme
 * battement de coeur par les proxys), ainsi que les evenements sans `data:`.
 */
export function parseSseBuffer(buffer: string): SseParseResult {
  const events: SseEvent[] = [];
  let rest = buffer;

  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    if (!block.trim() || block.startsWith(":")) continue;

    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) continue;
    events.push({ event, data });
  }

  return { events, rest };
}

/**
 * Decode la charge utile d'un evenement: JSON quand c'est possible, texte brut
 * sinon. Le serveur envoie du JSON partout, mais un flux d'erreur ou un proxy
 * peut inserer du texte — le perdre laisserait l'utilisateur devant un ecran
 * muet.
 */
export function decodeSseData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
