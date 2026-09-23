import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { signalerChamp } from "@/lib/champ-en-erreur";
import { Building2, Loader2, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Raccordement a Chorus Pro, le portail de facturation du secteur PUBLIC.
 *
 * Une facture adressee a une commune, a un hopital ou a un office HLM ne part
 * pas par la plateforme agreee : elle se depose sur Chorus Pro. Une entreprise
 * du batiment qui travaille pour la commande publique a donc besoin des deux
 * raccordements, d'ou cette carte a cote de la precedente.
 *
 * Les adresses par defaut sont celles de l'AIFE (PISTE) ; elles restent
 * modifiables, parce qu'un environnement de qualification s'en distingue et
 * que l'administration fait evoluer ses URL.
 */
export const ADRESSES_CHORUS = {
  production: { urlBase: "https://api.piste.gouv.fr/cpro", urlJeton: "https://oauth.piste.gouv.fr/api/oauth/token" },
  qualification: { urlBase: "https://sandbox-api.piste.gouv.fr/cpro", urlJeton: "https://sandbox-oauth.piste.gouv.fr/api/oauth/token" },
} as const;

/** Syntaxe declaree au depot d'un Factur-X (PDF/A-3 portant le XML CII). */
export const SYNTAXE_FACTURX = "IN_DP_E2_CII_FACTURX";

interface EtatChorus {
  configure: boolean;
  urlBase?: string;
  urlJeton?: string;
  clientId?: string;
  compteTechnique?: string;
  idUtilisateurCourant?: number | null;
  syntaxeFlux?: string;
  secretEnregistre?: boolean;
  motDePasseEnregistre?: boolean;
}

const FORM_VIDE: Record<
  "urlBase" | "urlJeton" | "clientId" | "clientSecret" | "compteTechnique"
  | "motDePasseTechnique" | "idUtilisateurCourant" | "syntaxeFlux",
  string
> = {
  urlBase: ADRESSES_CHORUS.production.urlBase,
  urlJeton: ADRESSES_CHORUS.production.urlJeton,
  clientId: "",
  clientSecret: "",
  compteTechnique: "",
  motDePasseTechnique: "",
  idUtilisateurCourant: "",
  syntaxeFlux: SYNTAXE_FACTURX,
};

export function CarteChorusPro() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [etat, setEtat] = useState<EtatChorus | null>(null);
  const [form, setForm] = useState(FORM_VIDE);
  const [enCours, setEnCours] = useState<"" | "save" | "test" | "suivi" | "structure">("");
  const [siret, setSiret] = useState("");

  const charger = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/chorus-pro`, { credentials: "include" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as EtatChorus;
      setEtat(d);
      if (d.configure) {
        setForm({
          urlBase: d.urlBase ?? "", urlJeton: d.urlJeton ?? "", clientId: d.clientId ?? "",
          clientSecret: "", compteTechnique: d.compteTechnique ?? "", motDePasseTechnique: "",
          idUtilisateurCourant: d.idUtilisateurCourant ? String(d.idUtilisateurCourant) : "",
          syntaxeFlux: d.syntaxeFlux ?? SYNTAXE_FACTURX,
        });
      }
    } catch {
      toast({ title: t("settingsChorusPro.toast.loadError"), variant: "destructive" });
    }
  }, [t, toast]);

  useEffect(() => { void charger(); }, [charger]);

  const enregistrer = async () => {
    if (!form.clientId.trim()) { signalerChamp("cpro-client-id", t("settingsChorusPro.err.clientId")); toast({ title: t("settingsChorusPro.err.clientId"), variant: "destructive" }); return; }
    if (!form.compteTechnique.trim()) { signalerChamp("cpro-compte", t("settingsChorusPro.err.compte")); toast({ title: t("settingsChorusPro.err.compte"), variant: "destructive" }); return; }
    if (!etat?.configure && (!form.clientSecret.trim() || !form.motDePasseTechnique.trim())) {
      signalerChamp("cpro-client-secret", t("settingsChorusPro.err.secrets"));
      toast({ title: t("settingsChorusPro.err.secrets"), variant: "destructive" });
      return;
    }
    setEnCours("save");
    try {
      const r = await fetch(`${API}/api/chorus-pro`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: d.error ?? t("settingsChorusPro.toast.saveError"), variant: "destructive" }); return; }
      toast({ title: t("settingsChorusPro.toast.saved") });
      await charger();
    } finally { setEnCours(""); }
  };

  const tester = async () => {
    setEnCours("test");
    try {
      const r = await fetch(`${API}/api/chorus-pro/test`, { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) toast({ title: t("settingsChorusPro.toast.testOk") });
      else toast({ title: t("settingsChorusPro.toast.testFail"), description: d.error, variant: "destructive" });
    } finally { setEnCours(""); }
  };

  const suivre = async () => {
    setEnCours("suivi");
    try {
      const r = await fetch(`${API}/api/chorus-pro/suivi`, { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) toast({ title: t("settingsChorusPro.toast.suivi", { count: d.misesAJour ?? 0 }) });
      else toast({ title: d.error ?? t("settingsChorusPro.toast.suiviError"), variant: "destructive" });
    } finally { setEnCours(""); }
  };

  const chercherStructure = async () => {
    setEnCours("structure");
    try {
      const r = await fetch(`${API}/api/chorus-pro/structure`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siret }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: d.error ?? t("settingsChorusPro.toast.structureError"), variant: "destructive" }); return; }
      const trouvees = Array.isArray(d.listeStructures) ? d.listeStructures.length : 0;
      toast({
        title: trouvees > 0
          ? t("settingsChorusPro.toast.structureFound", { count: trouvees })
          : t("settingsChorusPro.toast.structureNone"),
      });
    } finally { setEnCours(""); }
  };

  const retirer = async () => {
    if (!(await confirmAction({ title: t("settingsChorusPro.confirmDelete"), destructive: true }))) return;
    await fetch(`${API}/api/chorus-pro`, { method: "DELETE", credentials: "include" });
    setForm(FORM_VIDE);
    await charger();
  };

  const champ = (cle: keyof typeof form, id: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(`settingsChorusPro.fields.${cle}`)}</Label>
      <Input id={id} value={form[cle]} onChange={(e) => setForm((f) => ({ ...f, [cle]: e.target.value }))} {...props} />
    </div>
  );

  if (!etat) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" aria-label={t("common.loading")} /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" aria-hidden="true" />
          {t("settingsChorusPro.title")}
          {etat.configure && <Badge variant="outline">{t("settingsChorusPro.connected")}</Badge>}
        </CardTitle>
        <CardDescription>{t("settingsChorusPro.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>{t("settingsChorusPro.why")}</AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-2">
          {(["production", "qualification"] as const).map((env) => (
            <Button key={env} type="button" variant="outline" size="sm"
              onClick={() => setForm((f) => ({ ...f, ...ADRESSES_CHORUS[env] }))}>
              {t(`settingsChorusPro.env.${env}`)}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {champ("clientId", "cpro-client-id", { "aria-required": "true", autoComplete: "off" })}
          {champ("compteTechnique", "cpro-compte", { "aria-required": "true", autoComplete: "off", placeholder: "TECH_…@cpro.fr" })}
          {champ("urlBase", "cpro-url-base", { type: "url" })}
          {champ("urlJeton", "cpro-url-jeton", { type: "url" })}
          {champ("idUtilisateurCourant", "cpro-id-utilisateur", { inputMode: "numeric" })}
          {champ("syntaxeFlux", "cpro-syntaxe")}
          <div className="space-y-1.5">
            <Label htmlFor="cpro-client-secret">{t("settingsChorusPro.fields.clientSecret")}</Label>
            <Input id="cpro-client-secret" type="password" autoComplete="new-password"
              aria-required={etat.configure ? undefined : "true"} aria-describedby="cpro-secret-aide"
              value={form.clientSecret} onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))} />
            <p id="cpro-secret-aide" className="text-xs text-muted-foreground">
              {etat.secretEnregistre ? t("settingsChorusPro.secretKept") : t("settingsChorusPro.secretHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpro-mot-de-passe">{t("settingsChorusPro.fields.motDePasseTechnique")}</Label>
            <Input id="cpro-mot-de-passe" type="password" autoComplete="new-password"
              aria-required={etat.configure ? undefined : "true"} aria-describedby="cpro-mdp-aide"
              value={form.motDePasseTechnique} onChange={(e) => setForm((f) => ({ ...f, motDePasseTechnique: e.target.value }))} />
            <p id="cpro-mdp-aide" className="text-xs text-muted-foreground">
              {etat.motDePasseEnregistre ? t("settingsChorusPro.secretKept") : t("settingsChorusPro.motDePasseHint")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={enregistrer} disabled={enCours !== ""}>
            {enCours === "save" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4 mr-2" aria-hidden="true" />}
            {t("settingsChorusPro.save")}
          </Button>
          {etat.configure && (
            <>
              <Button variant="outline" onClick={tester} disabled={enCours !== ""}>
                {enCours === "test" && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                {t("settingsChorusPro.test")}
              </Button>
              <Button variant="outline" onClick={suivre} disabled={enCours !== ""}>
                {enCours === "suivi" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />}
                {t("settingsChorusPro.suivi")}
              </Button>
              <Button variant="outline" onClick={retirer} disabled={enCours !== ""}>
                <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                {t("settingsChorusPro.delete")}
              </Button>
            </>
          )}
        </div>

        {etat.configure && (
          <div className="space-y-1.5 border-t pt-4">
            <Label htmlFor="cpro-siret">{t("settingsChorusPro.structure.label")}</Label>
            <div className="flex flex-wrap gap-2">
              <Input id="cpro-siret" className="max-w-xs" inputMode="numeric" placeholder="130 025 265 00013"
                aria-describedby="cpro-siret-aide"
                value={siret} onChange={(e) => setSiret(e.target.value)} />
              <Button variant="outline" onClick={chercherStructure} disabled={enCours !== "" || siret.replace(/\D/g, "").length !== 14}>
                {enCours === "structure" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Search className="w-4 h-4 mr-2" aria-hidden="true" />}
                {t("settingsChorusPro.structure.search")}
              </Button>
            </div>
            <p id="cpro-siret-aide" className="text-xs text-muted-foreground">{t("settingsChorusPro.structure.hint")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
