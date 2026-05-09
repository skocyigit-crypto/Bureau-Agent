import { Sparkles, Info, Languages } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon3D } from "@/components/icon-3d";
import {
  useInlineSuggestEnabled,
  useInlineSuggestLanguage,
  INLINE_SUGGEST_LANGUAGES,
  useInlineSuggestFields,
  type InlineSuggestConfigurableField,
} from "@/hooks/use-inline-suggest";

const FIELD_OPTIONS: ReadonlyArray<{
  field: InlineSuggestConfigurableField;
  label: string;
  description: string;
}> = [
  {
    field: "note",
    label: "Notes internes",
    description: "Suggestions pendant la rédaction des notes internes.",
  },
  {
    field: "prospect_note",
    label: "Notes de prospect",
    description: "Suggestions dans les notes attachées à un prospect.",
  },
  {
    field: "email_body",
    label: "Corps des e-mails",
    description: "Suggestions dans le corps des messages d'e-mail.",
  },
];

export function TabPreferencesIa() {
  const [enabled, setEnabled] = useInlineSuggestEnabled();
  const [language, setLanguage] = useInlineSuggestLanguage();
  const [fieldFlags, setFieldFlag] = useInlineSuggestFields();

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

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Languages className="w-3.5 h-3.5" />
                Langue des suggestions
              </Label>
              <p className="text-xs text-muted-foreground">
                Langue dans laquelle l'IA proposera la suite de votre texte.
                Choisissez « Auto » pour que la langue soit detectee
                automatiquement a partir de ce que vous ecrivez.
              </p>
            </div>
            <Select value={language} onValueChange={setLanguage} disabled={!enabled}>
              <SelectTrigger className="w-44" aria-label="Langue des suggestions IA">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INLINE_SUGGEST_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Champs concernés</Label>
              <p className="text-xs text-muted-foreground">
                Choisissez où les suggestions doivent apparaître. Chaque type de champ
                peut être activé ou désactivé indépendamment ; le commutateur principal
                ci-dessus reste prioritaire.
              </p>
            </div>
            <div className="space-y-2 pt-1">
              {FIELD_OPTIONS.map((opt) => (
                <div
                  key={opt.field}
                  className="flex items-center justify-between gap-4 rounded-md border bg-background/50 p-2.5"
                >
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{opt.label}</Label>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </div>
                  <Switch
                    checked={fieldFlags[opt.field]}
                    onCheckedChange={(v) => setFieldFlag(opt.field, v)}
                    disabled={!enabled}
                    aria-label={`Suggestions IA pour ${opt.label}`}
                  />
                </div>
              ))}
            </div>
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
