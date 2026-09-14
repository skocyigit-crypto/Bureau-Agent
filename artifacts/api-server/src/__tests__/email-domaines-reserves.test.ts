/**
 * Ne pas tenter d'envoyer a une adresse que la norme rend indelivrable.
 *
 * Mesure sur sept jours de journaux de production: le bilan quotidien partait
 * chaque matin vers `diag...@example.com` — un compte de demonstration reste
 * dans la base —, Resend le refusait, et le journal enregistrait « Aucun
 * provider n'a pu envoyer le message ». Quatorze fois.
 *
 * Le cout n'est pas l'appel perdu. C'est qu'un echec quotidien GARANTI apprend
 * a ne plus lire cette ligne: le jour ou un vrai envoi echoue — une relance de
 * facture, une reinitialisation de mot de passe — il arrive au milieu de ceux
 * qui n'ont jamais rien voulu dire.
 *
 * `example.com` et consorts sont reserves par les RFC 2606 et 6761 justement
 * pour ne jamais aboutir. Les essayer n'est pas prudent, c'est inutile.
 *
 * Le test insiste autant sur ce qui doit PASSER: une garde trop large qui
 * bloquerait un vrai client serait bien pire que le bruit qu'elle supprime.
 */
import { describe, expect, it } from "vitest";

import { adresseNonDelivrable } from "../services/email";

describe("les adresses que rien ne peut delivrer", () => {
  it.each([
    "diag703178439@example.com",
    "contact@example.org",
    "a@example.net",
    "essai@mon-site.example",
    "compte@integration.test",
    "quelqun@nowhere.invalid",
    "root@localhost",
    // La casse ne doit pas suffire a passer au travers.
    "DIAG@EXAMPLE.COM",
  ])("%s est refusee avant tout appel au fournisseur", (adresse) => {
    expect(adresseNonDelivrable(adresse)).toBe(true);
  });
});

describe("les adresses de vrais clients", () => {
  it.each([
    "s.kocyigit@crepistyle.fr",
    "contact@agentdebureau.fr",
    // Piege: contient « example » sans etre un domaine reserve. Une entreprise
    // peut tres bien s'appeler ainsi, et la lui refuser serait un defaut bien
    // plus grave que celui qu'on corrige.
    "devis@example-batiment.fr",
    "compte@testeur.fr",
    "jean@monentreprise.localhost.fr",
  ])("%s reste delivrable", (adresse) => {
    expect(adresseNonDelivrable(adresse)).toBe(false);
  });

  it("une adresse sans domaine ne declenche pas la garde", () => {
    // Une saisie incomplete est un probleme de validation, pas de delivrabilite:
    // la traiter ici masquerait l'erreur reelle.
    expect(adresseNonDelivrable("sans-arobase")).toBe(false);
  });
});
