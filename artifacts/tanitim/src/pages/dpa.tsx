import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";

/**
 * Accord de sous-traitance (DPA), article 28 du RGPD.
 *
 * Pourquoi ce document est obligatoire, et pas facultatif. Le client est
 * responsable du traitement des donnees qu'il depose dans la plateforme — ses
 * contacts, ses salaries, ses appels; l'editeur ne fait que les traiter pour
 * son compte. L'article 28.3 exige alors un contrat ecrit, faute de quoi le
 * client lui-meme est en infraction. C'est aussi la premiere piece que reclame
 * le service achats d'un acheteur professionnel.
 *
 * Il manquait, alors que la page d'accueil affirmait le fournir.
 *
 * PROJET A FAIRE RELIRE PAR UN CONSEIL. Les faits techniques ci-dessous
 * (chiffrement, hebergement, sous-traitants ulterieurs, durees) sont tires du
 * depot et de la politique de confidentialite deja publiee, pas supposes — mais
 * un document contractuel engage la societe, et sa relecture juridique reste
 * un acte distinct de sa redaction.
 *
 * La distinction de l'annexe 1 est la partie qui demandait le plus de soin: les
 * fournisseurs de telephonie sont raccordes avec les identifiants PROPRES du
 * client (tables `email_providers`, `ai_providers`, `integration_connections`,
 * par organisation), ils ne sont donc pas sous-traitants de l'editeur. Les cles
 * de plateforme (RESEND_API_KEY, GEMINI_API_KEY...) le sont. Confondre les deux
 * ferait porter a l'editeur une responsabilite qui n'est pas la sienne, ou
 * l'inverse.
 */
export default function DPA() {
  // Les autres pages legales nomment cet etat `demoOpen` sans jamais le lire —
  // la Navbar n'a besoin que du setter. Ne pas le nommer ici evite d'ajouter un
  // avertissement de plus au stock que la CI a justement fige.
  const [, setDemoOpen] = useState(false);
  useDocumentMeta(PAGE_META.dpa);
  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main id="contenu" className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Accord de sous-traitance (DPA)</h1>
        <p className="text-muted-foreground mb-10">Dernière mise à jour : 3 septembre 2026</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Objet</h2>
            <p>
              Le présent accord encadre le traitement des données à caractère
              personnel effectué par <strong>SK GROUP</strong> (l'« éditeur »)
              pour le compte du client dans le cadre de la fourniture de la
              plateforme <strong>Ajant Bureau</strong>. Il complète les
              Conditions Générales d'Utilisation et de Vente et prévaut sur
              elles pour tout ce qui touche à la protection des données.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Rôle des parties</h2>
            <p>
              Le client est <strong>responsable du traitement</strong> : il
              détermine les finalités et les moyens du traitement des données
              qu'il dépose dans la plateforme. L'éditeur agit en qualité de{" "}
              <strong>sous-traitant</strong> et ne traite ces données que sur
              instruction documentée du client, l'utilisation du service valant
              instruction initiale.
            </p>
            <p className="mt-2">
              L'éditeur reste responsable de traitement pour les données qui lui
              sont propres : compte client, facturation, journaux de sécurité.
              Ces traitements sont décrits dans la politique de confidentialité.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Description du traitement</h2>
            <p>
              <strong>Nature et finalité :</strong> hébergement, stockage,
              consultation, organisation et restitution des données déposées,
              aux fins de fournir les fonctions de la plateforme (gestion de la
              relation client, tâches, documents, téléphonie, facturation,
              assistance par intelligence artificielle).
            </p>
            <p className="mt-2">
              <strong>Catégories de personnes concernées :</strong> les
              utilisateurs du client (salariés, collaborateurs) et les personnes
              dont il enregistre les données (contacts, prospects, clients
              finaux, interlocuteurs téléphoniques).
            </p>
            <p className="mt-2">
              <strong>Catégories de données :</strong> données d'identification
              et de contact, données professionnelles, contenus déposés
              (documents, notes, messages), métadonnées et enregistrements
              d'appels lorsque cette fonction est activée, données de connexion
              (adresse IP, agent utilisateur, horodatage).
            </p>
            <p className="mt-2">
              <strong>Durée :</strong> celle de l'abonnement, augmentée des
              durées de conservation indiquées à l'article 8.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Obligations de l'éditeur</h2>
            <p>
              L'éditeur s'engage à ne traiter les données que sur instruction du
              client ; à informer le client s'il estime qu'une instruction
              constitue une violation du RGPD ; à garantir que les personnes
              autorisées à traiter les données sont soumises à une obligation de
              confidentialité ; et à ne pas transférer les données hors de
              l'Union européenne en dehors du cadre prévu à l'article 9.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Sécurité</h2>
            <p>
              L'éditeur met en œuvre les mesures techniques et organisationnelles
              prévues à l'article 32 du RGPD, décrites à l'annexe 2. Elles sont
              susceptibles d'évoluer, sans que le niveau de sécurité puisse être
              abaissé pendant la durée du contrat.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Sous-traitants ultérieurs</h2>
            <p>
              Le client autorise l'éditeur à recourir aux sous-traitants
              ultérieurs listés à l'annexe 1. L'éditeur leur impose par contrat
              des obligations de protection équivalentes aux présentes et
              demeure pleinement responsable de leur exécution.
            </p>
            <p className="mt-2">
              Toute adjonction ou remplacement est notifiée au client avec un
              préavis de trente (30) jours, pendant lequel le client peut s'y
              opposer pour un motif légitime tenant à la protection des données.
              À défaut de solution, le client peut résilier sans frais.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Assistance au client</h2>
            <p>
              <strong>Droits des personnes :</strong> la plateforme permet au
              client d'exercer lui-même l'accès, la rectification, l'export et
              l'effacement depuis son espace. Lorsqu'une demande ne peut être
              satisfaite par ces fonctions, l'éditeur y prête assistance dans un
              délai raisonnable.
            </p>
            <p className="mt-2">
              <strong>Violation de données :</strong> l'éditeur notifie le client
              dans les meilleurs délais et au plus tard soixante-douze (72)
              heures après en avoir pris connaissance, en lui communiquant les
              éléments nécessaires à sa propre notification à la CNIL.
            </p>
            <p className="mt-2">
              L'éditeur assiste également le client, compte tenu des informations
              dont il dispose, pour la sécurité des traitements, les analyses
              d'impact et la consultation préalable (articles 32 à 36).
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">8. Sort des données en fin de contrat</h2>
            <p>
              À la résiliation, le client dispose de trente (30) jours pour
              exporter ses données depuis son espace, dans un format structuré
              et lisible par machine. Passé ce délai, l'éditeur les efface, sous
              réserve des conservations imposées par la loi : données de
              facturation pendant dix (10) ans au titre des obligations
              comptables, et journaux d'audit de sécurité, rendus inaltérables
              par conception, conservés de manière permanente.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. Transferts hors Union européenne</h2>
            <p>
              Les données sont hébergées dans l'Union européenne. Certains
              sous-traitants ultérieurs listés à l'annexe 1 peuvent traiter des
              données depuis un pays tiers ; ces transferts sont encadrés par
              les Clauses Contractuelles Types de la Commission européenne,
              assorties le cas échéant de mesures supplémentaires.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">10. Audit</h2>
            <p>
              L'éditeur met à la disposition du client les informations
              nécessaires pour démontrer le respect des présentes. Le client peut
              demander un audit une fois par période de douze (12) mois,
              moyennant un préavis raisonnable, à ses frais, sans perturbation du
              service ni accès aux données d'autres clients.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">Annexe 1 — Sous-traitants ultérieurs</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Google Cloud EMEA Limited</strong> — hébergement de
                l'application et de la base de données, sauvegardes. Union
                européenne.
              </li>
              <li>
                <strong>Resend</strong> — envoi des e-mails transactionnels
                (activation de compte, notifications, récapitulatifs).
                États-Unis, sous Clauses Contractuelles Types.
              </li>
              <li>
                <strong>Cloudflare</strong> — résolution DNS et acheminement des
                e-mails entrants du domaine. Réseau mondial, sous Clauses
                Contractuelles Types.
              </li>
              <li>
                <strong>
                  Fournisseurs de modèles d'intelligence artificielle
                </strong>{" "}
                (Google, Anthropic, OpenAI selon la configuration) — traitement
                des contenus soumis aux fonctions d'assistance par IA.
                Sous-traitants de l'éditeur <em>uniquement</em> lorsque le client
                utilise les clés de la plateforme. Lorsque le client renseigne
                ses propres clés, il contracte directement avec le fournisseur,
                qui devient son propre sous-traitant.
              </li>
            </ul>
            <p className="mt-3">
              Les fournisseurs de téléphonie et de messagerie (Twilio, Telnyx,
              Plivo, Vonage, Sinch, Bandwidth) ne sont pas des sous-traitants de
              l'éditeur : ils sont raccordés au moyen des identifiants propres du
              client, qui contracte directement avec eux.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">Annexe 2 — Mesures de sécurité</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Chiffrement des flux en transit (TLS, HSTS avec préchargement).</li>
              <li>
                Chiffrement des secrets au repos (AES-256-GCM) : identifiants de
                fournisseurs, jetons d'accès, sauvegardes exportées.
              </li>
              <li>
                Cloisonnement des locataires : chaque requête porte le filtre de
                l'organisation, vérifié à chaque construction par un contrôle
                automatisé qui fait échouer la livraison en cas d'oubli.
              </li>
              <li>
                Journaux d'audit inaltérables : les actions sensibles (connexion,
                export, suppression, changement de droits) sont rendues non
                modifiables et non supprimables par des déclencheurs de base de
                données.
              </li>
              <li>
                Contrôle d'accès par rôle, authentification à double facteur
                disponible, limitation du débit et bannissement des adresses
                abusives.
              </li>
              <li>
                Sauvegardes chiffrées quotidiennes avec restauration à un instant
                précis.
              </li>
              <li>
                Analyse antivirale et vérification de réputation des fichiers
                déposés.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">Contact</h2>
            <p>
              Pour toute question relative au présent accord ou à la protection
              des données :{" "}
              <a href="mailto:privacy@agentdebureau.fr" className="text-primary underline">
                privacy@agentdebureau.fr
              </a>
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
