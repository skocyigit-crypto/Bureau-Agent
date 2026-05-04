import ExecutiveReport from "@/components/executive-report";
import { Button } from "@/components/ui/button";
import { Printer, FolderKanban } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export default function RapportExecutifPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  async function navigateToProjets() {
    const res = await fetch(`${BASE}/api/projets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title: "Projet exécutif", status: "planifie", priority: "haute", progress: 0, notes: "Créé depuis le rapport exécutif" }),
    });
    if (res.ok) { toast({ title: "Projet créé" }); navigate("/projets"); }
    else toast({ title: "Erreur lors de la création", variant: "destructive" });
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rapport Exécutif</h1>
          <p className="text-muted-foreground text-sm">Vue synthétique de votre activité</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-indigo-600 border-indigo-300 hover:bg-indigo-50" onClick={navigateToProjets}>
            <FolderKanban className="w-4 h-4" />Créer un projet
          </Button>
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>
      <ExecutiveReport />
    </div>
  );
}
