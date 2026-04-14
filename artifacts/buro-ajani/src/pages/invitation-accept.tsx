import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, XCircle, ShieldCheck, Eye, Lock, AlertTriangle, Phone
} from "lucide-react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/";

interface InvitationInfo {
  valid: boolean;
  email: string;
  role: string;
  organisationName: string;
  invitedBy: string;
}

const ROLE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  administrateur: { label: "Administrateur", icon: ShieldCheck },
  agent: { label: "Agent", icon: Phone },
  lecture_seule: { label: "Lecture seule", icon: Eye },
};

export default function InvitationAcceptPage() {
  const [, params] = useRoute("/invitation/:token");
  const token = params?.token;
  const [, navigate] = useLocation();
  const { toast } = useToast();

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
          setError(data.error || "Invitation invalide.");
        }
      } catch {
        setError("Impossible de verifier l'invitation.");
      } finally {
        setLoading(false);
      }
    }
    if (token) verify();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.prenom || !form.nom || !form.password) {
      toast({ title: "Erreur", description: "Tous les champs sont obligatoires.", variant: "destructive" });
      return;
    }

    if (form.password.length < 8) {
      toast({ title: "Erreur", description: "Le mot de passe doit contenir au moins 8 caracteres.", variant: "destructive" });
      return;
    }

    if (form.password !== form.confirmPassword) {
      toast({ title: "Erreur", description: "Les mots de passe ne correspondent pas.", variant: "destructive" });
      return;
    }

    const hasUpper = /[A-Z]/.test(form.password);
    const hasLower = /[a-z]/.test(form.password);
    const hasNum = /[0-9]/.test(form.password);
    if (!hasUpper || !hasLower || !hasNum) {
      toast({ title: "Erreur", description: "Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre.", variant: "destructive" });
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
        toast({ title: "Compte cree avec succes !", description: data.message });
        setTimeout(() => {
          window.location.href = import.meta.env.BASE_URL.replace(/\/$/, "") + "/";
        }, 2000);
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la creation du compte.", variant: "destructive" });
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
            <h2 className="text-xl font-bold">Invitation invalide</h2>
            <p className="text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => navigate("/")}>Retour a la connexion</Button>
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
            <h2 className="text-xl font-bold">Bienvenue !</h2>
            <p className="text-muted-foreground">Votre compte a ete cree avec succes. Redirection en cours...</p>
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-amber-500" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const roleInfo = ROLE_LABELS[invitation?.role || "agent"] || ROLE_LABELS.agent;
  const RoleIcon = roleInfo.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/30">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0f1729" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </div>
          <CardTitle className="text-xl">Rejoignez {invitation?.organisationName}</CardTitle>
          <CardDescription>
            {invitation?.invitedBy} vous invite a rejoindre l'equipe
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-2 mb-6">
            <Badge variant="outline" className="gap-1.5 py-1 px-3">
              <RoleIcon className="w-3.5 h-3.5" />
              {roleInfo.label}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 py-1 px-3">
              <Lock className="w-3.5 h-3.5" />
              {invitation?.email}
            </Badge>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Prenom *</Label>
                <Input placeholder="Votre prenom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Nom *</Label>
                <Input placeholder="Votre nom" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mot de passe *</Label>
              <Input type="password" placeholder="Minimum 8 caracteres" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">Au moins 8 caracteres, une majuscule, une minuscule et un chiffre.</p>
            </div>
            <div className="space-y-2">
              <Label>Confirmer le mot de passe *</Label>
              <Input type="password" placeholder="Retapez votre mot de passe" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
            </div>

            {form.password && form.password.length >= 8 && (
              <div className="space-y-1">
                {[
                  { test: /[A-Z]/.test(form.password), label: "Une majuscule" },
                  { test: /[a-z]/.test(form.password), label: "Une minuscule" },
                  { test: /[0-9]/.test(form.password), label: "Un chiffre" },
                  { test: form.password.length >= 8, label: "8 caracteres minimum" },
                  { test: form.password === form.confirmPassword && form.confirmPassword !== "", label: "Mots de passe identiques" },
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
              Creer mon compte
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
