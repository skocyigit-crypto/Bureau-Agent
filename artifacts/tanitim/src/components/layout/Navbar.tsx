import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PhoneCall, Menu, X } from "lucide-react";
import { APP_URL, REGISTER_URL } from "@/lib/app-url";

interface NavbarProps {
  onDemoClick?: () => void;
}

export function Navbar({ onDemoClick }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Ancres prefixees par "/" : depuis une page secondaire (/cgu,
  // /mentions-legales...) un simple "#tarifs" ne menerait nulle part puisque la
  // section n'existe que sur l'accueil. Depuis l'accueil, le navigateur reste
  // dans le meme document et se contente de defiler.
  const navLinks = [
    { label: "Fonctionnalités", href: "/#fonctionnalites" },
    { label: "Analytique", href: "/#analytique" },
    { label: "Tarifs", href: "/#tarifs" },
    { label: "FAQ", href: "/#faq" },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/95 backdrop-blur-xl shadow-md border-b border-border/60" : "bg-background/80 backdrop-blur-md border-b border-border/50"}`}>
      {/* Lien d'evitement : premier element focalisable de la page, invisible
          jusqu'a ce qu'il recoive le focus clavier (WCAG 2.4.1). Sans lui, un
          utilisateur au clavier ou lecteur d'ecran doit traverser toute la
          navigation sur chaque page. */}
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:font-semibold"
      >
        Aller au contenu principal
      </a>
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5 group" aria-label="Ajant Bureau — accueil">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground group-hover:bg-accent group-hover:text-accent-foreground transition-colors duration-300">
            <PhoneCall className="w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight text-foreground">
            Ajant Bureau
          </span>
        </a>

        <div className="hidden lg:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-foreground transition-colors">
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden sm:flex items-center gap-3">
          <a href={APP_URL}>
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground font-semibold">
              Connexion
            </Button>
          </a>
          {onDemoClick && (
            <Button variant="outline" className="font-semibold border-2" onClick={onDemoClick}>
              Planifier une démo
            </Button>
          )}
          <a href={REGISTER_URL}>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-xl transition-all font-bold">
              Essai gratuit
            </Button>
          </a>
        </div>

        {/* Le bouton menu doit apparaitre des que les liens de navigation
            disparaissent (lg), pas seulement sous sm : entre les deux, les
            tablettes n'avaient AUCUN acces aux sections du site. */}
        <button
          className="lg:hidden p-2 rounded-md text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
          aria-expanded={mobileOpen}
          aria-controls="menu-mobile"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div id="menu-mobile" className="lg:hidden bg-background/98 backdrop-blur-xl border-b border-border px-4 pb-6 space-y-1">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="block py-3 text-sm font-medium text-muted-foreground hover:text-foreground border-b border-border/40 last:border-0"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          {/* Les CTA restent visibles dans la barre des sm — on ne les repete
              dans le panneau que sur mobile. */}
          <div className="sm:hidden flex flex-col gap-3 pt-4">
            <a href={APP_URL}><Button variant="outline" className="w-full font-semibold">Connexion</Button></a>
            {onDemoClick && (
              <Button variant="outline" className="w-full font-semibold" onClick={() => { setMobileOpen(false); onDemoClick(); }}>
                Planifier une démo
              </Button>
            )}
            <a href={REGISTER_URL}>
              <Button className="w-full bg-primary text-primary-foreground font-bold">Essai gratuit — 14 jours</Button>
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
