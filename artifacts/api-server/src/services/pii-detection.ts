// Detection de donnees personnelles / sensibles (RGPD) dans du texte.
//
// Objectif: avertir l'utilisateur AVANT qu'il ne partage ou stocke par erreur
// des donnees personnelles reglementees (IBAN, SIREN/SIRET, numero de securite
// sociale, carte bancaire, emails/telephones en masse). Tout est heuristique
// et 100% local (aucun appel reseau). Les validateurs (mod-97, Luhn, cle NIR)
// servent a reduire fortement les faux positifs sur des suites de chiffres.
//
// Aucune donnee detectee n'est journalisee en clair: les echantillons renvoyes
// sont systematiquement masques (maskValue).

export type PiiKind = "iban" | "siret" | "siren" | "nir" | "card" | "email" | "phone";

export interface PiiFinding {
  kind: PiiKind;
  label: string;
  count: number;
  /** Echantillons masques (max 3), jamais en clair. */
  samples: string[];
}

export interface PiiResult {
  hasPii: boolean;
  findings: PiiFinding[];
  summary: string;
}

const KIND_LABEL: Record<PiiKind, string> = {
  iban: "IBAN (coordonnées bancaires)",
  siret: "SIRET (établissement)",
  siren: "SIREN (entreprise)",
  nir: "Numéro de sécurité sociale",
  card: "Carte bancaire",
  email: "Adresses email",
  phone: "Numéros de téléphone",
};

/** Masque une valeur sensible: ne garde que les 2 premiers et 2 derniers caracteres. */
function maskValue(raw: string): string {
  const v = raw.replace(/\s+/g, "");
  if (v.length <= 4) return "*".repeat(v.length);
  return `${v.slice(0, 2)}${"*".repeat(Math.min(v.length - 4, 8))}${v.slice(-2)}`;
}

/** Algorithme de Luhn (cartes bancaires, SIREN/SIRET). */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Validation IBAN par mod-97 (ISO 13616). */
function ibanValid(raw: string): boolean {
  const v = raw.replace(/\s+/g, "").toUpperCase();
  if (v.length < 15 || v.length > 34) return false;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(v)) return false;
  const rearranged = v.slice(4) + v.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const c of code) {
      remainder = (remainder * 10 + (c.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

/** Validation du numero de securite sociale francais (NIR) via la cle de controle. */
function nirValid(raw: string): boolean {
  const v = raw.replace(/\s+/g, "").toUpperCase();
  // 13 chiffres + 2 chiffres de cle. La Corse utilise 2A/2B en position departement.
  const m = /^([12])(\d{2})(\d{2})(\d{2}|2[AB])(\d{3})(\d{3})(\d{2})$/.exec(v);
  if (!m) return false;
  let body = v.slice(0, 13);
  const key = parseInt(v.slice(13), 10);
  // Corse: 2A -> 19, 2B -> 18 avant calcul.
  body = body.replace("2A", "19").replace("2B", "18");
  if (!/^\d{13}$/.test(body)) return false;
  const computed = 97 - (Number(BigInt(body) % 97n));
  return computed === key;
}

function collect(re: RegExp, text: string, validator?: (s: string) => boolean): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[0];
    if (!validator || validator(candidate)) out.push(candidate);
    if (out.length > 5000) break; // garde-fou
  }
  return out;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.replace(/\s+/g, ""))));
}

function finding(kind: PiiKind, values: string[]): PiiFinding | null {
  const uniq = dedupe(values);
  if (uniq.length === 0) return null;
  return {
    kind,
    label: KIND_LABEL[kind],
    count: uniq.length,
    samples: uniq.slice(0, 3).map(maskValue),
  };
}

// Limite de taille analysee pour borner le cout CPU des regex.
const MAX_TEXT_CHARS = 2_000_000;

/**
 * Detecte les donnees personnelles/sensibles dans un texte. Renvoie des
 * comptes et des echantillons MASQUES par categorie.
 */
export function detectPii(input: string): PiiResult {
  const text = input.length > MAX_TEXT_CHARS ? input.slice(0, MAX_TEXT_CHARS) : input;
  const findings: PiiFinding[] = [];

  // IBAN: 2 lettres + 2 chiffres + jusqu'a 30 alphanum (groupes espaces optionnels).
  const ibanRe = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/gi;
  const iban = finding("iban", collect(ibanRe, text, ibanValid));
  if (iban) findings.push(iban);

  // Cartes bancaires: 13-19 chiffres, groupes de 4 separes par espace/tiret.
  const cardRe = /\b(?:\d[ -]?){12,18}\d\b/g;
  const cards = collect(cardRe, text, (c) => {
    const d = c.replace(/[ -]/g, "");
    return d.length >= 13 && d.length <= 19 && luhnValid(d);
  });
  const card = finding("card", cards);
  if (card) findings.push(card);

  // NIR (securite sociale): 15 caracteres, groupes optionnels.
  const nirRe = /\b[12][ ]?\d{2}[ ]?\d{2}[ ]?(?:\d{2}|2[AB])[ ]?\d{3}[ ]?\d{3}[ ]?\d{2}\b/gi;
  const nir = finding("nir", collect(nirRe, text, nirValid));
  if (nir) findings.push(nir);

  // SIRET (14) puis SIREN (9), tous deux valides par Luhn. On retire d'abord
  // les SIRET pour ne pas recompter leurs 9 premiers chiffres comme SIREN.
  const siretRe = /\b\d{3}[ ]?\d{3}[ ]?\d{3}[ ]?\d{5}\b/g;
  const sirets = collect(siretRe, text, (c) => {
    const d = c.replace(/\s/g, "");
    return d.length === 14 && luhnValid(d);
  });
  const siret = finding("siret", sirets);
  if (siret) findings.push(siret);

  const siretDigits = new Set(sirets.map((s) => s.replace(/\s/g, "")));
  const sirenRe = /\b\d{3}[ ]?\d{3}[ ]?\d{3}\b/g;
  const sirens = collect(sirenRe, text, (c) => {
    const d = c.replace(/\s/g, "");
    if (d.length !== 9 || !luhnValid(d)) return false;
    // Ignore si ces 9 chiffres sont le prefixe d'un SIRET deja detecte.
    for (const sd of siretDigits) if (sd.startsWith(d)) return false;
    return true;
  });
  const siren = finding("siren", sirens);
  if (siren) findings.push(siren);

  // Emails et telephones: on n'alerte qu'a partir d'un volume (fuite en masse),
  // car 1 email/tel isole est souvent legitime (signature, contact).
  const emailRe = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const emails = dedupe(collect(emailRe, text));
  if (emails.length >= 5) {
    findings.push({
      kind: "email",
      label: KIND_LABEL.email,
      count: emails.length,
      samples: emails.slice(0, 3).map(maskValue),
    });
  }

  const phoneRe = /\b(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}\b/g;
  const phones = dedupe(collect(phoneRe, text));
  if (phones.length >= 5) {
    findings.push({
      kind: "phone",
      label: KIND_LABEL.phone,
      count: phones.length,
      samples: phones.slice(0, 3).map(maskValue),
    });
  }

  const hasPii = findings.length > 0;
  const summary = hasPii
    ? `Données personnelles détectées : ${findings.map((f) => `${f.count} ${f.label.toLowerCase()}`).join(", ")}.`
    : "Aucune donnée personnelle sensible détectée.";

  return { hasPii, findings, summary };
}

/**
 * Heuristique: le buffer ressemble-t-il a du texte exploitable ? Evite de faire
 * tourner les regex PII sur du binaire (images, executables) -> faux positifs.
 */
export function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 4096);
  if (sample.length === 0) return false;
  let control = 0;
  for (const byte of sample) {
    // NUL ou octet de controle => signature binaire forte.
    if (byte === 0) return false;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      control++;
    }
  }
  // Trop d'octets de controle => binaire.
  if (control / sample.length > 0.05) return false;
  // Exiger un decodage UTF-8 valide (rejette le binaire a octets hauts).
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    // Fallback latin-1 tolere si peu d'octets de controle (deja verifie).
    return true;
  }
}
