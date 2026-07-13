import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Download, FileText, Table, Users, Phone, MessageSquare, Target, CheckSquare, Loader2, FileJson } from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const entities = [
  { key: "contacts", label: "Contacts", icon: Users, color: "text-emerald-600 bg-emerald-100" },
  { key: "tasks", label: "Taches", icon: CheckSquare, color: "text-green-600 bg-green-100" },
  { key: "calls", label: "Appels", icon: Phone, color: "text-blue-600 bg-blue-100" },
  { key: "messages", label: "Messages", icon: MessageSquare, color: "text-orange-600 bg-orange-100" },
  { key: "prospects", label: "Prospects", icon: Target, color: "text-purple-600 bg-purple-100" },
];

export function DataExportPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const { toast } = useToast();

  const handleExport = async (entity: string, format: "json" | "csv") => {
    setLoading(`${entity}_${format}`);
    try {
      const r = await fetch(`${API}/api/export/${entity}?format=${format}`, { credentials: "include" });
      if (!r.ok) throw new Error("Erreur export");

      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}_export_${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);

      toast({ title: "Export reussi", description: `${entity} exporte en ${format.toUpperCase()}` });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
    setLoading(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-blue-500" />
            Exporter les donnees
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {entities.map((entity) => (
            <Card key={entity.key} className="border">
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${entity.color}`}>
                    <entity.icon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium">{entity.label}</span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline" size="sm" className="text-xs h-7"
                    onClick={() => handleExport(entity.key, "csv")}
                    disabled={loading !== null}
                  >
                    {loading === `${entity.key}_csv` ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Table className="h-3 w-3 mr-1" />}
                    CSV
                  </Button>
                  <Button
                    variant="outline" size="sm" className="text-xs h-7"
                    onClick={() => handleExport(entity.key, "json")}
                    disabled={loading !== null}
                  >
                    {loading === `${entity.key}_json` ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FileJson className="h-3 w-3 mr-1" />}
                    JSON
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Les exports respectent les filtres de votre organisation. Donnees conformes RGPD.
        </p>
      </DialogContent>
    </Dialog>
  );
}
