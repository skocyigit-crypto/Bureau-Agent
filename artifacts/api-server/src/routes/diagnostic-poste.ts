/**
 * Reception d'un rapport de diagnostic de poste.
 *
 * Le rapport est produit par `outils/diagnostic-poste.ps1`, que le client
 * execute LUI-MEME sur sa machine. Ce script ne communique avec personne: il
 * ecrit un fichier sur le Bureau. C'est le client qui decide ensuite de
 * l'envoyer, apres l'avoir lu s'il le souhaite.
 *
 * Cette route est donc le seul point de contact, et elle ne fait que LIRE ce
 * qu'on lui donne. Il n'existe aucun canal en sens inverse: rien, dans ce
 * produit, ne peut executer quoi que ce soit sur le poste d'un client.
 *
 * Ce que la CNIL exige d'une telemaintenance et que l'on retrouve ici:
 *
 *   - un accord prealable PAR OPERATION: il n'y a pas d'operation sans que le
 *     client ait lance le script;
 *   - un registre horodate mentionnant la date, la nature detaillee de
 *     l'intervention et son auteur: chaque analyse est ecrite dans le journal
 *     d'audit, avec l'utilisateur qui l'a soumise;
 *   - la possibilite d'identifier la source de l'intervention: le journal est
 *     consultable par l'organisation elle-meme.
 *
 * Et ce qu'elle interdit, que l'on ne fait pas: le rapport ne contient aucune
 * mesure d'activite. Ni fichiers ouverts, ni sites visites, ni temps passe.
 * Detourner un outil de maintenance en surveillance du salarie ne respecte ni
 * le principe de proportionnalite ni celui de finalite.
 */
import { Router, type IRouter, type Request, type Response } from "express";

import { logAudit } from "./audit";
import { getOrgId } from "../middleware/tenant";
import { analyserPoste, type RapportPoste } from "../services/diagnostic-poste";

const router: IRouter = Router();

/**
 * Taille maximale d'un rapport accepte.
 *
 * La liste des logiciels installes peut etre longue sur un poste ancien, mais
 * pas illimitee. Le plafond protege la memoire du serveur d'un rapport
 * fabrique.
 */
const MAX_LOGICIELS = 2000;

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

router.post("/diagnostic-poste", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);

  const corps = req.body;
  if (!estObjet(corps)) {
    res.status(400).json({ error: "Rapport illisible: un objet JSON est attendu." });
    return;
  }

  // Le rapport vient d'un fichier que l'utilisateur a pu editer, ou d'une
  // machine qui a mal repondu. On borne ce qui peut l'etre, et on laisse
  // l'analyse traiter le reste comme « non mesure » plutot que d'echouer:
  // un rapport partiel vaut mieux que pas de diagnostic du tout.
  const rapport = corps as RapportPoste;
  if (Array.isArray(rapport.logiciels) && rapport.logiciels.length > MAX_LOGICIELS) {
    res.status(400).json({
      error: `Rapport trop volumineux: ${rapport.logiciels.length} logiciels listes (maximum ${MAX_LOGICIELS}).`,
    });
    return;
  }

  const diagnostic = analyserPoste(rapport);

  // Registre. On journalise ce qui a ete CONSTATE, pas le rapport: le detail
  // du poste appartient au client, et un journal d'audit se conserve
  // longtemps. Les codes suffisent a retracer l'intervention.
  await logAudit(
    req.session?.userId,
    req.session?.userEmail,
    "diagnostic_poste_analyse",
    "poste_de_travail",
    undefined,
    {
      collecteLe: typeof rapport.collecteLe === "string" ? rapport.collecteLe : null,
      os: rapport.os?.nom ?? null,
      score: diagnostic.score,
      constats: diagnostic.constats.map((c) => c.code),
      nonMesure: diagnostic.nonMesure,
    },
    req.ip,
    req.get("user-agent"),
    orgId,
  );

  res.json(diagnostic);
});

export default router;
