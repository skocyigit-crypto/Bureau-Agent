/**
 * La declaration App Privacy doit decrire ce que l'application fait.
 *
 * Mesure le 17/09 : APP_STORE_LISTING.md declarait « Photos/medias : Non »
 * alors que l'application demande NSCameraUsageDescription et
 * NSPhotoLibraryUsageDescription, ouvre un selecteur sur quatre ecrans, et
 * televerse les images dans le dossier du client. Un ecart entre permissions
 * demandees et types declares est un motif de rejet courant (App Review
 * Guideline 5.1.1), et un defaut de transparence cote RGPD puisque ce tableau
 * est aussi l'etiquette publique de confidentialite.
 *
 * Ce test lit les permissions dans `app.json` et l'usage reel dans les ecrans :
 * recopier les valeurs ne verifierait que la copie.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = path.resolve(__dirname, "..");
const FICHE = fs.readFileSync(path.join(RACINE, "APP_STORE_LISTING.md"), "utf8");
const APP_JSON = fs.readFileSync(path.join(RACINE, "app.json"), "utf8");

/** La reponse « Collectee ? » d'une ligne du tableau App Privacy. */
function declaration(type: string): string {
  const ligne = FICHE.split("\n").find((l) => l.startsWith(`| ${type} `));
  if (!ligne) throw new Error(`ligne absente du tableau App Privacy : ${type}`);
  return ligne.split("|")[2]!.trim();
}

function ecransAvecSelecteurImage(): string[] {
  const dossier = path.join(RACINE, "app");
  const fichiers: string[] = [];
  const parcourir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) parcourir(p);
      else if (e.name.endsWith(".tsx") && /expo-image-picker/.test(fs.readFileSync(p, "utf8"))) fichiers.push(e.name);
    }
  };
  parcourir(dossier);
  return fichiers;
}

describe("declaration App Privacy", () => {
  it("l'application demande bien les permissions photo (sinon ce test compare le vide)", () => {
    expect(APP_JSON).toMatch(/NSCameraUsageDescription/);
    expect(APP_JSON).toMatch(/NSPhotoLibraryUsageDescription/);
  });

  it("au moins un ecran ouvre le selecteur d'images", () => {
    expect(ecransAvecSelecteurImage().length).toBeGreaterThan(0);
  });

  it("« Photos/medias » est declare collecte", () => {
    expect(
      declaration("Photos/medias"),
      "l'application photographie et televerse des justificatifs : la declaration doit dire Oui",
    ).toBe("Oui");
  });

  it("« Photos/medias » est declare lie a l'identite", () => {
    const ligne = FICHE.split("\n").find((l) => l.startsWith("| Photos/medias "))!;
    expect(ligne.split("|")[3]!.trim()).toBe("Oui");
  });

  it("la localisation precise reste declaree (le pointage l'utilise)", () => {
    expect(APP_JSON).toMatch(/NSLocationAlwaysAndWhenInUseUsageDescription/);
    expect(declaration("Localisation precise (GPS)")).toBe("Oui");
  });

  it("aucune permission iOS demandee n'est absente du tableau", () => {
    const attendus: Array<[RegExp, string]> = [
      [/NSCameraUsageDescription/, "Photos/medias"],
      [/NSPhotoLibraryUsageDescription/, "Photos/medias"],
      [/NSLocationAlwaysAndWhenInUseUsageDescription/, "Localisation precise (GPS)"],
      [/NSContactsUsageDescription/, "Contacts (carnet d'adresses)"],
    ];
    for (const [permission, type] of attendus) {
      if (!permission.test(APP_JSON)) continue;
      expect(declaration(type), `${type} : permission demandee mais declaration « Non »`).toBe("Oui");
    }
  });

  it("le carnet d'adresses n'est pas declare tant qu'aucune permission ne le demande", () => {
    if (/NSContactsUsageDescription/.test(APP_JSON)) return;
    expect(declaration("Contacts (carnet d'adresses)")).toBe("Non");
  });

  it("la justification photo cite les ecrans concernes", () => {
    const ecrans = ecransAvecSelecteurImage().map((f) => f.replace(/\.tsx$/, ""));
    for (const e of ecrans) {
      expect(FICHE, `l'ecran ${e} utilise le selecteur d'images et n'est pas cite dans la justification`).toContain(e);
    }
  });
});
