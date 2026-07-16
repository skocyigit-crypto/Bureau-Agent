import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon3D } from "@/components/icon-3d";
import { Phone, Lock, Mail, AlertTriangle, Eye, EyeOff, Shield, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface LoginPageProps {
  onLogin: (user: any) => void;
  onRegister?: () => void;
}

type Mode = "login" | "forgot" | "reset" | "forgot_done";

export default function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset_token");
    if (token) {
      setResetToken(token);
      setMode("reset");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erreur de connexion."); setLoading(false); return; }
      onLogin(data);
    } catch {
      setError("Erreur de connexion au serveur.");
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await fetch(`${BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setMode("forgot_done");
    } catch {
      setError("Erreur lors de l'envoi. Reessayez.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) { setError("Les mots de passe ne correspondent pas."); return; }
    if (newPassword.length < 8) { setError("Le mot de passe doit contenir au moins 8 caracteres."); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
      setMode("login");
      setError("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Erreur lors de la reinitialisation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1729] via-[#1a2744] to-[#0f1729] p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative z-10 border-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-[#1a2744] to-[#2d3f5e] shadow-lg">
              <Phone className="w-8 h-8 text-amber-400" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">
            {mode === "login" && "Ajant Bureau"}
            {mode === "forgot" && "Mot de passe oublié"}
            {mode === "forgot_done" && "Email envoyé"}
            {mode === "reset" && "Nouveau mot de passe"}
          </CardTitle>
          <CardDescription className="text-sm">
            {mode === "login" && "Connectez-vous a votre espace de travail"}
            {mode === "forgot" && "Entrez votre email pour recevoir un lien de reinitialisation"}
            {mode === "forgot_done" && `Vérifiez votre boîte mail : ${email}`}
            {mode === "reset" && "Choisissez votre nouveau mot de passe"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert variant="destructive" className="border-red-200 bg-red-50 dark:bg-red-950/30 mb-4">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">Adresse email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="email" type="email" placeholder="nom@agentdebureau.fr" value={email}
                    onChange={e => setEmail(e.target.value)} className="pl-10" required autoComplete="email" autoFocus />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium">Mot de passe</Label>
                  <button type="button" onClick={() => { setMode("forgot"); setError(""); }}
                    className="text-xs text-primary hover:underline">
                    Mot de passe oublié ?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="password" type={showPassword ? "text" : "password"} placeholder="Votre mot de passe"
                    value={password} onChange={e => setPassword(e.target.value)}
                    className="pl-10 pr-10" required autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full bg-gradient-to-r from-[#1a2744] to-[#2d3f5e] hover:from-[#243358] hover:to-[#3a5078] text-white font-medium h-11" disabled={loading}>
                {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Connexion...</> : "Se connecter"}
              </Button>
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgotEmail" className="text-sm font-medium">Adresse email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="forgotEmail" type="email" placeholder="nom@exemple.fr" value={email}
                    onChange={e => setEmail(e.target.value)} className="pl-10" required autoFocus />
                </div>
              </div>
              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Envoi...</> : "Envoyer le lien"}
              </Button>
              <button type="button" onClick={() => { setMode("login"); setError(""); }}
                className="w-full flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-3 h-3" /> Retour à la connexion
              </button>
            </form>
          )}

          {mode === "forgot_done" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="p-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
                <p className="text-sm text-center text-muted-foreground">
                  Si un compte existe avec cet email, vous recevrez un lien valable <strong>1 heure</strong>. Pensez à vérifier vos spams.
                </p>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={() => { setMode("login"); setError(""); }}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Retour à la connexion
              </Button>
            </div>
          )}

          {mode === "reset" && (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPass" className="text-sm font-medium">Nouveau mot de passe</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="newPass" type={showPassword ? "text" : "password"} placeholder="Min. 8 caracteres"
                    value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    className="pl-10 pr-10" required minLength={8} autoFocus />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPass" className="text-sm font-medium">Confirmer le mot de passe</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="confirmPass" type={showPassword ? "text" : "password"} placeholder="Repetez le mot de passe"
                    value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="pl-10" required />
                </div>
              </div>
              <Button type="submit" className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
                {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Reinitialisation...</> : "Definir le nouveau mot de passe"}
              </Button>
            </form>
          )}

          {mode === "login" && (
            <>
              <div className="mt-6 pt-4 border-t">
                <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Shield className="w-3 h-3 text-emerald-500" />
                    <span>Connexion securisee</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Lock className="w-3 h-3 text-emerald-500" />
                    <span>Chiffrement TLS</span>
                  </div>
                </div>
              </div>
              {onRegister && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-muted-foreground mb-2">Vous n'avez pas encore de compte ?</p>
                  <Button type="button" variant="outline" className="w-full" onClick={onRegister}>
                    Creer un compte gratuit
                  </Button>
                </div>
              )}
              <div className="mt-4 text-center">
                <p className="text-xs text-muted-foreground">SK GROUP - Solution professionnelle</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
