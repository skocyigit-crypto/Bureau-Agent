import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";

/**
 * Declaration d'accessibilite.
 *
 * C'est un artefact legal distinct de l'audit lui-meme: il doit annoncer
 * l'etat REEL, y compris quand cet etat est « non conforme ». Une declaration
 * qui annonce une conformite non mesuree est une fausse declaration, donc pire
 * que l'absence de page.
 *
 * L'etat ci-dessous reflete ce qui a effectivement ete verifie a ce jour: un
 * releve cible, pas un audit complet. Il est ecrit ainsi volontairement — le
 * taux de conformite, qui suppose un audit RGAA sur l'echantillon obligatoire,
 * n'a pas ete etabli et n'est donc pas annonce.
 */
export default function Accessibilite() {
  const [demoOpen, setDemoOpen] = useState(false);
  useDocumentMeta(PAGE_META.accessibilite);
  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main id="contenu" className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Déclaration d'accessibilité</h1>
        <p className="text-muted-foreground mb-10">Dernière mise à jour : août 2026</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Engagement</h2>
            <p>
              <strong>SK GROUP</strong> s'engage à rendre la plateforme{" "}
              <strong>Ajant Bureau</strong> (agentdebureau.fr) accessible au plus
              grand nombre, conformément au Référentiel général d'amélioration de
              l'accessibilité (RGAA) et à la norme européenne EN 301 549.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. État de conformité</h2>
            <p>
              La plateforme est déclarée{" "}
              <strong>non conforme</strong>. Aucun audit d'accessibilité complet
              n'a encore été réalisé : le taux de conformité n'est donc pas
              établi et n'est volontairement pas annoncé ici. Les
              non-conformités listées ci-dessous proviennent de vérifications
              ciblées et ne constituent pas un relevé exhaustif.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Contenus non accessibles</h2>
            <p className="mb-2">Non-conformités identifiées à ce jour :</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li>
                Aucun audit complet n'ayant été mené, des barrières non encore
                identifiées peuvent subsister sur l'ensemble du parcours.
              </li>
              <li>
                Les composants d'interface n'ont pas tous été vérifiés quant à
                leur nom accessible, leur rôle et la restitution de leur état.
              </li>
              <li>
                Les contrastes de couleur n'ont pas fait l'objet d'un relevé
                systématique.
              </li>
              <li>
                Le parcours complet au clavier et au lecteur d'écran n'a pas été
                validé sur l'ensemble des écrans.
              </li>
            </ul>
            <p className="mt-3">
              Corrections déjà apportées : les commandes d'affichage du mot de
              passe des écrans de connexion, de réinitialisation et
              d'inscription sont désormais atteignables au clavier et dotées
              d'un nom accessible restituant leur état.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Retour d'information</h2>
            <p>
              Si vous ne parvenez pas à accéder à un contenu ou à un service,
              écrivez-nous à{" "}
              <a href="mailto:accessibilite@agentdebureau.fr" className="text-primary underline">
                accessibilite@agentdebureau.fr
              </a>{" "}
              en précisant la page concernée et la difficulté rencontrée. Nous
              nous engageons à vous répondre et à vous proposer une alternative
              permettant d'accéder au service.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Voies de recours</h2>
            <p>
              Si vous constatez un défaut d'accessibilité vous empêchant
              d'accéder à un contenu ou à une fonctionnalité, que vous nous le
              signalez et que vous ne parvenez pas à obtenir de réponse, vous
              pouvez adresser une réclamation au Défenseur des droits :{" "}
              <a href="https://www.defenseurdesdroits.fr" className="text-primary underline" target="_blank" rel="noopener noreferrer">
                defenseurdesdroits.fr
              </a>
              , ou écrire au Défenseur des droits, Libre réponse 71120, 75342
              Paris CEDEX 07 (courrier sans affranchissement).
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Plan d'amélioration</h2>
            <p>
              Un audit d'accessibilité complet est à planifier ; les
              non-conformités qu'il révélera seront corrigées et cette
              déclaration mise à jour, avec le taux de conformité mesuré.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
