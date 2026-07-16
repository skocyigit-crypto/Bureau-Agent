import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";

export default function MentionsLegales() {
  const [demoOpen, setDemoOpen] = useState(false);
  useDocumentMeta(PAGE_META.mentionsLegales);
  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Mentions légales</h1>
        <p className="text-muted-foreground mb-10">Dernière mise à jour : janvier 2026</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Éditeur du site</h2>
            <p>Le site <strong>agentdebureau.fr</strong> et la marque commerciale « Ajant Bureau » sont édités par :</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>SK GROUP</strong> (SASU)</li>
              <li>Siège social : 17 rue Saint-Exupéry, 67500 Haguenau, France</li>
              <li>SIRET : 890 977 648 00017</li>
              <li>N° TVA intracommunautaire : FR83 890977648</li>
              <li>Président : Serkan Kocyigit</li>
              <li>Email : contact@agentdebureau.fr</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Directeur de la publication</h2>
            <p>Le directeur de la publication est le représentant légal de SK GROUP.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Hébergement</h2>
            <p>Le site et la plateforme SaaS sont hébergés par :</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>Google Cloud EMEA Limited</strong> (Google Cloud Platform)</li>
              <li>70 Sir John Rogerson's Quay, Dublin 2, Irlande</li>
              <li>Données hébergées dans la région europe-west9 (Paris, France)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Propriété intellectuelle</h2>
            <p>
              L'ensemble des éléments constituant le site Ajant Bureau (textes, graphismes, logiciels, photographies, images, sons, plans, noms, logos, marques, créations et œuvres protégeables diverses) sont la propriété exclusive de SK GROUP ou de ses partenaires. Toute reproduction, représentation, modification, publication, adaptation de tout ou partie des éléments du site est interdite, sauf autorisation écrite préalable.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Limitation de responsabilité</h2>
            <p>
              SK GROUP s'efforce d'assurer au mieux de ses possibilités l'exactitude et la mise à jour des informations diffusées sur ce site. Cependant, SK GROUP ne peut garantir l'exactitude, la précision ou l'exhaustivité des informations mises à disposition. SK GROUP décline toute responsabilité pour toute imprécision, inexactitude ou omission portant sur les informations disponibles sur ce site.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Contact</h2>
            <p>Pour toute question relative aux présentes mentions légales, vous pouvez nous contacter à : <a href="mailto:legal@agentdebureau.fr" className="text-primary underline">legal@agentdebureau.fr</a></p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
