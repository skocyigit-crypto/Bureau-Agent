import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Cookie, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Information sur les cookies — et non demande de consentement.
 *
 * Le bandeau proposait « Accepter » et « Refuser ». Les deux boutons
 * ecrivaient une valeur dans le stockage local et fermaient le bandeau. Rien,
 * nulle part, ne relisait cette valeur: refuser ne desactivait rien, parce
 * qu'il n'y avait rien a desactiver. Un choix sans effet est pire que pas de
 * choix — il fait croire a l'utilisateur qu'il a agi.
 *
 * Le site n'utilise que des cookies strictement necessaires (session,
 * authentification), qui sont dispenses de consentement: la CNIL les exclut
 * explicitement du champ de l'article 82 de la loi Informatique et Libertes.
 * Aucune banniere n'est donc requise. Ce qui reste dû, c'est l'INFORMATION.
 *
 * D'ou ce bandeau: il informe, renvoie a la politique de confidentialite, et
 * se ferme. Il ne promet plus un arbitrage qui n'existe pas.
 *
 * La police de caracteres etait l'autre moitie du probleme: elle etait
 * chargee depuis Google, ce qui transmettait l'adresse IP de chaque visiteur
 * a un tiers avant meme l'affichage de ce bandeau. Elle est desormais servie
 * par nos soins, ce qui rend enfin vraie la phrase ci-dessous.
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const vu = localStorage.getItem("cookie_notice_seen");
    if (!vu) setVisible(true);
  }, []);

  const fermer = () => {
    // On memorise seulement que l'information a ete affichee, pour ne pas la
    // repeter a chaque page. Ce n'est pas une trace de consentement, et rien
    // n'en depend.
    localStorage.setItem("cookie_notice_seen", "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6">
      <div className="max-w-4xl mx-auto bg-white dark:bg-slate-900 border border-border shadow-2xl rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/30 shrink-0 mt-0.5">
            <Cookie className="w-5 h-5 text-amber-600" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold mb-1">Cookies et données de navigation</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Ce site n'utilise que des cookies strictement nécessaires à son
              fonctionnement (session, authentification). Aucun cookie
              publicitaire, aucun traceur, aucune police ni ressource chargée
              depuis un service tiers. Ces cookies étant indispensables, ils ne
              requièrent pas votre consentement — mais vous devez en être
              informé.{" "}
              <Link href="/confidentialite" className="text-primary underline hover:text-primary/80">
                En savoir plus
              </Link>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto">
          <Button
            size="sm"
            onClick={fermer}
            className="text-xs h-9 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Check className="w-3 h-3 mr-1" aria-hidden="true" />
            J'ai compris
          </Button>
        </div>
      </div>
    </div>
  );
}
