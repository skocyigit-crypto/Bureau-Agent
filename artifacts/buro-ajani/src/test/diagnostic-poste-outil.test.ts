import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le script de diagnostic, tel qu'il est reellement servi.
 *
 * Deux choses que rien d'autre ne verifierait.
 *
 * D'abord son EXISTENCE. La page propose un lien de telechargement; un lien
 * vers un fichier absent ne fait echouer aucun test de rendu. La page
 * s'afficherait, le bouton serait la, et le client recevrait une page 404 au
 * moment precis ou on lui demande de faire confiance.
 *
 * Ensuite son CONTENU. On demande a quelqu'un de lancer ce script sur sa
 * machine. La promesse faite a l'ecran — « il lit seulement, ne modifie rien
 * et ne se connecte a aucun serveur » — doit rester vraie dans le fichier.
 * Une seule ligne suffirait a la rendre fausse, et personne ne relit un
 * script PowerShell a chaque modification.
 */
const racine = resolve(import.meta.dirname, "../../../..");
const CHEMIN = "artifacts/buro-ajani/public/outils/diagnostic-poste.ps1";

describe("le script de diagnostic", () => {
  it("existe la ou la page le telecharge", () => {
    expect(existsSync(resolve(racine, CHEMIN)), `${CHEMIN} est absent`).toBe(true);
  });

  const script = existsSync(resolve(racine, CHEMIN))
    ? readFileSync(resolve(racine, CHEMIN), "utf8")
    : "";

  /** Le code hors commentaires: un commentaire qui NOMME une commande n'en execute aucune. */
  const code = script
    .replace(/<#[^]*?#>/g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  it("n'envoie rien nulle part", () => {
    // La promesse centrale: le fichier reste sur le poste, et c'est le client
    // qui decide de l'envoyer. Un seul appel reseau la briserait.
    for (const commande of [
      "Invoke-WebRequest",
      "Invoke-RestMethod",
      "curl",
      "wget",
      "Send-MailMessage",
      "New-Object Net.WebClient",
      "Start-BitsTransfer",
    ]) {
      expect(code, `le script appelle ${commande}`).not.toContain(commande);
    }
  });

  it("ne modifie rien sur le poste", () => {
    // « Lecture seule » doit se verifier, pas se promettre. Les verbes qui
    // ecrivent, suppriment, installent ou arretent n'ont rien a faire ici.
    for (const verbe of [
      "Set-ItemProperty",
      "Remove-Item",
      "New-Item",
      "Stop-Service",
      "Start-Service",
      "Set-Service",
      "Install-",
      "Uninstall-",
      "Set-MpPreference",
      "Enable-",
      "Disable-",
      "Restart-Computer",
      "Stop-Computer",
    ]) {
      expect(code, `le script utilise ${verbe}`).not.toContain(verbe);
    }
  });

  it("n'ecrit qu'un seul fichier, sur le Bureau", () => {
    // La seule ecriture autorisee est le rapport lui-meme.
    const ecritures = code.match(/Out-File|Set-Content|Add-Content|>>?\s*"/g) ?? [];
    expect(ecritures.length, `ecritures trouvees: ${ecritures.join(", ")}`).toBe(1);
    expect(code).toContain("GetFolderPath(\"Desktop\")");
  });

  it("ne lit aucun contenu personnel", () => {
    // L'etat technique, oui. Les documents, le courrier, l'historique de
    // navigation, non — c'est la limite que la CNIL pose entre maintenance et
    // surveillance de l'activite.
    // Les motifs sont PRECIS a dessein. Une premiere version interdisait le
    // mot « History » et echouait sur `FileHistory` — la fonctionnalite de
    // sauvegarde de Windows, que le script lit legitimement. Un test trop
    // large ne protege pas mieux: il apprend a etre contourne, ou pire, a
    // etre desactive.
    for (const zone of [
      "\\Documents",
      "Outlook",
      "Chrome\\User Data",
      "\\History",
      "Cookies",
      "Get-Content",
    ]) {
      expect(code, `le script touche a ${zone}`).not.toContain(zone);
    }
  });

  it("dit au lecteur ce qu'il fait, avant qu'il ne le lance", () => {
    // L'en-tete du script est la premiere chose que voit quelqu'un qui l'ouvre
    // avant de l'executer. C'est la que la promesse doit etre ecrite.
    const entete = script.slice(0, 2000);
    expect(entete).toMatch(/LIT|lecture seule/i);
    expect(entete).toMatch(/ne modifie rien/i);
    expect(entete).toMatch(/aucune connexion reseau/i);
  });
});

describe("le script doit s'executer sur un vrai Windows", () => {
  const script = readFileSync(resolve(racine, CHEMIN), "utf8");

  it("ne contient aucun caractere non-ASCII", () => {
    // Ce n'est pas une preference de style, c'est une condition d'execution.
    //
    // Windows PowerShell 5.1 — celui installe par defaut — lit un fichier
    // UTF-8 SANS BOM comme du Windows-1252. Le tiret cadratin « — » vaut
    // E2 80 94 en UTF-8; le dernier octet, 0x94, est un guillemet fermant en
    // CP1252. Il ouvre donc une chaine que rien ne ferme, et le script entier
    // refuse de demarrer:
    //
    //     Le terminateur " est manquant dans la chaine.
    //
    // Constate en lancant reellement le fichier: aucune relecture ne montre un
    // caractere qui change de sens selon l'encodage du lecteur, et aucun test
    // de contenu ne l'aurait vu non plus.
    const fautifs = [...script]
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.charCodeAt(0) > 127);

    expect(
      fautifs.map(({ c, i }) => `${JSON.stringify(c)} (position ${i})`),
      "ces caracteres empechent le script de demarrer sur Windows PowerShell 5.1",
    ).toEqual([]);
  });
});
