/**
 * Transfert vers la bonne equipe : choix, validation, repli.
 *
 * La demande : « rediriger vers la bonne personne ou equipe ». Le code n'avait
 * qu'un numero de transfert. Ces tests verrouillent l'ordre de choix (equipe
 * nommee par le modele, puis nom / mot-cle prononce, puis numero par defaut,
 * puis personne) et le fait que le modele n'invente pas de destinataire.
 */
import { describe, expect, it } from "vitest";
import { choisirEquipe, cibleDeTransfert, transfertPossible, validerEquipes, type EquipeTransfert } from "../services/equipes-transfert";
import { dialTwiml } from "../routes/voice-receptionist";

const EQUIPES: EquipeTransfert[] = [
  { nom: "Comptabilité", numeros: ["+33700000011", "+33700000012"], motsCles: ["facture", "paiement"] },
  { nom: "Chantiers", numeros: ["+33700000021"], motsCles: ["chantier", "travaux"] },
];

describe("validation des equipes", () => {
  it("une saisie correcte passe, nettoyee", () => {
    const v = validerEquipes([{ nom: "  Comptabilité ", numeros: [" +33 7 00 00 00 11 "], motsCles: [" facture ", ""] }]);
    expect(v).toEqual({ ok: true, equipes: [{ nom: "Comptabilité", numeros: ["+33 7 00 00 00 11"], motsCles: ["facture"] }] });
  });

  it("refuse : sans nom, sans numero, numero invalide, doublon, trop d'equipes", () => {
    expect(validerEquipes([{ nom: "", numeros: ["+33700000011"] }]).ok).toBe(false);
    expect(validerEquipes([{ nom: "Compta", numeros: [] }]).ok).toBe(false);
    expect(validerEquipes([{ nom: "Compta", numeros: ["bonjour"] }]).ok).toBe(false);
    expect(validerEquipes([{ nom: "Compta", numeros: ["+33700000011"] }, { nom: "COMPTA", numeros: ["+33700000012"] }]).ok).toBe(false);
    expect(validerEquipes(Array.from({ length: 7 }, (_, i) => ({ nom: `E${i}`, numeros: ["+33700000011"] }))).ok).toBe(false);
  });

  it("absente = aucune equipe (pas une erreur)", () => {
    expect(validerEquipes(undefined)).toEqual({ ok: true, equipes: [] });
  });
});

describe("choix de l'equipe", () => {
  it("l'equipe nommee par le modele, sans tenir compte des accents ni de la casse", () => {
    expect(choisirEquipe(EQUIPES, { equipeModele: "comptabilite" })?.nom).toBe("Comptabilité");
  });

  it("un nom d'equipe invente par le modele est ignore ; la parole de l'appelant decide", () => {
    expect(choisirEquipe(EQUIPES, { equipeModele: "Direction", texte: "C'est pour les travaux de la cuisine" })?.nom).toBe("Chantiers");
  });

  it("mot-cle en mot entier seulement (« refacturer » n'est pas « facture »)", () => {
    expect(choisirEquipe(EQUIPES, { texte: "je voudrais refacturer" })).toBeNull();
    expect(choisirEquipe(EQUIPES, { texte: "une question sur ma facture" })?.nom).toBe("Comptabilité");
  });

  it("rien de reconnu : pas d'equipe", () => {
    expect(choisirEquipe(EQUIPES, { equipeModele: null, texte: "bonjour" })).toBeNull();
  });
});

describe("cible du transfert", () => {
  const cfg = { forwardToNumber: "+33700000009", equipesTransfert: EQUIPES };
  it("equipe reconnue : tous ses numeros", () => {
    expect(cibleDeTransfert(cfg, { equipeModele: "Comptabilité" })).toEqual({ equipe: "Comptabilité", numeros: ["+33700000011", "+33700000012"] });
  });
  it("sinon le numero par defaut", () => {
    expect(cibleDeTransfert(cfg, { texte: "un conseiller" })).toEqual({ equipe: null, numeros: ["+33700000009"] });
  });
  it("ni equipe ni numero : personne (le code appelant cree un rappel)", () => {
    expect(cibleDeTransfert({}, { texte: "un conseiller" })).toEqual({ equipe: null, numeros: [] });
    expect(transfertPossible({})).toBe(false);
    expect(transfertPossible({ equipesTransfert: EQUIPES })).toBe(true);
  });
});

describe("TwiML de transfert", () => {
  it("les numeros d'une equipe sonnent ensemble ; un seul numero garde la forme simple", () => {
    const equipe = dialTwiml(["+33700000011", "+33700000012"], "+33100000001", "Je vous passe l'equipe.", "fr", "Polly.Lea");
    expect(equipe).toMatch(/<Dial [^>]*action="\/api\/voice\/twilio\/transfert-resultat"[^>]*><Number>\+33700000011<\/Number><Number>\+33700000012<\/Number><\/Dial>/);
    const seul = dialTwiml("+33700000009", "+33100000001", "Un instant.", "fr", "Polly.Lea");
    expect(seul).toMatch(/<Dial [^>]*>\+33700000009<\/Dial>/);
  });
});
