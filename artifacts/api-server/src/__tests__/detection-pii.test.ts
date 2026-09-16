/**
 * La detection de donnees personnelles — et le garde-fou qui ne gardait rien.
 *
 * CE QUE CE SERVICE COMMANDE
 *
 * `detectPii` n'est pas un affichage. Deux appelants agissent sur sa reponse :
 *
 *   - `routes/security.ts` analyse les fichiers televerses ;
 *   - `services/outgoing-dlp.ts` s'en sert pour BLOQUER un envoi sortant.
 *
 * Un faux positif n'est donc pas un avertissement de trop : c'est un message
 * legitime qui ne part pas. Un faux negatif, a l'inverse, laisse sortir un
 * IBAN ou un numero de securite sociale. Les deux erreurs comptent, et les
 * tests ci-dessous verifient les deux sens.
 *
 * LE DEFAUT MESURE LE 16/09
 *
 * `looksLikeText` existe precisement pour empecher les regex de tourner sur du
 * binaire. Son commentaire l'annonce : « Exiger un decodage UTF-8 valide
 * (rejette le binaire a octets hauts) ». Le code disait autre chose :
 *
 *     try {
 *       new TextDecoder("utf-8", { fatal: true }).decode(sample);
 *       return true;
 *     } catch {
 *       return true;   // <-- les deux branches rendent la MEME valeur
 *     }
 *
 * Le `fatal: true` ne servait a rien : l'exception etait levee, puis ignoree.
 * Mesure : un echantillon de 204 octets hauts, invalide en UTF-8 et sans aucun
 * octet de controle — la forme exacte d'un corps JPEG — passait les deux
 * controles et etait rendu a `detectPii` via `buffer.toString("utf8")`.
 *
 * C'est la meme famille que le controle d'origine WebSocket (#153) : une
 * garde ecrite, visible, et inerte. Quelqu'un cherchant si le binaire etait
 * filtre aurait lu le commentaire, vu le `fatal: true`, et conclu que oui.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import { detectPii, looksLikeText } from "../services/pii-detection";

/** IBAN francais valide (mod-97), jeu d'essai public de la documentation ISO. */
const IBAN_VALIDE = "FR7630006000011234567890189";
/** Meme IBAN avec un chiffre change: la cle mod-97 ne tombe plus juste. */
const IBAN_INVALIDE = "FR7630006000011234567890188";
/** Numero de test Visa (Luhn valide), jamais attribue. */
const CARTE_VALIDE = "4111111111111111";
const CARTE_INVALIDE = "4111111111111112";

function kinds(texte: string): string[] {
  return detectPii(texte).findings.map((f) => f.kind);
}

describe("les validateurs evitent d'alerter sur n'importe quelle suite de chiffres", () => {
  it("un IBAN valide est detecte", () => {
    expect(kinds(`Virement sur ${IBAN_VALIDE} merci`)).toContain("iban");
  });

  it("un IBAN dont la cle est fausse n'est PAS signale", () => {
    // Sans mod-97, toute reference commencant par deux lettres et deux
    // chiffres declencherait une alerte — et, cote DLP, un blocage d'envoi.
    expect(kinds(`Reference ${IBAN_INVALIDE}`)).not.toContain("iban");
  });

  it("une carte bancaire valide au sens de Luhn est detectee", () => {
    expect(kinds(`CB ${CARTE_VALIDE}`)).toContain("card");
  });

  it("un numero a 16 chiffres qui echoue a Luhn n'est PAS signale", () => {
    expect(kinds(`Numero de dossier ${CARTE_INVALIDE}`)).not.toContain("card");
  });

  it("un NIR valide est detecte, un NIR a cle fausse ne l'est pas", () => {
    // 1 80 01 75 123 456 -> cle calculee par 97 - (corps % 97).
    const corps = "1800175123456";
    const cle = 97 - Number(BigInt(corps) % 97n);
    const bonne = `${corps}${String(cle).padStart(2, "0")}`;
    const mauvaise = `${corps}${String((cle % 97) + 1).padStart(2, "0")}`;
    expect(kinds(`NIR ${bonne}`), "NIR valide non detecte").toContain("nir");
    expect(kinds(`Dossier ${mauvaise}`), "NIR a cle fausse signale a tort").not.toContain("nir");
  });

  it("un texte ordinaire ne declenche rien", () => {
    // Le cas le plus frequent, et celui qui coute le plus cher s'il se trompe:
    // c'est lui qui decide qu'un message part.
    const r = detectPii("Bonjour, le chantier de la rue des Lilas avance bien. A demain.");
    expect(r.hasPii, `alerte a tort: ${r.summary}`).toBe(false);
    expect(r.findings).toHaveLength(0);
  });
});

describe("le volume distingue une signature d'une fuite", () => {
  it("un seul email ne declenche pas d'alerte", () => {
    // Une signature de bas de mail en contient toujours un.
    expect(kinds("Contact: jean.dupont@exemple.fr")).not.toContain("email");
  });

  it("cinq emails ou plus sont signales", () => {
    const texte = ["a@x.fr", "b@x.fr", "c@x.fr", "d@x.fr", "e@x.fr"].join(" ");
    expect(kinds(texte)).toContain("email");
  });

  it("le meme email repete ne fait pas un volume", () => {
    // Le dedoublonnage est ce qui separe « un fichier de 500 contacts » de
    // « une signature citee cinq fois dans un fil de discussion ».
    const texte = Array(10).fill("jean.dupont@exemple.fr").join(" ");
    expect(kinds(texte), "une seule adresse repetee a ete prise pour une fuite").not.toContain("email");
  });

  it("cinq numeros de telephone francais sont signales", () => {
    const texte = "0612345678 0623456789 0634567890 0645678901 0656789012";
    expect(kinds(texte)).toContain("phone");
  });
});

describe("rien de sensible ne ressort en clair", () => {
  it("les echantillons d'IBAN sont masques", () => {
    // Le resultat est journalise et affiche: y laisser la valeur en clair
    // recreerait la fuite que le service sert a prevenir.
    const r = detectPii(`Virement ${IBAN_VALIDE}`);
    const ech = r.findings.find((f) => f.kind === "iban")!.samples;
    expect(ech.join(" ")).not.toContain(IBAN_VALIDE);
    for (const e of ech) expect(e).toMatch(/\*/);
  });

  it("le numero de carte n'apparait jamais entier", () => {
    const r = detectPii(`CB ${CARTE_VALIDE}`);
    const ech = r.findings.find((f) => f.kind === "card")!.samples;
    expect(ech.join(" ")).not.toContain(CARTE_VALIDE);
  });

  it("au plus trois echantillons par categorie", () => {
    const texte = ["a@x.fr", "b@x.fr", "c@x.fr", "d@x.fr", "e@x.fr", "f@x.fr"].join(" ");
    const f = detectPii(texte).findings.find((x) => x.kind === "email")!;
    expect(f.samples.length).toBeLessThanOrEqual(3);
    expect(f.count).toBe(6);
  });
});

describe("le binaire n'est pas analyse comme du texte", () => {
  it("du texte simple est reconnu", () => {
    // L'erreur inverse compte: refuser du texte ferait passer un vrai
    // fichier de donnees personnelles sans aucune analyse.
    expect(looksLikeText(Buffer.from("Bonjour, ceci est un fichier texte.", "utf8"))).toBe(true);
  });

  it("du texte francais accentue en UTF-8 est reconnu", () => {
    expect(looksLikeText(Buffer.from("Réunion de chantier à Évry, coût prévu.", "utf8"))).toBe(true);
  });

  it("du texte francais encode en latin-1 reste reconnu", () => {
    // Un export comptable ancien sort souvent en ISO-8859-1. Le rejeter
    // reviendrait a ne plus jamais analyser ces fichiers-la.
    const latin1 = Buffer.from("Réunion à Évry, coût prévu pour la réfection.", "latin1");
    expect(looksLikeText(latin1), "un export latin-1 legitime a ete rejete").toBe(true);
  });

  it("un buffer contenant un octet NUL est rejete", () => {
    expect(looksLikeText(Buffer.from([0x41, 0x42, 0x00, 0x43]))).toBe(false);
  });

  it("un buffer vide est rejete", () => {
    expect(looksLikeText(Buffer.alloc(0))).toBe(false);
  });

  it("un corps binaire sans octet de controle est REJETE", () => {
    // LE DEFAUT MESURE. Ces octets sont invalides en UTF-8 et ne contiennent
    // aucun octet de controle: les deux gardes en place les laissaient passer,
    // la seconde parce que son `catch` rendait `true` comme son `try`.
    const binaire = Buffer.from(
      Array.from({ length: 256 }, (_, i) => (i % 2 ? 0xa9 : 0xe9)),
    );
    let ctrl = 0;
    for (const b of binaire) if (b < 32 && b !== 9 && b !== 10 && b !== 13) ctrl++;
    expect(ctrl, "l'echantillon doit passer la premiere garde pour prouver quelque chose").toBe(0);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(binaire)).toThrow();

    expect(looksLikeText(binaire), "du binaire a ete rendu aux regex PII").toBe(false);
  });

  it("des octets de la plage 0x80-0x9F trahissent le binaire meme en faible proportion", () => {
    // Deuxieme critere, et il lui faut son propre cas: sans lui, une mutation
    // qui le neutralise passait inapercue. La plage 0x80-0x9F ne porte aucun
    // caractere imprimable en latin-1 — du texte n'en contient pas, quelle que
    // soit sa langue. Ici 3 % d'octets hauts seulement: le seuil global de
    // densite (30 %) ne peut pas trancher, seul ce critere-ci le peut.
    const octets: number[] = [];
    for (let i = 0; i < 1000; i++) octets.push(i % 30 === 0 ? 0x85 : 0x41 + (i % 26));
    const buf = Buffer.from(octets);
    const hauts = octets.filter((b) => b >= 0x80).length / octets.length;
    expect(hauts, "l'echantillon doit rester sous le seuil de densite").toBeLessThan(0.3);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(buf)).toThrow();

    expect(looksLikeText(buf)).toBe(false);
  });

  it("un en-tete JPEG reel est rejete", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
      Buffer.from(Array.from({ length: 300 }, (_, i) => 0x80 + (i % 0x7f))),
    ]);
    expect(looksLikeText(jpeg)).toBe(false);
  });
});
