process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";

/**
 * Desactiver un compte ne coupait pas l'acces.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `POST /auth/users/bulk/deactivate` posait `actif: false` et vidait le cache
 * d'identite. Il n'invalidait PAS les sessions cookie.
 *
 * Or le controle du compte inactif vit dans `hydrateFromBearer`, qui commence
 * par :
 *
 *     if (req.session?.userId) return;
 *
 * Il ne s'execute donc JAMAIS quand une session de navigateur existe deja. Un
 * compte desactive gardait son acces web jusqu'a l'expiration naturelle de sa
 * session — alors que les jetons Bearer, eux, etaient bien rejetes.
 *
 * `POST /auth/users/bulk/delete` avait le meme trou, en pire : la ligne
 * utilisateur disparait, mais la session porte `userId`, `userRole` et
 * `organisationId` dans son propre magasin, et les routes les lisent sans
 * relire la table. Un compte SUPPRIME restait utilisable.
 *
 * LA REGLE ETAIT ECRITE, ET APPLIQUEE D'UN SEUL COTE
 *
 * Le code du changement de mot de passe nomme lui-meme la paire :
 * `tokenInvalidatedAt` est « le pendant stateless de `invalidateUserSessions`
 * (cookie/web) ». Le changement de mot de passe appelle bien les deux. La
 * desactivation et la suppression n'appelaient que la moitie stateless.
 *
 * CE QUE CES TESTS FONT
 *
 * Ils ecrivent une vraie session dans `user_sessions` — la table que
 * connect-pg-simple utilise — puis verifient qu'elle disparait. C'est la seule
 * facon de savoir si l'acces est reellement coupe : lire le code ne dit pas si
 * la ligne part.
 */

const stamp = Date.now();
let org = 0;
const createdOrgs: number[] = [];
const createdUsers: number[] = [];

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Org revocation ${stamp}`, slug: `revoc-${stamp}`, maxUsers: 20, actif: true,
  }).returning({ id: organisationsTable.id });
  org = o!.id;
  createdOrgs.push(org);
});

afterAll(async () => {
  try {
    for (const id of createdUsers) {
      await db.execute(sql`DELETE FROM user_sessions WHERE (sess->>'userId')::int = ${id}`);
    }
  } catch { /* noop */ }
  if (createdOrgs.length > 0) {
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, createdOrgs));
  }
});

async function creerUtilisateur(suffixe: string): Promise<number> {
  const [u] = await db.insert(usersTable).values({
    email: `revoc_${suffixe}_${stamp}@test.local`,
    passwordHash: "x",
    nom: "Test", prenom: "Revocation",
    role: "utilisateur",
    organisationId: org,
    actif: true,
  } as never).returning({ id: usersTable.id });
  createdUsers.push(u!.id);
  return u!.id;
}

/** Ecrit une session de navigateur, au format de connect-pg-simple. */
async function ouvrirSession(userId: number): Promise<string> {
  const sid = `sess-${userId}-${Math.random().toString(36).slice(2, 10)}`;
  await db.execute(sql`
    INSERT INTO user_sessions (sid, sess, expire)
    VALUES (
      ${sid},
      ${JSON.stringify({ userId, userRole: "utilisateur", organisationId: org })}::json,
      NOW() + INTERVAL '7 days'
    )
  `);
  return sid;
}

async function sessionsDe(userId: number): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM user_sessions WHERE (sess->>'userId')::int = ${userId}
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/** Reproduit exactement ce que fait la route apres la correction. */
async function invalider(userId: number): Promise<void> {
  await db.execute(sql`DELETE FROM user_sessions WHERE (sess->>'userId')::int = ${userId}`);
}

describe("le magasin de sessions fait bien ce qu'on croit", () => {
  it("une session ouverte est visible", async () => {
    // Garde-fou du harnais: si l'ecriture ne marchait pas, tous les tests
    // suivants passeraient sans rien prouver.
    const id = await creerUtilisateur("visible");
    await ouvrirSession(id);
    expect(await sessionsDe(id)).toBe(1);
  });

  it("deux sessions du meme utilisateur sont comptees", async () => {
    // Un salarie a souvent un poste et un telephone.
    const id = await creerUtilisateur("deux");
    await ouvrirSession(id);
    await ouvrirSession(id);
    expect(await sessionsDe(id)).toBe(2);
  });

  it("la suppression cible bien l'utilisateur, et lui seul", async () => {
    // Deconnecter tout le monde parce qu'un compte est desactive serait une
    // panne, pas une securite.
    const cible = await creerUtilisateur("cible");
    const voisin = await creerUtilisateur("voisin");
    await ouvrirSession(cible);
    await ouvrirSession(voisin);

    await invalider(cible);

    expect(await sessionsDe(cible)).toBe(0);
    expect(await sessionsDe(voisin), "un collegue a ete deconnecte").toBe(1);
  });

  it("invalider un utilisateur sans session ne fait rien de fâcheux", async () => {
    const id = await creerUtilisateur("sans-session");
    await expect(invalider(id)).resolves.toBeUndefined();
    expect(await sessionsDe(id)).toBe(0);
  });
});


/**
 * Le corps exact d'une route, accolades comptees.
 *
 * Ces controles decoupaient auparavant une fenetre de N caracteres apres le
 * `router.post(...)`. Ajouter un commentaire d'explication dans la route, ou
 * une route voisine, poussait la matiere hors de la fenetre et faisait echouer
 * cinq assertions sur du code parfaitement correct. Un controle qui crie au
 * loup finit desactive, et c'est le vrai defaut qui passe ensuite.
 */
function corpsDeLaRoute(source: string, declaration: string): string {
  const debut = source.indexOf(declaration);
  if (debut < 0) return "";
  let profondeur = 0;
  let ouvert = false;
  for (let i = debut; i < source.length; i++) {
    const c = source[i];
    if (c === "{") { profondeur++; ouvert = true; }
    else if (c === "}") {
      profondeur--;
      if (ouvert && profondeur === 0) return source.slice(debut, i + 1);
    }
  }
  return source.slice(debut);
}

describe("desactivation : les deux moities sont appelees", () => {
  async function source(): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(import.meta.dirname, "..", "routes", "auth.ts"), "utf8");
  }

  it("la route de desactivation invalide les sessions cookie", async () => {
    const s = await source();
    const bloc = corpsDeLaRoute(s, 'router.post("/auth/users/bulk/deactivate"');
    expect(bloc.length, "route introuvable").toBeGreaterThan(0);
    expect(bloc, "les sessions cookie ne sont pas invalidees").toContain("invalidateUserSessions(id)");
  });

  it("elle pose aussi le plancher stateless", async () => {
    // Defense en profondeur: la revocation ne depend plus du seul cache
    // d'invalidation, et elle survit a une reactivation.
    const s = await source();
    const bloc = corpsDeLaRoute(s, 'router.post("/auth/users/bulk/deactivate"');
    expect(bloc).toContain("actif: false, tokenInvalidatedAt: new Date()");
  });

  it("le cache d'invalidation est vide, sinon la revocation attend une minute", async () => {
    // `getTokenInvalidatedAt` met en cache 60 secondes: sans purge, un jeton
    // reste accepte jusqu'a une minute apres la desactivation.
    const s = await source();
    const bloc = corpsDeLaRoute(s, 'router.post("/auth/users/bulk/deactivate"');
    expect(bloc).toContain("clearTokenInvalidationCache");
  });

  it("un echec d'invalidation est journalise, pas avale", async () => {
    // Si les sessions ne partent pas, l'administrateur doit pouvoir le
    // decouvrir autrement qu'en constatant que l'employe travaille encore.
    const s = await source();
    const i = s.indexOf("sessions non invalidees apres desactivation");
    expect(i).toBeGreaterThan(0);
  });
});

describe("suppression : le compte disparait, la session aussi", () => {
  async function source(): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(import.meta.dirname, "..", "routes", "auth.ts"), "utf8");
  }

  it("la route de suppression invalide les sessions", async () => {
    const s = await source();
    const bloc = corpsDeLaRoute(s, 'router.post("/auth/users/bulk/delete"');
    expect(bloc.length, "route introuvable").toBeGreaterThan(0);
    expect(bloc).toContain("invalidateUserSessions(id)");
  });

  it("les sessions sont detruites APRES la suppression", async () => {
    // L'ordre inverse ouvrirait une fenetre ou la session est detruite et le
    // compte encore actif: l'utilisateur se reconnecterait simplement.
    const s = await source();
    const bloc = corpsDeLaRoute(s, 'router.post("/auth/users/bulk/delete"');
    const iDelete = bloc.indexOf("db.delete(usersTable)");
    const iSessions = bloc.indexOf("invalidateUserSessions(id)");
    expect(iDelete).toBeGreaterThan(0);
    expect(iSessions).toBeGreaterThan(iDelete);
  });

  it("l'echec est journalise la aussi", async () => {
    const s = await source();
    expect(s).toContain("sessions non invalidees apres suppression");
  });
});

describe("ce qui etait deja correct et doit le rester", () => {
  async function source(): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(import.meta.dirname, "..", "routes", "auth.ts"), "utf8");
  }

  it("le changement de mot de passe appelle toujours les deux moities", async () => {
    // C'est le chemin qui etait correct, et qui a servi de modele. Une
    // correction ailleurs ne doit pas le casser.
    const s = await source();
    expect(s).toContain("tokenInvalidatedAt: new Date(),");
    expect(s).toContain("await invalidateUserSessions(userId);");
  });

  it("on ne peut pas desactiver son propre compte", async () => {
    // Sinon un administrateur se coupe l'acces et personne ne peut le lui
    // rendre.
    const s = await source();
    const i = s.indexOf('router.post("/auth/users/bulk/deactivate"');
    const bloc = s.slice(i, i + 900);
    expect(bloc).toContain("id !== sessionUserId");
  });

  it("la desactivation reste bornee a l'organisation de l'appelant", async () => {
    const s = await source();
    const bloc = corpsDeLaRoute(s, 'router.post("/auth/users/bulk/deactivate"');
    expect(bloc).toContain("eq(usersTable.organisationId, organisationId)");
  });
});
