/**
 * Le champ « code de verification » accepte aussi un code de secours.
 *
 * Cote serveur, un code de secours ouvre la session comme un TOTP. Cote ecran,
 * le champ filtrait les lettres et coupait a six caracteres : le code de
 * secours etait impossible a saisir, et la fonction inatteignable depuis
 * l'application. Le serveur seul n'etait donc pas une preuve.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  estCodeSecours, estCodeTotp, normaliserSaisieCode, saisieCodeComplete,
} from "@/lib/code-second-facteur";

describe("ce que le champ laisse taper", () => {
  it("les six chiffres d'une application d'authentification", () => {
    expect(normaliserSaisieCode("123456")).toBe("123456");
  });

  it("un code de secours, tiret compris", () => {
    expect(normaliserSaisieCode("ABCDE-FGHJK")).toBe("ABCDE-FGHJK");
  });

  it("en minuscules et avec des espaces, tel qu'il est recopie d'un papier", () => {
    expect(normaliserSaisieCode("abcde fghjk")).toBe("abcde fghjk");
  });

  it("ecarte ce qui n'a rien a y faire", () => {
    expect(normaliserSaisieCode("12<script>34")).toBe("12script34");
    expect(normaliserSaisieCode("A@B#C$D")).toBe("ABCD");
  });

  it("borne la saisie a douze caracteres", () => {
    expect(normaliserSaisieCode("ABCDE-FGHJK-XXXXX")).toHaveLength(12);
  });
});

describe("quand le bouton s'active", () => {
  it("sur six chiffres", () => {
    expect(saisieCodeComplete("123456")).toBe(true);
  });

  it("sur un code de secours, quelle que soit son ecriture", () => {
    for (const s of ["ABCDE-FGHJK", "abcde-fghjk", "ABCDEFGHJK", "abcde fghjk"]) {
      expect(saisieCodeComplete(s), s).toBe(true);
    }
  });

  it("pas sur une saisie incomplete", () => {
    for (const s of ["", "12345", "ABCDE", "ABCDE-FGH"]) {
      expect(saisieCodeComplete(s), s).toBe(false);
    }
  });

  it("pas sur un code de secours trop long", () => {
    expect(saisieCodeComplete("ABCDE-FGHJKM")).toBe(false);
  });

  it("distingue les deux natures de code", () => {
    // La regeneration exige un TOTP : l'ecran doit pouvoir les separer.
    expect(estCodeTotp("123456")).toBe(true);
    expect(estCodeTotp("ABCDE-FGHJK")).toBe(false);
    expect(estCodeSecours("ABCDE-FGHJK")).toBe(true);
    expect(estCodeSecours("123456")).toBe(false);
  });

  it("refuse les caracteres que le serveur n'emet jamais (0/O, 1/I/L)", () => {
    // L'alphabet des codes de secours les exclut pour eviter les confusions a
    // la recopie ; une saisie qui en contient n'est pas un code de secours.
    expect(estCodeSecours("ABCDE-FGHI0")).toBe(false);
    expect(estCodeSecours("ABCDE-FGHJL")).toBe(false);
  });
});

describe("les ecrans appliquent cette regle, et non la leur", () => {
  const SRC = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");

  it("la connexion", () => {
    const s = SRC("pages", "login.tsx");
    // Le champ lui-meme, pas seulement l'import : un ecran qui importe la
    // regle sans l'appeler laisse passer l'ancien filtre.
    expect(s).toContain("setTotpCode(normaliserSaisieCode(e.target.value))");
    expect(s).toContain("saisieCodeComplete(totpCode)");
    expect(s, "l'ancien filtre chiffres-seulement").not.toMatch(/setTotpCode\(e\.target\.value\.replace\(\/\\D\//);
  });

  it("l'ecran de securite", () => {
    const s = SRC("pages", "settings", "tab-securite.tsx");
    // Les deux champs de l'ecran : activation et desactivation.
    expect((s.match(/setTotpCode\(normaliserSaisieCode\(e\.target\.value\)\)/g) ?? []).length).toBe(2);
    expect(s, "l'ancien filtre chiffres-seulement").not.toMatch(/setTotpCode\(e\.target\.value\.replace\(\/\\D\//);
  });

  it("l'ecran mobile", () => {
    // Paquet separe : la regle y est recopiee, donc on verifie qu'elle dit la
    // meme chose — pas de champ limite a six chiffres.
    const s = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "mobile", "app", "login.tsx"), "utf8",
    );
    expect(s).toMatch(/\[\^0-9A-Za-z -\]/);
    expect(s).toContain("maxLength={12}");
    expect(s).toContain("recoveryHint");
  });
});
