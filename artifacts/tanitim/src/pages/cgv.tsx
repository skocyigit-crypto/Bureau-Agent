import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";

/**
 * Conditions Generales de Vente.
 *
 * Distinctes des CGU: les CGU regissent l'USAGE de la plateforme, les CGV
 * regissent la VENTE de l'abonnement — prix, duree, reconduction, resiliation,
 * paiement, responsabilite, reversibilite des donnees. Vendre un abonnement
 * sans CGV laisse ces points sans cadre contractuel.
 *
 * PROJET A FAIRE RELIRE PAR UN CONSEIL avant mise en ligne. Les marqueurs
 * `<< ... >>` sont des decisions commerciales qui n'appartiennent qu'a
 * l'editeur — elles ne peuvent pas etre devinees, et une valeur inventee dans
 * un document contractuel engage la societe.
 */
export default function CGV() {
  const [demoOpen, setDemoOpen] = useState(false);
  useDocumentMeta(PAGE_META.cgv);
  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main id="contenu" className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Conditions Générales de Vente</h1>
        <p className="text-muted-foreground mb-10">Dernière mise à jour : {"<< date de publication à completer >>"}</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Objet et champ d'application</h2>
            <p>
              Les présentes Conditions Générales de Vente (CGV) régissent la
              vente des abonnements à la plateforme SaaS <strong>Ajant Bureau</strong>,
              éditée par <strong>SK GROUP</strong> (SASU), dont les coordonnées
              figurent dans les mentions légales. Elles complètent les
              Conditions Générales d'Utilisation, qui régissent l'usage du
              service. En cas de contradiction, les CGV prévalent sur les CGU
              pour tout ce qui touche à la relation commerciale.
            </p>
            <p className="mt-2">
              Le service est destiné à des professionnels agissant dans le cadre
              de leur activité. Toute commande vaut acceptation sans réserve des
              présentes.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Abonnement et prix</h2>
            <p>
              Les prix en vigueur sont ceux affichés sur le site au jour de la
              commande, exprimés en euros hors taxes. La TVA applicable au taux
              en vigueur s'y ajoute. Les prix incluent l'hébergement, les mises
              à jour et le support dans les conditions décrites à l'article 6.
            </p>
            <p className="mt-2">
              <strong>Révision des prix :</strong> les prix peuvent être révisés.
              Toute révision est notifiée au client avec un préavis de{" "}
              {"<< préavis de révision tarifaire à decider (ex. 30 / 60 jours) >>"}.
              Le client qui refuse la révision peut résilier sans frais avant sa
              prise d'effet.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Durée, reconduction et résiliation</h2>
            <p>
              L'abonnement est souscrit pour une durée de{" "}
              {"<< durée d'engagement à decider (ex. mensuelle sans engagement / annuelle) >>"},
              reconduite tacitement pour la même durée sauf résiliation.
            </p>
            <p className="mt-2">
              <strong>Résiliation par le client :</strong> à tout moment depuis
              l'espace de gestion de l'abonnement, avec effet à la fin de la
              période en cours. Les sommes déjà réglées au titre de la période
              en cours restent dues.
            </p>
            <p className="mt-2">
              <strong>Résiliation par l'éditeur :</strong> en cas de manquement
              grave du client à ses obligations, notamment de paiement, après
              mise en demeure restée sans effet pendant quinze (15) jours.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Paiement</h2>
            <p>
              Le paiement s'effectue par prélèvement ou carte bancaire via notre
              prestataire de paiement, à échoir, à la date anniversaire de la
              souscription. Les factures sont émises et mises à disposition dans
              l'espace client.
            </p>
            <p className="mt-2">
              Conformément à l'article L441-10 du Code de commerce, tout retard
              de paiement entraîne de plein droit des pénalités calculées au
              taux d'intérêt appliqué par la Banque centrale européenne à son
              opération de refinancement la plus récente, majoré de dix points
              de pourcentage, ainsi qu'une indemnité forfaitaire pour frais de
              recouvrement de 40 €.
            </p>
            <p className="mt-2">
              En cas de non-paiement persistant, l'accès au service peut être
              suspendu après mise en demeure restée sans effet pendant quinze
              (15) jours.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Droit de rétractation</h2>
            <p>
              Le service étant destiné à des professionnels agissant dans le
              cadre de leur activité, le droit de rétractation du Code de la
              consommation ne s'applique pas de plein droit.
            </p>
            <p className="mt-2">
              <strong>Politique commerciale :</strong>{" "}
              {"<< période d'essai ou de remboursement à decider (ex. essai gratuit 14 jours / remboursement 30 jours / aucune) >>"}.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Disponibilité et support</h2>
            <p>
              L'éditeur met en œuvre les moyens nécessaires pour assurer la
              disponibilité du service, hors interruptions programmées de
              maintenance, notifiées à l'avance lorsque cela est possible, et
              hors cas de force majeure ou défaillance d'un prestataire tiers.
            </p>
            <p className="mt-2">
              <strong>Engagement de disponibilité :</strong>{" "}
              {"<< niveau de service à decider (ex. 99,5 % mensuel avec pénalités, ou aucun engagement chiffré) >>"}.
            </p>
            <p className="mt-2">
              Le support est joignable à{" "}
              <a href="mailto:support@agentdebureau.fr" className="text-primary underline">
                support@agentdebureau.fr
              </a>
              .
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Données du client et réversibilité</h2>
            <p>
              Le client reste seul propriétaire des données qu'il dépose sur la
              plateforme. L'éditeur agit en qualité de sous-traitant au sens du
              RGPD pour le traitement de ces données ; les conditions de ce
              traitement figurent dans la{" "}
              <a href="/confidentialite" className="text-primary underline">
                politique de confidentialité
              </a>
              .
            </p>
            <p className="mt-2">
              <strong>Réversibilité :</strong> le client peut exporter ses
              données à tout moment depuis la plateforme, dans un format
              structuré et lisible par machine. À l'issue de la résiliation, les
              données sont conservées puis supprimées selon les durées annoncées
              dans la politique de confidentialité.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">8. Responsabilité</h2>
            <p>
              L'éditeur est tenu d'une obligation de moyens. Sa responsabilité
              ne saurait être engagée en cas d'usage non conforme du service,
              de faute du client, de fait d'un tiers ou de force majeure.
            </p>
            <p className="mt-2">
              <strong>Plafond de responsabilité :</strong>{" "}
              {"<< plafond à decider (ex. montant des sommes versées sur les 12 derniers mois) >>"}.
              Les dommages indirects ne donnent lieu à aucune indemnisation.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. Propriété intellectuelle</h2>
            <p>
              La plateforme, son code, sa charte graphique et sa documentation
              demeurent la propriété exclusive de l'éditeur. L'abonnement confère
              un droit d'usage personnel, non exclusif et non cessible, pour la
              durée de l'abonnement.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">10. Droit applicable et litiges</h2>
            <p>
              Les présentes CGV sont soumises au droit français. En cas de
              litige, les parties rechercheront une solution amiable avant toute
              action contentieuse. À défaut d'accord, compétence est attribuée
              aux tribunaux du ressort du siège social de l'éditeur, sous
              réserve des règles impératives de compétence.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">11. Contact</h2>
            <p>
              Pour toute question relative aux présentes CGV :{" "}
              <a href="mailto:legal@agentdebureau.fr" className="text-primary underline">
                legal@agentdebureau.fr
              </a>
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
