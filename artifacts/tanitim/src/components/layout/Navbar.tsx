import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PhoneCall } from "lucide-react";

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground group-hover:bg-accent group-hover:text-accent-foreground transition-colors duration-300">
            <PhoneCall className="w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight text-foreground">
            Agent de Bureau
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          <a href="#fonctionnalites" className="hover:text-foreground transition-colors">Fonctionnalités</a>
          <a href="#analytique" className="hover:text-foreground transition-colors">Analytique</a>
          <a href="#temoignages" className="hover:text-foreground transition-colors">Témoignages</a>
        </div>

        <div className="flex items-center gap-4">
          <Button variant="ghost" className="hidden sm:inline-flex">Connexion</Button>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">Essai gratuit</Button>
        </div>
      </div>
    </nav>
  );
}
