import { Sparkles, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Icon3D } from "@/components/icon-3d";
import { useInlineSuggestEnabled } from "@/hooks/use-inline-suggest";

export function TabPreferencesIa() {
  const [enabled, setEnabled] = useInlineSuggestEnabled();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon3D icon={Sparkles} variant="purple" size="sm" />
            Suggestions IA en ligne
          </CardTitle>
          <CardDescription>
            Affiche une suggestion grise (style ghost-text) pendant que vous redigez
            des notes internes, des notes de prospects et le corps des e-mails.
            Appuyez sur Tab pour accepter, Echap pour ignorer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Activer les suggestions en ligne</Label>
              <p className="text-xs text-muted-foreground">
                Lorsque cette option est desactivee, aucune suggestion n'est demandee
                ni affichee dans les champs de texte.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Activer les suggestions IA en ligne"
            />
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Cette preference est enregistree sur votre compte et s'applique a tous
            vos appareils. Les changements sont sauvegardes automatiquement.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
