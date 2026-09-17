/**
 * Import CSV de contacts : lecture d'une ligne et detection des doublons.
 *
 * Mesure le 17/09 sur la base locale :
 * - le telephone est obligatoire en base : toute ligne sans numero echouait
 *   et etait rapportee « doublon ou erreur », sans dire pourquoi ;
 * - importer deux fois le meme fichier doublait tout le carnet ;
 * - une categorie inconnue (« VIP », « Client fidele ») etait enregistree telle
 *   quelle et sortait de tous les filtres ;
 * - une ligne qui n'etait pas un objet faisait un 500 et annulait le rapport.
 */

export const CATEGORIES_CONTACT = ["client", "prospect", "fournisseur", "partenaire", "autre"] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function champ(ligne: Record<string, unknown>, cles: string[]): string {
  for (const cle of cles) {
    const v = ligne[cle];
    // Texte ou nombre seulement : un objet donnait « [object Object] ».
    if ((typeof v === "string" || typeof v === "number") && String(v).trim() !== "") return String(v).trim().slice(0, 1000);
  }
  return "";
}

/** Chiffres significatifs d'un numero (9 derniers : 06… et +33 6… se rejoignent). */
export function cleTelephone(tel: string | null | undefined): string {
  const chiffres = String(tel ?? "").replace(/\D/g, "");
  return chiffres.length >= 9 ? chiffres.slice(-9) : chiffres;
}

export function cleEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

/** Sans accents ni casse, pour reconnaitre « Catégorie : Fournisseur ». */
function normaliser(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export type LigneLue =
  | {
      ok: true;
      valeurs: { firstName: string; lastName: string; email: string | null; phone: string; company: string | null; notes: string | null; category: string };
      avertissements: string[];
    }
  | { ok: false; erreur: string };

export function lireLigneContact(ligne: unknown): LigneLue {
  if (!ligne || typeof ligne !== "object" || Array.isArray(ligne)) return { ok: false, erreur: "ligne illisible" };
  const l = ligne as Record<string, unknown>;
  const firstName = champ(l, ["firstName", "prenom", "Prénom", "Prenom"]);
  const lastName = champ(l, ["lastName", "nom", "Nom"]);
  if (!firstName && !lastName) return { ok: false, erreur: "prénom et nom vides" };
  const phone = champ(l, ["phone", "telephone", "téléphone", "Téléphone", "Telephone", "Tel", "tel", "mobile", "Mobile"]);
  if (cleTelephone(phone).length < 9) return { ok: false, erreur: "téléphone manquant ou incomplet" };

  const avertissements: string[] = [];
  let email: string | null = champ(l, ["email", "Email", "E-mail", "mail"]) || null;
  if (email && !EMAIL.test(email)) {
    avertissements.push(`email « ${email.slice(0, 60)} » ignoré (invalide)`);
    email = null;
  }
  const categorieSaisie = normaliser(champ(l, ["category", "categorie", "Catégorie", "Categorie"]));
  let category = "client";
  if (categorieSaisie) {
    const trouvee = CATEGORIES_CONTACT.find((c) => c === categorieSaisie);
    if (trouvee) category = trouvee;
    else {
      category = "autre";
      avertissements.push(`catégorie « ${categorieSaisie.slice(0, 40)} » inconnue, classée « autre »`);
    }
  }
  return {
    ok: true,
    valeurs: {
      firstName: firstName || "-",
      lastName: lastName || "-",
      email,
      phone,
      company: champ(l, ["company", "entreprise", "Entreprise", "Société", "Societe"]) || null,
      notes: champ(l, ["notes", "Notes"]) || null,
      category,
    },
    avertissements,
  };
}
