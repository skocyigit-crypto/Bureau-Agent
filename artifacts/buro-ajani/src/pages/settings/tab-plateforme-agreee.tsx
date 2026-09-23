import { Alert,AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { signalerChamp } from "@/lib/champ-en-erreur";
import { FileInput,Loader2,PlugZap,Save,Trash2 } from "lucide-react";
import { useCallback,useEffect,useState } from "react";

import { CarteChorusPro } from "./carte-chorus-pro";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Plateformes dont les adresses AFNOR ont ete relevees dans leur propre
 * specification publiee (21/09/2026). Pour une autre plateforme, les adresses
 * se saisissent a la main : elles figurent dans sa documentation.
 */
export const PLATEFORMES_CONNUES = [
  { nom: "Super PDP", urlFlow: "https://api.superpdp.tech/afnor-flow", urlJeton: "https://api.superpdp.tech/oauth2/token" },
] as const;

interface Raccordement {
  configure: boolean;
  nom?: string;
  urlFlow?: string;
  urlJeton?: string;
  clientId?: string;
  secretEnregistre?: boolean;
}

interface FactureRecue { flowId: string; nom?: string; recueLe?: string; format?: string; statut?: string | null }

export function TabPlateformeAgreee() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [etat, setEtat] = useState<Raccordement | null>(null);
  const [form, setForm] = useState({ nom: "", urlFlow: "", urlJeton: "", clientId: "", clientSecret: "" });
  const [enCours, setEnCours] = useState<"" | "save" | "test" | "recues">("");
  const [recues, setRecues] = useState<FactureRecue[] | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/plateforme-agreee`, { credentials: "include" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as Raccordement;
      setEtat(d);
      if (d.configure) setForm({ nom: d.nom ?? "", urlFlow: d.urlFlow ?? "", urlJeton: d.urlJeton ?? "", clientId: d.clientId ?? "", clientSecret: "" });
    } catch {
      toast({ title: t("settingsPlateformeAgreee.toast.loadError"), variant: "destructive" });
    }
  }, [t, toast]);

  useEffect(() => { void charger(); }, [charger]);

  const enregistrer = async () => {
    if (!form.nom.trim()) { signalerChamp("pa-nom", t("settingsPlateformeAgreee.err.nom")); toast({ title: t("settingsPlateformeAgreee.err.nom"), variant: "destructive" }); return; }
    if (!form.clientId.trim()) { signalerChamp("pa-client-id", t("settingsPlateformeAgreee.err.clientId")); toast({ title: t("settingsPlateformeAgreee.err.clientId"), variant: "destructive" }); return; }
    if (!etat?.configure && !form.clientSecret.trim()) { signalerChamp("pa-client-secret", t("settingsPlateformeAgreee.err.secret")); toast({ title: t("settingsPlateformeAgreee.err.secret"), variant: "destructive" }); return; }
    setEnCours("save");
    try {
      const r = await fetch(`${API}/api/plateforme-agreee`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: d.error ?? t("settingsPlateformeAgreee.toast.saveError"), variant: "destructive" }); return; }
      toast({ title: t("settingsPlateformeAgreee.toast.saved") });
      await charger();
    } finally {
      setEnCours("");
    }
  };

  const tester = async () => {
    setEnCours("test");
    try {
      const r = await fetch(`${API}/api/plateforme-agreee/test`, { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) toast({ title: t("settingsPlateformeAgreee.toast.testOk") });
      else toast({ title: t("settingsPlateformeAgreee.toast.testFail"), description: d.error, variant: "destructive" });
    } finally {
      setEnCours("");
    }
  };

  const retirer = async () => {
    if (!(await confirmAction({ title: t("settingsPlateformeAgreee.confirmDelete"), destructive: true }))) return;
    await fetch(`${API}/api/plateforme-agreee`, { method: "DELETE", credentials: "include" });
    setForm({ nom: "", urlFlow: "", urlJeton: "", clientId: "", clientSecret: "" });
    setRecues(null);
    await charger();
  };

  const chargerRecues = async () => {
    setEnCours("recues");
    try {
      const r = await fetch(`${API}/api/plateforme-agreee/recues`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: d.error ?? t("settingsPlateformeAgreee.toast.recuesError"), variant: "destructive" }); return; }
      setRecues(d.factures ?? []);
    } finally {
      setEnCours("");
    }
  };

  const champ = (cle: keyof typeof form, id: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(`settingsPlateformeAgreee.fields.${cle}`)}</Label>
      <Input id={id} value={form[cle]} onChange={(e) => setForm((f) => ({ ...f, [cle]: e.target.value }))} {...props} />
    </div>
  );

  if (!etat) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" aria-label={t("common.loading")} /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="w-5 h-5" aria-hidden="true" />
            {t("settingsPlateformeAgreee.title")}
            {etat.configure && <Badge variant="outline">{t("settingsPlateformeAgreee.connected")}</Badge>}
          </CardTitle>
          <CardDescription>{t("settingsPlateformeAgreee.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription>{t("settingsPlateformeAgreee.why")}</AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2">
            {PLATEFORMES_CONNUES.map((p) => (
              <Button key={p.nom} type="button" variant="outline" size="sm"
                onClick={() => setForm((f) => ({ ...f, nom: p.nom, urlFlow: p.urlFlow, urlJeton: p.urlJeton }))}>
                {t("settingsPlateformeAgreee.prefill", { name: p.nom })}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {champ("nom", "pa-nom", { "aria-required": "true" })}
            {champ("clientId", "pa-client-id", { "aria-required": "true", autoComplete: "off" })}
            {champ("urlFlow", "pa-url-flow", { type: "url", placeholder: "https://…/afnor-flow" })}
            {champ("urlJeton", "pa-url-jeton", { type: "url", placeholder: "https://…/oauth2/token" })}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pa-client-secret">{t("settingsPlateformeAgreee.fields.clientSecret")}</Label>
              <Input id="pa-client-secret" type="password" autoComplete="new-password"
                aria-required={etat.configure ? undefined : "true"}
                aria-describedby="pa-secret-aide"
                value={form.clientSecret} onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))} />
              <p id="pa-secret-aide" className="text-xs text-muted-foreground">
                {etat.secretEnregistre ? t("settingsPlateformeAgreee.secretKept") : t("settingsPlateformeAgreee.secretHint")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={enregistrer} disabled={enCours !== ""}>
              {enCours === "save" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4 mr-2" aria-hidden="true" />}
              {t("settingsPlateformeAgreee.save")}
            </Button>
            {etat.configure && (
              <>
                <Button variant="outline" onClick={tester} disabled={enCours !== ""}>
                  {enCours === "test" && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                  {t("settingsPlateformeAgreee.test")}
                </Button>
                <Button variant="outline" onClick={retirer} disabled={enCours !== ""}>
                  <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t("settingsPlateformeAgreee.delete")}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <CarteChorusPro />

      {etat.configure && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileInput className="w-5 h-5" aria-hidden="true" />
              {t("settingsPlateformeAgreee.received.title")}
            </CardTitle>
            <CardDescription>{t("settingsPlateformeAgreee.received.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" onClick={chargerRecues} disabled={enCours !== ""}>
              {enCours === "recues" && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              {t("settingsPlateformeAgreee.received.load")}
            </Button>
            {recues && (recues.length === 0
              ? <p className="text-sm text-muted-foreground">{t("settingsPlateformeAgreee.received.empty")}</p>
              : (
                <ul className="divide-y rounded-lg border">
                  {recues.map((f) => (
                    <li key={f.flowId} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <span className="font-medium">{f.nom ?? f.flowId}</span>
                      <span className="text-muted-foreground">
                        {f.recueLe ? new Date(f.recueLe).toLocaleDateString() : ""}{f.format ? ` · ${f.format}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
