/**
 * Inscription publique : lecture du formulaire et slug d'organisation.
 *
 * Mesure le 17/09 sur la base locale :
 * - prenom de 150 caracteres (varchar 100), telephone de 40 (varchar 30) ou
 *   nom d'entreprise de 250 (varchar 200) -> 500 generique ;
 * - `orgName: 42` (nombre) -> 500 ; prenom fait d'espaces accepte ;
 * - « Électricité Durand » donnait le slug « lectricit-durand », et un nom en
 *   caracteres non latins (« بناء ») un slug vide ;
 * - deux inscriptions simultanees avec le meme email : la violation d'unicite
 *   etait prise pour une collision de cle de licence, retentee 4 fois, puis 500.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type SaisieInscription =
  | { ok: true; orgName: string; firstName: string; lastName: string; email: string; phone: string | null }
  | { ok: false; erreur: string; champ: string };

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

export function lireInscription(corps: Record<string, unknown>): SaisieInscription {
  const orgName = texte(corps.orgName);
  if (orgName.length < 2) return { ok: false, champ: "orgName", erreur: "Le nom de l'organisation est requis (minimum 2 caracteres)." };
  if (orgName.length > 200) return { ok: false, champ: "orgName", erreur: "Le nom de l'organisation est limite a 200 caracteres." };
  const firstName = texte(corps.firstName);
  const lastName = texte(corps.lastName);
  if (!firstName || !lastName) return { ok: false, champ: "firstName", erreur: "Le prenom et le nom sont requis." };
  if (firstName.length > 100 || lastName.length > 100) return { ok: false, champ: "lastName", erreur: "Prenom et nom : 100 caracteres au maximum." };
  const email = texte(corps.email).toLowerCase();
  if (!EMAIL.test(email) || email.length > 255) return { ok: false, champ: "email", erreur: "Une adresse email valide est requise." };
  const phone = texte(corps.phone);
  if (phone.length > 30) return { ok: false, champ: "phone", erreur: "Numero de telephone trop long." };
  return { ok: true, orgName, firstName, lastName, email, phone: phone || null };
}

/** Slug lisible : accents translitteres, repli « organisation » si rien ne reste. */
export function slugOrganisation(nom: string): string {
  const s = nom
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i").replace(/ß/g, "ss").replace(/[æ]/gi, "ae").replace(/[œ]/gi, "oe")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
  return s || "organisation";
}

/** Nom de la contrainte d'unicite violee (drizzle enveloppe l'erreur pg dans `cause`). */
export function contrainteUniciteViolee(err: unknown): string | null {
  for (let e: any = err, i = 0; e && i < 4; e = e.cause, i++) {
    if (e.code === "23505") return String(e.constraint ?? "");
  }
  return null;
}
