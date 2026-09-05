/**
 * Lire un releve bancaire camt.053.
 *
 * Ce format a ete retenu parce qu'il NE TRONQUE PAS l'information de remise et
 * la range dans des champs distincts — reference structuree du creancier,
 * reference de bout en bout, communication libre. C'est ce qui fait passer le
 * rapprochement automatique de 50-60 % (formats tronques) a 85-95 %.
 *
 * Les tests portent donc surtout sur ce qui doit etre EXTRAIT sans perte, et
 * sur les trois pieges d'un lecteur XML naif:
 *
 *   - un element unique n'est pas un tableau (camt rend un objet quand il n'y a
 *     qu'une ecriture, un tableau quand il y en a plusieurs);
 *   - un debit n'est pas un encaissement et n'a rien a faire dans les paiements;
 *   - un fichier venu d'un tiers ne doit pas pouvoir faire lire un fichier
 *     local a l'analyseur (XXE).
 */
import { describe, expect, it } from "vitest";

import { empreinte, lireCamt053, ReleveIllisible, texteRapprochement } from "../services/camt053";

/** Un releve minimal mais realiste: un credit, tous les champs de reference. */
const RELEVE = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>STMT-2026-09</Id>
      <Acct><Id><IBAN>FR7630001007941234567890185</IBAN></Id></Acct>
      <Ntry>
        <Amt Ccy="EUR">34.80</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-09-03</Dt></BookgDt>
        <ValDt><Dt>2026-09-03</Dt></ValDt>
        <AcctSvcrRef>BANQUE-REF-0001</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>FAC-2026-000042</EndToEndId></Refs>
            <RltdPties>
              <Dbtr><Nm>ACME SARL</Nm></Dbtr>
              <DbtrAcct><Id><IBAN>FR1420041010050500013M02606</IBAN></Id></DbtrAcct>
            </RltdPties>
            <RmtInf>
              <Ustrd>Reglement facture FAC-2026-000042</Ustrd>
              <Strd><CdtrRefInf><Ref>FAC-2026-000042</Ref></CdtrRefInf></Strd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

/** Deux ecritures, dont un debit: le lecteur doit n'en garder qu'une. */
const RELEVE_MIXTE = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <BkToCstmrStmt>
    <Stmt>
      <Ntry>
        <Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-09-01</Dt></BookgDt>
        <AcctSvcrRef>A1</AcctSvcrRef>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">250.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-09-02</Dt></BookgDt>
        <AcctSvcrRef>A2</AcctSvcrRef>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe("lecture d'un releve camt.053", () => {
  it("extrait le montant, la devise et la date de comptabilisation", () => {
    const [e] = lireCamt053(RELEVE);
    expect(e.montant).toBe(34.8);
    expect(e.devise).toBe("EUR");
    expect(e.date?.toISOString().slice(0, 10)).toBe("2026-09-03");
  });

  it("preserve les TROIS porteurs de reference, sans les confondre", () => {
    // C'est la raison d'etre du format: chacun est range separement, et aucun
    // n'est tronque.
    const [e] = lireCamt053(RELEVE);
    expect(e.refStructuree).toBe("FAC-2026-000042");
    expect(e.refDeBoutEnBout).toBe("FAC-2026-000042");
    expect(e.communication).toBe("Reglement facture FAC-2026-000042");
    expect(e.refBanque).toBe("BANQUE-REF-0001");
  });

  it("identifie le donneur d'ordre", () => {
    const [e] = lireCamt053(RELEVE);
    expect(e.payeur).toBe("ACME SARL");
    expect(e.payeurIban).toBe("FR1420041010050500013M02606");
  });

  it("ecarte les debits", () => {
    // Une depense ne solde aucune facture: la laisser entrer polluerait la
    // table des paiements de lignes qu'aucun rapprochement ne peut fermer.
    const ecritures = lireCamt053(RELEVE_MIXTE);
    expect(ecritures).toHaveLength(1);
    expect(ecritures[0].montant).toBe(100);
  });

  it("lit une ecriture unique comme un tableau", () => {
    // Piege classique: camt rend un OBJET quand il n'y a qu'une ecriture et un
    // TABLEAU quand il y en a plusieurs. Un lecteur qui suppose l'un des deux
    // perd soit la seule ecriture du mois, soit toutes sauf une.
    expect(lireCamt053(RELEVE)).toHaveLength(1);
    expect(lireCamt053(RELEVE_MIXTE)).toHaveLength(1);
  });

  it("refuse un fichier qui declare des entites externes", () => {
    // Un releve arrive d'un tiers. Un analyseur qui resout les entites permet
    // de lui faire lire un fichier local et de le renvoyer dans une donnee.
    // Celui-ci REFUSE le fichier au lieu de l'ignorer — meilleur comportement,
    // a condition de le traduire: sans quoi l'import rendrait un 500 opaque
    // sur ce qui est un fichier invalide.
    const attaque = `<?xml version="1.0"?>
<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<Document><BkToCstmrStmt><Stmt><Ntry>
  <Amt Ccy="EUR">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
  <NtryDtls><TxDtls><RmtInf><Ustrd>&xxe;</Ustrd></RmtInf></TxDtls></NtryDtls>
</Ntry></Stmt></BkToCstmrStmt></Document>`;
    expect(() => lireCamt053(attaque)).toThrow(ReleveIllisible);
    // Et surtout: rien du fichier vise n'a pu ressortir.
    try {
      lireCamt053(attaque);
    } catch (e) {
      expect(String(e)).not.toContain("root:");
    }
  });

  it("survit a un fichier vide ou hors sujet", () => {
    expect(lireCamt053("<Document></Document>")).toEqual([]);
    expect(lireCamt053("<autre/>")).toEqual([]);
  });

  it("rend un texte de rapprochement ordonne du plus fiable au moins fiable", () => {
    const [e] = lireCamt053(RELEVE);
    const t = texteRapprochement(e);
    expect(t.indexOf("FAC-2026-000042")).toBe(0);
    expect(t).toContain("ACME SARL");
  });
});

describe("empreinte d'une ecriture", () => {
  it("est stable pour la meme ecriture", () => {
    const [a] = lireCamt053(RELEVE);
    const [b] = lireCamt053(RELEVE);
    expect(empreinte(a)).toBe(empreinte(b));
  });

  it("distingue deux ecritures de meme montant et meme jour", () => {
    // Le cas qui compte: deux clients paient le meme forfait le meme jour.
    // Si l'empreinte les confondait, le second virement serait pris pour un
    // doublon et jamais impute.
    const [a] = lireCamt053(RELEVE);
    const b = { ...a, refBanque: "BANQUE-REF-0002", payeurIban: "FR7630006000011234567890189" };
    expect(empreinte(a)).not.toBe(empreinte(b));
  });

  it("ne se fie pas a la seule reference de la banque", () => {
    // Toutes les banques n'honorent pas l'unicite d'`AcctSvcrRef`. Deux
    // ecritures qui la partagent doivent rester distinguables par le reste.
    const [a] = lireCamt053(RELEVE);
    const b = { ...a, montant: 79 };
    expect(empreinte(a)).not.toBe(empreinte(b));
  });
});
