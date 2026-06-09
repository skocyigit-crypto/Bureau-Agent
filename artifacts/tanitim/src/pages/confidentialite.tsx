import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { useDocumentMeta } from "@/hooks/use-document-meta";

export default function Confidentialite() {
  const [demoOpen, setDemoOpen] = useState(false);
  useDocumentMeta({
    title: "Politique de confidentialité",
    description: "Comment Agent de Bureau collecte, protège et traite vos données personnelles, en conformité avec le RGPD.",
    path: "/confidentialite",
  });
  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Politique de confidentialité</h1>
        <p className="text-muted-foreground mb-10">Dernière mise à jour : janvier 2026 — Conforme RGPD</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Responsable du traitement</h2>
            <p>Agent de Bureau SAS, dont le siège est à Paris (France), est responsable du traitement de vos données personnelles collectées via la plateforme agentdebureau.fr.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Données collectées</h2>
            <p>Nous collectons les données suivantes :</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>Données d'identification</strong> : nom, prénom, adresse email, numéro de téléphone</li>
              <li><strong>Données professionnelles</strong> : nom de l'entreprise, SIRET, secteur d'activité</li>
              <li><strong>Données de connexion</strong> : adresse IP, logs de connexion, données de navigation</li>
              <li><strong>Données métier</strong> : contacts CRM, enregistrements d'appels, documents générés (devis, factures)</li>
              <li><strong>Données de paiement</strong> : coordonnées bancaires (traitées par notre prestataire de paiement)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Finalités du traitement</h2>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li>Fourniture et gestion du service SaaS</li>
              <li>Facturation et gestion de l'abonnement</li>
              <li>Support client et assistance technique</li>
              <li>Amélioration de la plateforme (données anonymisées)</li>
              <li>Envoi de communications relatives au service (avec consentement)</li>
              <li>Respect des obligations légales</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Base légale</h2>
            <p>Le traitement de vos données repose sur : l'exécution du contrat (CGU), votre consentement (communications marketing), nos obligations légales (comptabilité, TVA), et nos intérêts légitimes (sécurité, prévention de la fraude).</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Durée de conservation</h2>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>Données de compte</strong> : durée de l'abonnement + 3 ans après résiliation</li>
              <li><strong>Données de facturation</strong> : 10 ans (obligation légale comptable)</li>
              <li><strong>Données de log</strong> : 12 mois maximum</li>
              <li><strong>Enregistrements d'appels</strong> : selon paramétrage client (max. 12 mois par défaut)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Vos droits (RGPD)</h2>
            <p>Conformément au RGPD, vous disposez des droits suivants :</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>Droit d'accès</strong> : obtenir une copie de vos données</li>
              <li><strong>Droit de rectification</strong> : corriger vos données inexactes</li>
              <li><strong>Droit à l'effacement</strong> : demander la suppression de vos données</li>
              <li><strong>Droit à la portabilité</strong> : recevoir vos données dans un format structuré</li>
              <li><strong>Droit d'opposition</strong> : vous opposer à certains traitements</li>
              <li><strong>Droit à la limitation</strong> : limiter le traitement de vos données</li>
            </ul>
            <p className="mt-3">Pour exercer vos droits : <a href="mailto:privacy@agentdebureau.fr" className="text-primary underline">privacy@agentdebureau.fr</a>. Vous pouvez également adresser une réclamation à la <strong>CNIL</strong> (www.cnil.fr).</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Cookies</h2>
            <p>Nous utilisons des cookies strictement nécessaires au fonctionnement du service (session, authentification). Aucun cookie publicitaire ou de tracking tiers n'est utilisé sans votre consentement explicite.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">8. Transferts hors UE</h2>
            <p>Certains sous-traitants (hébergement, email transactionnel) peuvent être situés hors de l'UE. Ces transferts sont encadrés par des garanties appropriées (Clauses Contractuelles Types de la Commission européenne).</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. Contact DPO</h2>
            <p>Pour toute question relative à la protection de vos données : <a href="mailto:privacy@agentdebureau.fr" className="text-primary underline">privacy@agentdebureau.fr</a></p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
