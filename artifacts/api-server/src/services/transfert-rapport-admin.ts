/**
 * Un rapport envoye au support doit ARRIVER au support.
 *
 * CE QUI ETAIT MESURE LE 17/09
 *
 * `POST /admin-reports` enregistrait le rapport, repondait 201, et s'arretait
 * la. Personne n'etait prevenu. Le super-admin ne voit, a dessein, que des
 * COMPTEURS (le contenu d'un client est protege). `PATCH /admin-reports/:id`
 * repond toujours 403. Aucune ecriture de `adminResponse` n'existe.
 *
 * Un administrateur client pouvait donc signaler « securite / urgente » et
 * attendre une reponse que rien, dans le produit, ne pouvait produire.
 *
 * LA REGLE
 *
 * Le client ADRESSE ce rapport au support : le transmettre au support n'est
 * pas lire son contenu a son insu, c'est faire ce qu'il a demande. On le
 * depose dans la file d'approbation du support — la meme que les e-mails a
 * support@ — ou la reponse part par e-mail, a l'adresse de l'auteur. La
 * protection du reste des donnees client est inchangee.
 */
import type { IncomingSupportEmail } from "./support-inbox";

export const LONGUEUR_MAX_SUJET = 300; // = varchar(300) : au-dela, l'insertion levait une 500
export const LONGUEUR_MAX_MESSAGE = 10_000;

export interface RapportATransmettre {
  id: number;
  userEmail: string;
  userName: string;
  orgName: string;
  subject: string;
  message: string;
  category: string;
  priority: string;
}

/** Priorite de la file support. Securite et urgence ne tombent jamais en « basse ». */
export function prioriteSupport(category: string, priority: string): "haute" | "moyenne" | "basse" {
  if (category === "securite" || priority === "urgente" || priority === "haute") return "haute";
  if (priority === "basse") return "basse";
  return "moyenne";
}

export function versEmailSupport(r: RapportATransmettre): IncomingSupportEmail {
  return {
    from: r.userEmail,
    fromName: r.userName,
    to: "support@agentdebureau.fr",
    subject: `[Rapport ${r.category}/${r.priority}] ${r.subject}`,
    text: `Organisation : ${r.orgName}\nCategorie : ${r.category}\nPriorite : ${r.priority}\n\n${r.message}`,
    // Stable : un rejeu ne cree pas deux propositions (dedoublonnage par sourceRef).
    messageId: `admin-report-${r.id}`,
  };
}
