/**
 * Le script de remise en etat.
 *
 * Un diagnostic qui se trompe fait perdre du temps. Une reparation qui se
 * trompe casse un poste dont depend une entreprise. Ces tests portent donc
 * moins sur ce que le script FAIT que sur ce qu'il ne fera JAMAIS:
 *
 *  - il ne supprime rien, ne desinstalle rien, ne redemarre rien;
 *  - il ne touche pas a ce qui produit une perte a retardement — activer le
 *    chiffrement sans que la cle de recuperation soit mise a l'abri en est
 *    l'exemple type;
 *  - chaque commande est precedee de sa raison, parce qu'un script que
 *    personne ne peut relire n'est pas relu.
 *
 * La liste de ce qui est automatisable est courte a dessein. Ces tests
 * existent pour qu'elle le reste: y ajouter une commande destructrice doit
 * faire echouer la construction, pas passer inapercu.
 */
import { describe, expect, it } from "vitest";

import { construireRemise } from "../services/remise-en-etat";
import { analyserPoste, type Constat, type RapportPoste } from "../services/diagnostic-poste";

const MAINTENANT = new Date("2026-09-10T12:00:00Z");

function constat(code: string): Constat {
  return { code, gravite: "elevee", constat: "c", pourquoi: "p", remede: "r" };
}

describe("ce que la remise en etat automatise", () => {
  it("reactive l'antivirus et le pare-feu", () => {
    const r = construireRemise([constat("antivirus_inactif"), constat("parefeu_inactif")]);
    expect(r.etapes.map((e) => e.code)).toEqual(["antivirus_inactif", "parefeu_inactif"]);
    expect(r.script).toContain("Set-MpPreference -DisableRealtimeMonitoring $false");
    expect(r.script).toContain("Set-NetFirewallProfile");
    expect(r.administrateurRequis).toBe(true);
  });

  it("explique chaque commande juste au-dessus d'elle", () => {
    const r = construireRemise([constat("antivirus_inactif")]);
    const lignes = r.script!.split("\n");
    const iCommande = lignes.findIndex((l) => l.startsWith("Set-MpPreference"));
    expect(iCommande).toBeGreaterThan(0);
    // Au-dessus de la commande: le marqueur d'etape, et avant lui l'explication.
    const avant = lignes.slice(0, iCommande).join("\n");
    expect(avant).toMatch(/# .*[Rr]eactive/);
    expect(avant).toMatch(/[Rr]eversible/);
  });

  it("dit dans l'en-tete ce qu'il ne fera pas", () => {
    // C'est la premiere chose que lit quelqu'un a qui l'on demande de lancer
    // un script sur sa machine.
    const r = construireRemise([constat("antivirus_inactif")]);
    expect(r.script).toMatch(/ne supprime aucun fichier/i);
    expect(r.script).toMatch(/n'envoie rien nulle part/i);
    expect(r.script).toMatch(/Lisez-le avant de le lancer/i);
  });
});

describe("ce que la remise en etat n'automatise JAMAIS", () => {
  it("ne chiffre pas le disque toute seule", () => {
    // Le chiffrement produit une cle de recuperation. Chiffrer sans que
    // quelqu'un la mette a l'abri, c'est fabriquer une perte de donnees a
    // retardement — y compris pour le proprietaire du poste.
    const r = construireRemise([constat("disque_non_chiffre")]);
    expect(r.etapes).toEqual([]);
    expect(r.script).toBeNull();
    const consigne = r.aLaMain.find((a) => a.code === "disque_non_chiffre")!.consigne;
    expect(consigne).toMatch(/CLE DE RECUPERATION/i);
    expect(consigne).toMatch(/ailleurs que sur ce poste/i);
  });

  it("ne supprime pas de fichiers pour liberer de l'espace", () => {
    // Seule la personne qui a mis les fichiers la sait ce qui est jetable.
    const r = construireRemise([constat("disque_plein")]);
    expect(r.etapes).toEqual([]);
    expect(r.aLaMain[0].consigne).toMatch(/Aucun script ne devrait choisir a votre place/i);
  });

  it("ne declenche ni mise a jour ni redemarrage", () => {
    // Un redemarrage impose en pleine journee fait perdre le devis en cours.
    const r = construireRemise([constat("maj_tres_anciennes"), constat("jamais_redemarre")]);
    expect(r.etapes).toEqual([]);
    expect(r.aLaMain.map((a) => a.code)).toEqual(["maj_tres_anciennes", "jamais_redemarre"]);
    expect(r.aLaMain[0].consigne).toMatch(/fin de journee|choisi/i);
  });

  it("ne contient aucun verbe destructeur, quels que soient les constats", () => {
    // Le vrai garde-fou: si quelqu'un ajoute demain une entree destructrice a
    // la liste des actions automatisables, ce test tombe.
    const tousLesCodes = [
      "os_hors_support", "maj_tres_anciennes", "maj_anciennes", "jamais_redemarre",
      "antivirus_inactif", "antivirus_signatures_anciennes", "parefeu_inactif",
      "disque_non_chiffre", "aucune_sauvegarde", "sauvegarde_ancienne",
      "disque_plein", "disque_presque_plein", "memoire_juste",
    ];
    const r = construireRemise(tousLesCodes.map(constat));
    const script = r.script ?? "";
    for (const verbe of [
      "Remove-Item", "Clear-", "Uninstall-", "Format-Volume", "Restart-Computer",
      "Stop-Computer", "Enable-BitLocker", "Install-WindowsUpdate", "Reset-",
      "Set-ExecutionPolicy", "Invoke-WebRequest", "Invoke-Expression",
    ]) {
      expect(script, `le script contient ${verbe}`).not.toContain(verbe);
    }
  });

  it("ne perd aucun constat en route", () => {
    // Tout constat est soit automatise, soit renvoye en consigne. Aucun ne
    // disparait en silence: un defaut oublie est un defaut qui reste.
    const codes = ["antivirus_inactif", "disque_plein", "memoire_juste", "code_inconnu"];
    const r = construireRemise(codes.map(constat));
    const traites = [...r.etapes.map((e) => e.code), ...r.aLaMain.map((a) => a.code)];
    expect(traites.sort()).toEqual(codes.sort());
  });
});

describe("de bout en bout, depuis un vrai rapport", () => {
  const posteAbime: RapportPoste = {
    os: { nom: "Windows 11 Pro" },
    dernierDemarrage: new Date(MAINTENANT.getTime() - 3 * 86400000).toISOString(),
    derniereMaj: new Date(MAINTENANT.getTime() - 10 * 86400000).toISOString(),
    disques: [{ lettre: "C:", totalGo: 500, libreGo: 200 }],
    memoireGo: 16,
    antivirus: { nom: "Microsoft Defender", actif: false, signaturesAJour: true },
    parefeu: { actif: false },
    chiffrementDisque: { actif: false },
    sauvegarde: { configuree: true, derniereLe: new Date(MAINTENANT.getTime() - 1 * 86400000).toISOString() },
  };

  it("automatise ce qui peut l'etre et ecrit le reste", () => {
    const diag = analyserPoste(posteAbime, MAINTENANT);
    const r = construireRemise(diag.constats);

    // Antivirus et pare-feu: automatises.
    expect(r.etapes.map((e) => e.code).sort()).toEqual(["antivirus_inactif", "parefeu_inactif"]);
    // Chiffrement: consigne ecrite, jamais scripte.
    expect(r.aLaMain.map((a) => a.code)).toContain("disque_non_chiffre");
  });

  it("ne produit aucun script quand il n'y a rien a faire", () => {
    const sain = analyserPoste(
      { ...posteAbime, antivirus: { actif: true, signaturesAJour: true }, parefeu: { actif: true }, chiffrementDisque: { actif: true } },
      MAINTENANT,
    );
    const r = construireRemise(sain.constats);
    expect(r.script).toBeNull();
    expect(r.etapes).toEqual([]);
    expect(r.aLaMain).toEqual([]);
  });
});

describe("ce qu'un rapport reel a appris", () => {
  it("ne repete pas la meme consigne pour deux disques pleins", () => {
    // Trouve en lancant le script sur une vraie machine: elle avait DEUX
    // disques a plus de 97 %, donc deux constats `disque_plein`. La liste
    // affichait deux fois la meme phrase, et l'interface recevait deux cles
    // React identiques. Aucune fixture ne le montrait: les machines de test
    // n'ont qu'un disque.
    const r = construireRemise([constat("disque_plein"), constat("disque_plein")]);
    expect(r.aLaMain).toHaveLength(1);
    expect(r.aLaMain[0].code).toBe("disque_plein");
  });

  it("garde une consigne par code, meme melangees", () => {
    const r = construireRemise([
      constat("disque_plein"),
      constat("maj_anciennes"),
      constat("disque_plein"),
    ]);
    expect(r.aLaMain.map((a) => a.code)).toEqual(["disque_plein", "maj_anciennes"]);
  });
});
