/**
 * Quatre defauts de l'application mobile, trouves par l'audit du 20/09.
 *
 *  1. Le formulaire d'edition d'un collaborateur proposait de corriger son
 *     ADRESSE. Le champ etait editable, envoye, et le serveur le filtre :
 *     `sanitiseUserPatch` ne laisse passer que nom, prenom, departement,
 *     telephone, actif, role et password — puis repond 200 avec l'utilisateur
 *     inchange. L'administrateur voyait le formulaire se fermer sans erreur, et
 *     l'ancienne adresse restait. C'est elle qui recoit les identifiants : on
 *     les expediait ensuite a la mauvaise boite en croyant l'avoir corrigee.
 *
 *  2. La branche d'EDITION de ce meme formulaire n'avait aucun traitement
 *     d'echec. Le cliquet des echecs silencieux ne l'avait pas vue parce qu'il
 *     cherche un `else` a quarante lignes de distance, et celui de la branche
 *     de CREATION suffisait a le rassurer.
 *
 *  3. `ETKI_COLORS[a.etki]` n'avait pas de repli. `etki` vient du modele, et
 *     le type est une promesse faite au compilateur, pas une verification : une
 *     valeur inattendue rendait `"undefined20"` en bordure et faisait retomber
 *     le libelle sur « impact faible ». Un responsable classait en dernier une
 *     action jugee urgente. Tous les autres tableaux du fichier ont ce repli.
 *
 *  4. Deux secrets vivaient dans AsyncStorage, qui n'est pas chiffre : le mot
 *     de passe vocal, en clair, et l'empreinte du PIN de confidentialite — un
 *     `String.hashCode` Java dont les dix mille PIN a quatre chiffres
 *     s'enumerent instantanement, et ou une simple COLLISION deverrouille.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MOBILE = join(import.meta.dirname, "..", "..");
const lire = (...p: string[]) => readFileSync(join(MOBILE, ...p), "utf8");

describe("l'adresse d'un collaborateur n'est proposee qu'a la creation", () => {
  const source = lire("app", "users.tsx");

  it("le champ n'apparait plus en edition", () => {
    expect(source, "le champ est de nouveau propose en edition").toMatch(
      /enEdition \? \[\] : \[\{ key: "email"/,
    );
  });

  it("et il n'est plus envoye au serveur", () => {
    // La borne est le debut de la branche de CREATION, pas le premier
    // `} else {` venu: depuis qu'un traitement d'echec a ete ajoute dans la
    // branche d'edition, ce marqueur y apparait aussi.
    const i = source.indexOf("if (editId) {");
    const bloc = source.slice(i, source.indexOf("const endpoint = formValues.password", i));
    expect(bloc, "l'adresse repart alors qu'elle sera filtree").not.toMatch(/email: formValues\.email/);
  });

  it("il reste propose a la creation", () => {
    // La corriger apres coup est impossible; ne plus pouvoir la SAISIR
    // rendrait l'ecran inutilisable.
    const i = source.indexOf("const endpoint = formValues.password");
    expect(source.slice(i, i + 900)).toMatch(/email: formValues\.email/);
  });

  it("l'adresse n'est exigee qu'a la creation", () => {
    // Le garde initial exigeait `formValues.email` dans les deux cas: sans
    // champ en edition, il aurait bloque l'envoi en silence.
    expect(source).toMatch(/if \(!editId && !formValues\.email\?\.trim\(\)\) return;/);
  });

  it("le serveur filtre toujours ce champ: c'est la raison du retrait", () => {
    // Si le serveur se mettait a l'accepter, le champ pourrait revenir — et
    // ce controle dirait qu'il faut le reexaminer.
    const garde = readFileSync(
      join(MOBILE, "..", "api-server", "src", "middleware", "tenant-guard.ts"),
      "utf8",
    );
    const i = garde.indexOf("ALLOWED_PATCH_FIELDS");
    expect(garde.slice(i, i + 200), "le serveur accepte desormais l'email").not.toMatch(/"email"/);
  });
});

describe("une modification qui echoue le dit", () => {
  const source = lire("app", "users.tsx");

  it("la branche d'edition traite l'echec", () => {
    const i = source.indexOf("if (editId) {");
    const bloc = source.slice(i, source.indexOf("const endpoint = formValues.password", i));
    expect(bloc, "le formulaire se ferme sans rien enregistrer ni rien dire").toMatch(/Alert\.alert\(/);
  });
});

describe("un impact inconnu ne devient pas « faible »", () => {
  const source = lire("app", "workforce-agent.tsx");

  it("le repli existe", () => {
    expect(source).toMatch(/function etkiConnu\(/);
  });

  it("il retombe sur « moyen », pas sur « faible »", () => {
    // En cas de doute, on ne minimise pas une action que le modele a pu juger
    // urgente.
    const i = source.indexOf("function etkiConnu(");
    expect(source.slice(i, i + 300)).toMatch(/: "orta";/);
  });

  it("l'affichage passe par ce repli", () => {
    expect(source).toMatch(/const etki = etkiConnu\(a\.etki\);/);
    const i = source.indexOf("const etki = etkiConnu(a.etki);");
    const bloc = source.slice(i, i + 700);
    expect(bloc, "la couleur est encore lue sur la valeur brute").not.toMatch(/ETKI_COLORS\[a\.etki\]/);
  });

  it("les autres tableaux du fichier gardent le leur", () => {
    // Le defaut etait d'etre le SEUL sans repli: si les autres le perdaient,
    // on aurait remplace un trou par quatre.
    for (const motif of [/RISK_CONFIG\[risk\] \?\?/, /DURUM_CONFIG\[[^\]]+\] \?\?/, /TREND_CONFIG\[[^\]]+\] \?\?/]) {
      expect(source, `repli manquant: ${motif}`).toMatch(motif);
    }
  });
});

describe("les secrets locaux vivent dans le coffre de l'appareil", () => {
  const coffre = lire("lib", "secret-local.ts");
  const voix = lire("app", "voice-assistant.tsx");
  const vie = lire("contexts", "PrivacyContext.tsx");

  it("le coffre s'adosse a expo-secure-store", () => {
    expect(coffre).toMatch(/from "expo-secure-store"/);
  });

  it("il est lisible ecran verrouille apres le premier deverrouillage", () => {
    // Le PIN et la phrase vocale sont lus au reveil de l'application, parfois
    // avant que l'utilisateur n'ait deverrouille l'appareil.
    expect(coffre).toMatch(/AFTER_FIRST_UNLOCK/);
  });

  it("il migre l'ancienne valeur puis efface le slot en clair", () => {
    expect(coffre).toMatch(/AsyncStorage\.removeItem\(cleLegacy\)/);
  });

  it("et il n'efface qu'APRES une ecriture reussie", () => {
    // L'inverse perdrait le secret si le coffre refuse.
    const i = coffre.indexOf("await SecureStore.setItemAsync(cle, ancien, OPTIONS);");
    const j = coffre.indexOf("await AsyncStorage.removeItem(cleLegacy);", i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });

  it("le mot de passe vocal n'est plus ecrit en clair", () => {
    expect(voix, "la phrase repart dans AsyncStorage").not.toMatch(/AsyncStorage\.setItem\(PASSPHRASE_KEY/);
    expect(voix).toMatch(/ecrireSecretLocal\(PASSPHRASE_KEY/);
  });

  it("ni relu depuis le stockage en clair", () => {
    expect(voix).toMatch(/lireSecretLocal\(PASSPHRASE_KEY\)/);
  });

  it("l'empreinte du PIN non plus", () => {
    expect(vie, "l'empreinte repart dans AsyncStorage").not.toMatch(/AsyncStorage\.setItem\(STORAGE_PIN_KEY/);
    expect(vie).toMatch(/ecrireSecretLocal\(STORAGE_PIN_KEY/);
    expect(vie).toMatch(/lireSecretLocal\(STORAGE_PIN_KEY\)/);
  });

  it("retirer le PIN l'efface des DEUX emplacements", () => {
    expect(vie).toMatch(/effacerSecretLocal\(STORAGE_PIN_KEY\)/);
    expect(coffre).toMatch(/deleteItemAsync/);
  });

  it("le commentaire ne pretend plus que l'empreinte suffit", () => {
    // « AsyncStorage n'est pas chiffre mais le PIN n'est pas en clair » etait
    // vrai au pied de la lettre et sans effet: une collision deverrouille.
    expect(vie).not.toMatch(/PIN açık metin değil/);
  });
});
