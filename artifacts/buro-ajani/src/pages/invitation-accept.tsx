import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
AlertTriangle,
CheckCircle2,
Eye,
Loader2,
Lock,
Phone,
ShieldCheck,
XCircle
} from "lucide-react";
import { useEffect,useState } from "react";
import { useLocation,useRoute } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/";

interface InvitationInfo {
  valid: boolean;
  email: string;
  role: string;
  organisationName: string;
  invitedBy: string;
}

const ROLE_ICONS: Record<string, React.ElementType> = {
  administrateur: ShieldCheck,
  agent: Phone,
  lecture_seule: Eye,
};

export default function InvitationAcceptPage() {
  const [, params] = useRoute("/invitation/:token");
  // Repli sur l'URL brute si le routeur n'a pas reconnu le chemin.
  //
  // C'est arrive en production: les e-mails d'invitation pointaient vers
  // /buro-ajani/invitation/<token> (APP_BASE_PATH par defaut) alors que
  // l'application est servie a la racine. `useRoute` ne trouvait donc pas de
  // correspondance, `token` restait undefined, la verification n'etait jamais
  // lancee et la page tournait indefiniment sur son spinner — l'utilisateur
  // voyait "l'application ne s'ouvre pas". Extraire le token de l'URL rend la
  // page insensible au prefixe utilise dans le lien.
  const token = params?.token
    ?? window.location.pathname.match(/\/invitation\/([^/?#]+)/)?.[1];
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ prenom: "", nom: "", password: "", confirmPassword: "" });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function verify() {
      try {
        const res = await fetch(`${BASE}api/invitations/verify/${token}`, { credentials: "include" });
        const data = await res.json();
        if (res.ok && data.valid) {
          setInvitation(data);
        } else {
          setError(data.error || t("invitation.errInvalid"));
        }
      } catch {
        setError(t("invitation.errVerify"));
      } finally {
        setLoading(false);
      }
    }
    if (token) {
      verify();
    } else {
      // Sans token, ne JAMAIS rester sur le spinner: on affiche une erreur
      // exploitable plutot qu'une page qui semble figee.
      setError(t("invitation.errNoToken"));
      setLoading(false);
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.prenom || !form.nom || !form.password) {
      toast({ title: t("invitation.toastErrorTitle"), description: t("invitation.allFieldsRequired"), variant: "destructive" });
      return;
    }

    if (form.password.length < 8) {
      toast({ title: t("invitation.toastErrorTitle"), description: t("invitation.passwordShort"), variant: "destructive" });
      return;
    }

    if (form.password !== form.confirmPassword) {
      toast({ title: t("invitation.toastErrorTitle"), description: t("invitation.passwordMismatch"), variant: "destructive" });
      return;
    }

    const hasUpper = /[A-Z]/.test(form.password);
    const hasLower = /[a-z]/.test(form.password);
    const hasNum = /[0-9]/.test(form.password);
    if (!hasUpper || !hasLower || !hasNum) {
      toast({ title: t("invitation.toastErrorTitle"), description: t("invitation.passwordComplexity"), variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}api/invitations/accept/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prenom: form.prenom, nom: form.nom, password: form.password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(true);
        toast({ title: t("invitation.successToastTitle"), description: data.message });
        setTimeout(() => {
          window.location.href = import.meta.env.BASE_URL.replace(/\/$/, "") + "/";
        }, 2000);
      } else {
        toast({ title: t("invitation.toastErrorTitle"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("invitation.toastErrorTitle"), description: t("invitation.createAccountError"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold">{t("invitation.invalidTitle")}</h2>
            <p className="text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => navigate("/")}>{t("invitation.backToLogin")}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-xl font-bold">{t("invitation.welcomeTitle")}</h2>
            <p className="text-muted-foreground">{t("invitation.successText")}</p>
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-amber-500" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const roleKey = (invitation?.role && ROLE_ICONS[invitation.role]) ? invitation.role : "agent";
  const RoleIcon = ROLE_ICONS[roleKey];
  const roleLabel = t(`invitation.roles.${roleKey}`);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/30">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0f1729" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </div>
          <CardTitle className="text-xl">{t("invitation.joinTitle", { org: invitation?.organisationName ?? "" })}</CardTitle>
          <CardDescription>
            {t("invitation.invitedBy", { name: invitation?.invitedBy ?? "" })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-2 mb-6">
            <Badge variant="outline" className="gap-1.5 py-1 px-3">
              <RoleIcon className="w-3.5 h-3.5" />
              {roleLabel}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 py-1 px-3">
              <Lock className="w-3.5 h-3.5" />
              {invitation?.email}
            </Badge>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="inv-prenom">{t("invitation.firstNameLabel")}</Label>
                <Input id="inv-prenom" placeholder={t("invitation.firstNamePlaceholder")} value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-nom">{t("invitation.lastNameLabel")}</Label>
                <Input id="inv-nom" placeholder={t("invitation.lastNamePlaceholder")} value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-password">{t("invitation.passwordLabel")}</Label>
              <Input id="inv-password" type="password" placeholder={t("invitation.passwordPlaceholder")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">{t("invitation.passwordHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-confirm-password">{t("invitation.confirmLabel")}</Label>
              <Input id="inv-confirm-password" type="password" placeholder={t("invitation.confirmPlaceholder")} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
            </div>

            {form.password && form.password.length >= 8 && (
              <div className="space-y-1">
                {[
                  { test: /[A-Z]/.test(form.password), label: t("invitation.ruleUpper") },
                  { test: /[a-z]/.test(form.password), label: t("invitation.ruleLower") },
                  { test: /[0-9]/.test(form.password), label: t("invitation.ruleDigit") },
                  { test: form.password.length >= 8, label: t("invitation.ruleLength") },
                  { test: form.password === form.confirmPassword && form.confirmPassword !== "", label: t("invitation.ruleMatch") },
                ].map((rule, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {rule.test ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <AlertTriangle className="w-3 h-3 text-amber-500" />}
                    <span className={rule.test ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{rule.label}</span>
                  </div>
                ))}
              </div>
            )}

            <Button type="submit" disabled={submitting} className="w-full gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-900 font-semibold h-11">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t("invitation.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
