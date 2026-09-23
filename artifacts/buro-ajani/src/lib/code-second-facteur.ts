/**
 * Ce que l'utilisateur tape dans le champ « code de verification ».
 *
 * Deux choses y passent : les six chiffres de l'application d'authentification,
 * et un code de secours (ABCDE-FGHJK) quand le telephone est perdu. Le champ
 * n'acceptait que des chiffres et coupait a six caracteres : un code de secours
 * n'y entrait tout simplement pas, et l'ecran de connexion restait sans issue.
 *
 * La regle vit ici, et non dans chaque ecran, pour que la connexion, la
 * desactivation et la regeneration l'appliquent a l'identique.
 */

/** Ce qu'on laisse taper : chiffres, lettres, espace et tiret, 12 au plus. */
export function normaliserSaisieCode(valeur: string): string {
  return valeur.replace(/[^0-9A-Za-z -]/g, "").slice(0, 12);
}

/** Un code a six chiffres, tel que le produit une application TOTP. */
export function estCodeTotp(valeur: string): boolean {
  return /^\d{6}$/.test(valeur.trim());
}

/** Un code de secours : dix caracteres, tirets et espaces ignores. */
export function estCodeSecours(valeur: string): boolean {
  return /^[A-HJKMNP-Za-hjkmnp-z2-9]{10}$/.test(valeur.replace(/[\s-]/g, ""));
}

/** Le bouton n'est actif que si la saisie peut etre un code. */
export function saisieCodeComplete(valeur: string): boolean {
  return estCodeTotp(valeur) || estCodeSecours(valeur);
}
