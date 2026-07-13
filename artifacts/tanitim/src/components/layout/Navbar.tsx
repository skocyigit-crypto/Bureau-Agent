import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PhoneCall, Menu, X } from "lucide-react";

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

  const navLinks = [
    { label: "Fonctionnalités", href: "#fonctionnalites" },
    { label: "Analytique", href: "#analytique" },
    { label: "Tarifs", href: "#tarifs" },
    { label: "Témoignages", href: "#temoignages" },
    { label: "FAQ", href: "#faq" },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/95 backdrop-blur-xl shadow-md border-b border-border/60" : "bg-background/80 backdrop-blur-md border-b border-border/50"}`}>
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground group-hover:bg-accent group-hover:text-accent-foreground transition-colors duration-300">
            <PhoneCall className="w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight text-foreground">
            Agent de Bureau
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
          <a href="/">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground font-semibold">
              Connexion
            </Button>
          </a>
          {onDemoClick && (
            <Button variant="outline" className="font-semibold border-2" onClick={onDemoClick}>
              Planifier une démo
            </Button>
          )}
          <a href="/register">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-xl transition-all font-bold">
              Essai gratuit
            </Button>
          </a>
        </div>

        <button
          className="sm:hidden p-2 rounded-md text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="sm:hidden bg-background/98 backdrop-blur-xl border-b border-border px-4 pb-6 space-y-1">
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
          <div className="flex flex-col gap-3 pt-4">
            <a href="/"><Button variant="outline" className="w-full font-semibold">Connexion</Button></a>
            {onDemoClick && (
              <Button variant="outline" className="w-full font-semibold" onClick={() => { setMobileOpen(false); onDemoClick(); }}>
                Planifier une démo
              </Button>
            )}
            <a href="/register">
              <Button className="w-full bg-primary text-primary-foreground font-bold">Essai gratuit — 14 jours</Button>
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
