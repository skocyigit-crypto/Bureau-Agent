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
import { useTranslation } from "@/i18n";
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
  {
    field: "call_note",
    label: "Notes d'appel",
    description: "Suggestions dans les notes attachées aux appels téléphoniques.",
  },
  {
    field: "task_description",
    label: "Descriptions de tâches",
    description: "Suggestions pendant la rédaction des descriptions de tâches.",
  },
  {
    field: "message_content",
    label: "Messages",
    description: "Suggestions dans le corps des messages internes.",
  },
  {
    field: "project_description",
    label: "Descriptions de projet",
    description: "Suggestions dans la description d'un projet.",
  },
  {
    field: "project_note",
    label: "Notes de projet",
    description: "Suggestions dans les notes attachées à un projet.",
  },
  {
    field: "quote_comment",
    label: "Commentaires de devis",
    description: "Suggestions dans les commentaires associés à un devis.",
  },
  {
    field: "invoice_comment",
    label: "Commentaires de facture",
    description: "Suggestions dans les commentaires associés à une facture.",
  },
];

export function TabPreferencesIa() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useInlineSuggestEnabled();
  const [language, setLanguage] = useInlineSuggestLanguage();
  const [fieldFlags, setFieldFlag] = useInlineSuggestFields();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon3D icon={Sparkles} variant="purple" size="sm" />
            {t("settingsPreferencesIa.cardTitle")}
          </CardTitle>
          <CardDescription>
            {t("settingsPreferencesIa.cardDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("settingsPreferencesIa.enableLabel")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("settingsPreferencesIa.enableHint")}
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={t("settingsPreferencesIa.enableAria")}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Languages className="w-3.5 h-3.5" />
                {t("settingsPreferencesIa.languageLabel")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settingsPreferencesIa.languageHint")}
              </p>
            </div>
            <Select value={language} onValueChange={setLanguage} disabled={!enabled}>
              <SelectTrigger className="w-44" aria-label={t("settingsPreferencesIa.languageAria")}>
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
              <Label className="text-sm font-medium">{t("settingsPreferencesIa.fieldsLabel")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("settingsPreferencesIa.fieldsHint")}
              </p>
            </div>
            <div className="space-y-2 pt-1">
              {FIELD_OPTIONS.map((opt) => (
                <div
                  key={opt.field}
                  className="flex items-center justify-between gap-4 rounded-md border bg-background/50 p-2.5"
                >
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{t(`settingsPreferencesIa.fields.${opt.field}.label`)}</Label>
                    <p className="text-xs text-muted-foreground">{t(`settingsPreferencesIa.fields.${opt.field}.description`)}</p>
                  </div>
                  <Switch
                    checked={fieldFlags[opt.field]}
                    onCheckedChange={(v) => setFieldFlag(opt.field, v)}
                    disabled={!enabled}
                    aria-label={t("settingsPreferencesIa.fieldAria", { label: t(`settingsPreferencesIa.fields.${opt.field}.label`) })}
                  />
                </div>
              ))}
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {t("settingsPreferencesIa.footer")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
