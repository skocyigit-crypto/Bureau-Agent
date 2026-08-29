import { Link } from "wouter";
import { PhoneCall } from "lucide-react";
import { APP_URL, REGISTER_URL } from "@/lib/app-url";

export function Footer() {
  return (
    <footer className="bg-primary text-primary-foreground py-20 border-t border-primary-foreground/10">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-16">
          <div className="space-y-6 lg:col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center text-accent-foreground">
                <PhoneCall className="w-6 h-6" />
              </div>
              <span className="font-bold text-2xl tracking-tight text-white">
                Ajant Bureau
              </span>
            </Link>
            <p className="text-primary-foreground/70 max-w-md text-base leading-relaxed">
              La plateforme SaaS complète pour les bureaux français : CRM, centre d&apos;appels, devis, facturation, gestion de projets, stock, IA multi-agents et protection des données. 16 modules intégrés.
            </p>
          </div>
          
          <div>
            <h4 className="font-bold mb-6 text-accent uppercase tracking-wider text-sm">Produit</h4>
            <ul className="space-y-4 text-primary-foreground/70 font-medium">
              {/* Ancres prefixees par "/" : le pied de page est aussi rendu sur
                  /cgu, /mentions-legales... ou ces sections n'existent pas. */}
              <li><a href="/#fonctionnalites" className="hover:text-white transition-colors">Fonctionnalités</a></li>
              <li><a href="/#analytique" className="hover:text-white transition-colors">Analytique</a></li>
              <li><a href="/#tarifs" className="hover:text-white transition-colors">Tarifs</a></li>
              <li><a href="/#integrations" className="hover:text-white transition-colors">Intégrations</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-6 text-accent uppercase tracking-wider text-sm">Ressources</h4>
            <ul className="space-y-4 text-primary-foreground/70 font-medium">
              <li><a href="/#faq" className="hover:text-white transition-colors">FAQ</a></li>
              <li><a href="mailto:support@agentdebureau.fr" className="hover:text-white transition-colors">Centre d'aide</a></li>
              <li><a href={REGISTER_URL} className="hover:text-white transition-colors">Essai gratuit 14 jours</a></li>
              <li><a href={APP_URL} className="hover:text-white transition-colors">Connexion</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-6 text-accent uppercase tracking-wider text-sm">Légal & Entreprise</h4>
            <ul className="space-y-4 text-primary-foreground/70 font-medium">
              <li><a href="mailto:contact@agentdebureau.fr" className="hover:text-white transition-colors">Contact</a></li>
              <li><Link href="/mentions-legales" className="hover:text-white transition-colors">Mentions légales</Link></li>
              <li><Link href="/cgu" className="hover:text-white transition-colors">CGU</Link></li>
              <li><Link href="/accessibilite" className="hover:text-white transition-colors">Accessibilité</Link></li>
              <li><Link href="/confidentialite" className="hover:text-white transition-colors">Politique de confidentialité</Link></li>
              <li><Link href="/gizlilik" className="hover:text-white transition-colors" hrefLang="tr" lang="tr">Gizlilik Politikası (TR)</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="pt-8 border-t border-primary-foreground/10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-primary-foreground/50 font-medium">
          <p>© {new Date().getFullYear()} SK GROUP. Tous droits réservés.</p>
          <div className="flex items-center gap-4">
            <Link href="/mentions-legales" className="hover:text-white transition-colors">Mentions légales</Link>
            <Link href="/cgu" className="hover:text-white transition-colors">CGU</Link>
            <Link href="/accessibilite" className="hover:text-white transition-colors">Accessibilité</Link>
            <Link href="/confidentialite" className="hover:text-white transition-colors">Confidentialité</Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            {/* Le siege de SK GROUP est a Haguenau (cf. mentions legales) et
                l'infrastructure est en region europe-west9 (Paris). L'ancien
                "Fait avec passion a Paris" ne correspondait ni a l'un ni a
                l'autre. */}
            <span>Conçu en Alsace • Hébergé en France</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
