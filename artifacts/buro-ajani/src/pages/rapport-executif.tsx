import ExecutiveReport from "@/components/executive-report";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export default function RapportExecutifPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rapport Exécutif</h1>
          <p className="text-muted-foreground text-sm">Vue synthétique de votre activité</p>
        </div>
        <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
      </div>
      <ExecutiveReport />
    </div>
  );
}
