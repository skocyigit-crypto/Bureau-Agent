import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";

export default function Confidentialite() {
  const [demoOpen, setDemoOpen] = useState(false);
  useDocumentMeta(PAGE_META.confidentialite);
  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main id="contenu" className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Politique de confidentialité</h1>
        <p className="text-muted-foreground mb-10">Dernière mise à jour : janvier 2026 — Conforme RGPD</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Responsable du traitement</h2>
            <p>SK GROUP (SAS), dont le siège est à Haguenau (France), est responsable du traitement de vos données personnelles collectées via la plateforme agentdebureau.fr.</p>
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
              {/* Cette ligne manquait, et c'etait le probleme: l'application
                  mobile collecte la position en arriere-plan, en continu, et
                  la politique n'en disait pas un mot. Une collecte de
                  geolocalisation non annoncee est exactement ce que l'article
                  13 du RGPD interdit. Le detail est en section 2 bis. */}
              <li><strong>Données de localisation</strong> : position transmise par l'application mobile, lorsque votre employeur active le suivi de présence (voir 2 bis)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2 bis. Suivi de présence par géolocalisation (application mobile)</h2>
            <p>
              Ce traitement ne concerne que les organisations qui activent le
              suivi de présence, et uniquement via l'application mobile. Il
              n'existe pas sur la version web.
            </p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li>
                <strong>Ce qui est collecté</strong> : latitude et longitude
                approximatives, horodatage, précision de la mesure et, le cas
                échéant, niveau de batterie. La mesure a lieu au maximum toutes
                les 60 secondes ou tous les 100 mètres, <strong>y compris
                lorsque l'application est en arrière-plan</strong>, mais
                uniquement pendant les <strong>horaires de travail définis par
                votre employeur</strong>.
              </li>
              <li>
                <strong>Quand elle a lieu</strong> : uniquement pendant ces
                horaires. En dehors — la nuit, les jours non travaillés —
                aucune position n'est collectée ni enregistrée : le serveur
                refuse de l'enregistrer, et l'application arrête la collecte.
              </li>
              <li>
                <strong>Ce que votre employeur voit</strong> : uniquement la
                zone (chantier, agence, site) dans laquelle vous vous trouvez et
                l'heure du dernier passage. Les coordonnées exactes ne quittent
                pas nos serveurs : elles servent seulement à déterminer
                l'appartenance à une zone, et ne sont pas transmises à
                l'interface d'administration.
              </li>
              <li>
                <strong>Durée de conservation</strong> : 30 jours. Les
                événements d'entrée et de sortie plus anciens sont supprimés
                automatiquement, ainsi que la dernière position connue des
                utilisateurs inactifs depuis 30 jours.
              </li>
              <li>
                <strong>Responsable</strong> : votre employeur décide d'activer
                ce suivi, d'en définir les zones et la finalité ; il en est le
                responsable de traitement. SK GROUP agit comme sous-traitant
                (voir le <a href="/dpa" className="text-primary underline">DPA</a>).
              </li>
            </ul>
            <p className="mt-3 text-sm">
              La géolocalisation des salariés est strictement encadrée. La CNIL
              rappelle qu'elle doit être proportionnée à la finalité poursuivie,
              qu'elle ne peut pas servir à surveiller un salarié en dehors de son
              temps de travail, et que les représentants du personnel comme les
              personnes concernées doivent en être informés préalablement. Le
              produit borne lui-même la collecte aux horaires de travail,
              précisément pour que le suivi ne déborde pas sur la vie privée. Il
              revient à l'employeur qui active cette fonction de définir des
              horaires proportionnés, d'informer les représentants du personnel
              et de mener l'analyse d'impact lorsqu'elle est requise.
            </p>
            <p className="mt-3 text-sm">
              Vous pouvez exercer vos droits d'accès, de rectification,
              d'effacement et d'opposition auprès de votre employeur, ou nous
              écrire à <strong>privacy@agentdebureau.fr</strong>.
            </p>
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
              <li><strong>Journaux techniques</strong> : 12 mois maximum</li>
              <li><strong>Enregistrements d'appels</strong> : selon paramétrage client (max. 12 mois par défaut)</li>
              {/* Cette ligne manquait, et son absence etait le vrai probleme:
                  les journaux d'audit sont rendus non modifiables et non
                  supprimables par des declencheurs PostgreSQL
                  (lib/db/scripts/ensure-audit-append-only.sql). Ils contiennent
                  des donnees personnelles (identifiant, e-mail, adresse IP,
                  agent utilisateur) et sont donc conserves de maniere
                  permanente. Les annoncer comme des « logs a 12 mois » etait
                  une promesse que l'architecture rendait intenable. */}
              <li>
                <strong>Journaux d'audit de sécurité</strong> : conservés de
                manière permanente et inaltérable. Ces journaux tracent les
                actions sensibles (connexion, export, suppression, changement de
                rôle ou de mot de passe) afin de pouvoir établir l'origine d'un
                incident de sécurité. Leur inaltérabilité est ce qui leur donne
                une valeur probante : ils ne peuvent être ni modifiés ni
                effacés, y compris par nous. Ils contiennent votre identifiant,
                votre adresse e-mail, votre adresse IP et votre navigateur.
              </li>
            </ul>
            <p className="mt-3 text-sm">
              La conservation permanente des journaux d'audit repose sur notre
              intérêt légitime à assurer la sécurité de la plateforme et la
              traçabilité des accès (art. 6.1.f du RGPD). Vous pouvez exercer
              votre droit d'opposition à cette adresse :{" "}
              <strong>privacy@agentdebureau.fr</strong>.
            </p>
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
            <p>
              Nous utilisons uniquement des cookies strictement nécessaires au
              fonctionnement du service (session, authentification). Aucun
              cookie publicitaire, aucun traceur.
            </p>
            {/* Cette precision manquait, et son absence rendait la phrase
                ci-dessus fausse: la police de caracteres etait chargee depuis
                Google, ce qui transmettait l'adresse IP de chaque visiteur a
                un tiers. Une police n'est pas un cookie, mais l'appel reseau
                existe et le visiteur ne pouvait ni le savoir ni s'y opposer. */}
            <p className="mt-2">
              Aucune ressource de la page — police de caractères, bibliothèque,
              image — n'est chargée depuis un service tiers : tout est servi
              depuis nos propres serveurs. Votre adresse IP n'est donc
              transmise à personne d'autre que nous du fait de votre visite.
            </p>
            <p className="mt-2">
              Ces cookies étant indispensables au service, ils ne requièrent pas
              votre consentement : la réglementation les dispense expressément
              de recueil du consentement. Vous en êtes informé, et rien d'autre
              n'est déposé.
            </p>
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
