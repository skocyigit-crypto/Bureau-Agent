import { Link } from "wouter";
import { PhoneCall } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-primary text-primary-foreground py-20 border-t border-primary-foreground/10">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="space-y-4 col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-accent-foreground">
                <PhoneCall className="w-5 h-5" />
              </div>
              <span className="font-bold text-xl tracking-tight">
                Agent de Bureau
              </span>
            </Link>
            <p className="text-primary-foreground/70 max-w-sm">
              La plateforme de secrétariat et de gestion de bureau la plus complète pour les entreprises françaises. Paris, France.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4 text-accent">Produit</h4>
            <ul className="space-y-3 text-primary-foreground/70 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Fonctionnalités</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Tarifs</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Sécurité</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Intégrations</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-accent">Entreprise</h4>
            <ul className="space-y-3 text-primary-foreground/70 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">À propos</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Mentions légales</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Confidentialité</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-20 pt-8 border-t border-primary-foreground/10 flex flex-col md:flex-row items-center justify-between text-sm text-primary-foreground/50">
          <p>© {new Date().getFullYear()} Agent de Bureau. Tous droits réservés.</p>
          <p>Fait avec passion à Paris.</p>
        </div>
      </div>
    </footer>
  );
}
