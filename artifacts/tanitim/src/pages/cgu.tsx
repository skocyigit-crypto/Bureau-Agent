import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { useDocumentMeta } from "@/hooks/use-document-meta";

export default function CGU() {
  const [demoOpen, setDemoOpen] = useState(false);
  useDocumentMeta({
    title: "Conditions Générales d'Utilisation",
    description: "Conditions générales d'utilisation de la plateforme SaaS Agent de Bureau : accès, abonnement et responsabilités.",
    path: "/cgu",
  });
  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Conditions Générales d'Utilisation</h1>
        <p className="text-muted-foreground mb-10">Dernière mise à jour : janvier 2026</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Objet</h2>
            <p>Les présentes Conditions Générales d'Utilisation (CGU) régissent l'accès et l'utilisation de la plateforme SaaS <strong>Agent de Bureau</strong> éditée par Agent de Bureau SAS. En créant un compte, l'utilisateur accepte sans réserve les présentes CGU.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Description du service</h2>
            <p>Agent de Bureau est une solution de gestion professionnelle accessible par abonnement, comprenant notamment : CRM, centre d'appels, devis, facturation, gestion de stock, agents IA, messagerie et agenda. Le service est accessible depuis tout navigateur web et via l'application mobile.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Accès et inscription</h2>
            <p>L'inscription est ouverte à toute personne morale ou physique disposant de la capacité légale. L'utilisateur s'engage à fournir des informations exactes lors de l'inscription et à les maintenir à jour. Chaque compte est strictement personnel et ne peut être partagé.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Offres et tarification</h2>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>Essai gratuit</strong> : 14 jours sans engagement, aucune carte bancaire requise</li>
              <li><strong>Plan Starter</strong> : 29 €/mois HT — jusqu'à 5 utilisateurs</li>
              <li><strong>Plan Professionnel</strong> : 79 €/mois HT — jusqu'à 15 utilisateurs</li>
              <li><strong>Plan Entreprise</strong> : 199 €/mois HT — jusqu'à 100 utilisateurs</li>
            </ul>
            <p className="mt-3">Les prix s'entendent hors taxes. La TVA applicable est celle en vigueur en France au moment de la facturation. Les tarifs peuvent être modifiés avec un préavis de 30 jours.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Facturation et paiement</h2>
            <p>La facturation est mensuelle, en début de période. Les factures sont envoyées par email. En cas de dépassement des limites de votre plan, des frais de dépassement s'appliquent selon les tarifs en vigueur. Le défaut de paiement peut entraîner la suspension du service après mise en demeure.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Résiliation</h2>
            <p>L'utilisateur peut résilier son abonnement à tout moment depuis la page Paramètres {'>'} Abonnement. La résiliation prend effet à la fin de la période en cours. Aucun remboursement au prorata n'est effectué. Les données sont conservées 30 jours après résiliation, puis supprimées définitivement.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Données et confidentialité</h2>
            <p>Agent de Bureau SAS s'engage à protéger les données de ses clients conformément au RGPD. L'utilisateur reste propriétaire de ses données. Voir notre <a href="/confidentialite" className="text-primary underline">Politique de confidentialité</a> pour les détails.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">8. Disponibilité du service (SLA)</h2>
            <p>Agent de Bureau s'engage à maintenir une disponibilité du service de <strong>99,5 % mensuelle</strong>. Les maintenances planifiées sont annoncées 48h à l'avance. En cas de défaillance majeure, un crédit de service peut être accordé sur demande.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. Responsabilités</h2>
            <p>Agent de Bureau SAS est soumis à une obligation de moyens. Sa responsabilité ne saurait être engagée en cas de perte de données résultant d'une faute de l'utilisateur, d'une attaque informatique externe ou d'un cas de force majeure. La responsabilité d'Agent de Bureau est limitée au montant des abonnements versés au cours des 3 derniers mois.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">10. Droit applicable</h2>
            <p>Les présentes CGU sont soumises au droit français. En cas de litige, les parties s'efforceront de trouver une solution amiable. À défaut, les tribunaux compétents de Paris seront seuls compétents.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">11. Contact</h2>
            <p>Pour toute question relative aux CGU : <a href="mailto:legal@agentdebureau.fr" className="text-primary underline">legal@agentdebureau.fr</a></p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
