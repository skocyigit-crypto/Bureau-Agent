/**
 * L'attestation de l'editeur.
 *
 * Ce n'est pas un document de communication: c'est la piece qui protege le
 * client contre une amende de 7 500 €, et celle par laquelle l'editeur engage
 * sa responsabilite. Ces tests portent donc moins sur ce que le texte DIT que
 * sur ce qu'il ne doit jamais dire:
 *
 *  - aucune affirmation sans le mecanisme qui la realise;
 *  - aucun mecanisme sans le moyen de le verifier soi-meme;
 *  - aucune limite passee sous silence.
 *
 * Une attestation qui affirmerait plus que ce que le logiciel fait serait pire
 * qu'une absence d'attestation: elle donnerait au client une fausse assurance
 * jusqu'au controle.
 */
import { describe, expect, it } from "vitest";

import {
  CONDITIONS,
  LIMITES,
  nomAttestation,
  redigerAttestation,
  type ContexteAttestation,
} from "../services/attestation-conformite";

const CTX: ContexteAttestation = {
  editeur: {
    raisonSociale: "Ajant Bureau SAS",
    siret: "89012345600012",
    adresse: "12 rue des Lilas, 75011 Paris",
  },
  client: { raisonSociale: "Durand Travaux", siret: "55210055400013" },
  logiciel: "Ajant Bureau",
  version: "1.0.0",
  emiseLe: "2026-09-11T09:00:00.000Z",
};

describe("ce que l'attestation doit contenir", () => {
  const texte = redigerAttestation(CTX);

  it("nomme l'article exact, pas une formule approchante", () => {
    // « conforme a la loi anti-fraude » ne designe rien de verifiable.
    expect(texte).toContain("286-I-3° bis");
    expect(texte).toContain("code general des impots");
  });

  it("identifie l'editeur ET le beneficiaire", () => {
    // Une attestation individuelle vaut pour un client nomme. Un document
    // generique ne prouverait rien sur l'exemplaire installe chez lui.
    expect(texte).toContain("Ajant Bureau SAS");
    expect(texte).toContain("89012345600012");
    expect(texte).toContain("Durand Travaux");
    expect(texte).toContain("55210055400013");
  });

  it("designe la version, car une version anterieure n'est pas couverte", () => {
    expect(texte).toContain("version 1.0.0");
  });

  it("traite les quatre conditions, aucune de moins", () => {
    for (const c of ["INALTERABILITE", "SECURISATION", "CONSERVATION", "ARCHIVAGE"]) {
      expect(texte, `condition manquante: ${c}`).toContain(c);
    }
    expect(CONDITIONS).toHaveLength(4);
  });
});

describe("ce qui rend l'attestation verifiable plutot que croyable", () => {
  const texte = redigerAttestation(CTX);

  it("rattache chaque condition a un mecanisme nomme", () => {
    for (const c of CONDITIONS) {
      expect(texte).toContain(c.mecanisme.slice(0, 40));
    }
  });

  it("donne au client le moyen de verifier lui-meme", () => {
    // Une attestation dont on peut refaire la demonstration est d'une autre
    // nature qu'une attestation qu'il faut croire.
    expect(texte).toContain("GET /api/encaissements/verifier");
    expect(texte).toContain("GET /api/encaissements/conservation");
    expect(texte).toContain("GET /api/encaissements/archive");
  });

  it("annonce que la verification designe l'anomalie et son numero", () => {
    expect(texte).toMatch(/premiere anomalie/i);
    expect(texte).toMatch(/numero d'ecriture/i);
  });
});

describe("ce que l'attestation ne cache pas", () => {
  const texte = redigerAttestation(CTX);

  it("dit qu'elle ne couvre pas la comptabilite generale", () => {
    // Le client doit savoir ce qui reste a la charge de son expert-comptable.
    expect(texte).toMatch(/ne porte pas sur la tenue de la comptabilite generale/i);
  });

  it("dit qu'elle ne garantit pas l'exactitude des montants saisis", () => {
    // Le logiciel garantit qu'un montant n'a pas bouge, pas qu'il etait juste.
    expect(texte).toMatch(/n'exactitude|exactitude des montants saisis/i);
    expect(texte).toMatch(/releve de l'utilisateur/i);
  });

  it("porte une section de limites, visible et non enfouie", () => {
    expect(texte).toContain("PORTEE ET LIMITES");
    expect(LIMITES.length).toBeGreaterThanOrEqual(3);
  });

  it("n'emploie aucune formule commerciale", () => {
    // Un superlatif dans une piece juridique est une affirmation qu'on ne peut
    // pas demontrer.
    for (const mot of ["meilleur", "leader", "100 %", "garantit une conformite totale", "certifie NF525"]) {
      expect(texte.toLowerCase(), `formule non demontrable: ${mot}`).not.toContain(mot.toLowerCase());
    }
  });

  it("ne se presente pas comme un certificat d'organisme accredite", () => {
    // Les deux voies de preuve sont distinctes: laisser croire a un certificat
    // NF525 serait une affirmation fausse.
    expect(texte).toContain("ATTESTATION INDIVIDUELLE DE L'EDITEUR");
    expect(texte).not.toMatch(/organisme accredite/i);
  });
});

describe("forme du document", () => {
  it("est reproductible: memes entrees, meme texte", () => {
    // Le document ne doit pas dependre de l'horloge: deux exemplaires du meme
    // jour doivent etre identiques, sinon lequel fait foi ?
    expect(redigerAttestation(CTX)).toBe(redigerAttestation(CTX));
  });

  it("porte la date d'emission en clair", () => {
    expect(redigerAttestation(CTX)).toContain("2026-09-11");
  });

  it("se nomme de facon lisible et sans caractere hasardeux", () => {
    expect(nomAttestation(CTX.client, CTX.emiseLe))
      .toBe("attestation-286-i-3bis-durand-travaux-2026-09-11.txt");
    // Un nom de client exotique ne doit pas produire un nom de fichier casse.
    expect(nomAttestation({ raisonSociale: "SARL Étoile & Fils / 75", siret: null }, CTX.emiseLe))
      .toMatch(/^attestation-286-i-3bis-[a-z0-9-]+-2026-09-11\.txt$/);
  });

  it("reste du texte brut, lisible sans outil", () => {
    // Un PDF ajouterait une dependance a une piece dont la valeur est
    // precisement d'etre lisible partout, y compris dans six ans.
    const texte = redigerAttestation(CTX);
    expect(texte).not.toContain("<");
    expect(texte.split("\n").length).toBeGreaterThan(20);
  });
});
