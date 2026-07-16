import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, Lock, Mail, AlertTriangle, Eye, EyeOff, Shield, Building, User, ArrowLeft, Check, Sparkles, Monitor, Smartphone } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RegisterPageProps {
  onLogin: (user: any) => void;
  onBack: () => void;
}

export default function RegisterPage({ onLogin, onBack }: RegisterPageProps) {
  const [step, setStep] = useState<"form" | "success">("form");
  const [orgName, setOrgName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!orgName.trim() || orgName.trim().length < 2) {
      setError("Le nom de l'organisation doit contenir au moins 2 caracteres.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError("Le prenom et le nom sont requis.");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Une adresse email valide est requise.");
      return;
    }
    const normalizedPhone = phone.trim().replace(/[\s.\-()]/g, "");
    if (normalizedPhone && !/^(\+?\d{8,15})$/.test(normalizedPhone)) {
      setError("Le numéro de téléphone n'est pas valide (8 à 15 chiffres, format international accepté).");
      return;
    }
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      setError("Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);

    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          orgName: orgName.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: normalizedPhone || undefined,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erreur lors de l'inscription.");
        setLoading(false);
        return;
      }

      setResult(data);
      setStep("success");
      setLoading(false);
    } catch {
      setError("Erreur de connexion au serveur.");
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (result?.user) {
      onLogin(result.user);
    }
  };

  if (step === "success" && result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1729] via-[#1a2744] to-[#0f1729] p-4">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        </div>

        <Card className="w-full max-w-lg relative z-10 border-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg">
                <Check className="w-8 h-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-emerald-600">Compte cree avec succes !</CardTitle>
            <CardDescription>
              Bienvenue sur Ajant Bureau, {result.user?.prenom} !
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Organisation</span>
                  <span className="font-semibold">{result.organisation?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-semibold">{result.subscription?.plan}</span>
                </div>
                {result.subscription?.trialEndsAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Essai gratuit jusqu'au</span>
                    <span className="font-semibold text-amber-600">
                      {new Date(result.subscription.trialEndsAt).toLocaleDateString("fr-FR", {
                        day: "numeric", month: "long", year: "numeric"
                      })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Clé de licence</span>
                  <span className="font-mono text-xs font-bold text-amber-600">{result.licenseKey}</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">Email de bienvenue</span>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-400">
                {result.emailSent
                  ? `Un email avec vos identifiants et les instructions d'accès a été envoyé a ${email}.`
                  : `${result.emailNote || "Vérifiez votre boîte mail pour les détails d'accès."}`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border text-center">
                <Monitor className="w-5 h-5 mx-auto mb-1 text-slate-600" />
                <p className="text-xs font-medium">Application Web</p>
                <p className="text-[10px] text-muted-foreground">Disponible maintenant</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border text-center">
                <Smartphone className="w-5 h-5 mx-auto mb-1 text-slate-600" />
                <p className="text-xs font-medium">Application Mobile</p>
                <p className="text-[10px] text-muted-foreground">Via navigateur mobile</p>
              </div>
            </div>

            <Button
              className="w-full bg-gradient-to-r from-[#1a2744] to-[#2d3f5e] hover:from-[#243358] hover:to-[#3a5078] text-white font-medium h-11"
              onClick={handleContinue}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Commencer a utiliser Ajant Bureau
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Conservez votre clé de licence : <strong className="text-amber-600">{result.licenseKey}</strong>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1729] via-[#1a2744] to-[#0f1729] p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-lg relative z-10 border-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-[#1a2744] to-[#2d3f5e] shadow-lg">
              <Phone className="w-8 h-8 text-amber-400" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Creer votre compte</CardTitle>
          <CardDescription className="text-sm">
            Essai gratuit de 14 jours - Aucune carte bancaire requise
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <Alert variant="destructive" className="border-red-200 bg-red-50 dark:bg-red-950/30">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="orgName" className="text-sm font-medium">Nom de l'organisation</Label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="orgName"
                  placeholder="Ma Societe SARL"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  className="pl-10"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName" className="text-sm font-medium">Prenom</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="firstName"
                    placeholder="Jean"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName" className="text-sm font-medium">Nom</Label>
                <Input
                  id="lastName"
                  placeholder="Dupont"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="regEmail" className="text-sm font-medium">Adresse email professionnelle</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="regEmail"
                  type="email"
                  placeholder="jean@masociete.fr"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="regPhone" className="text-sm font-medium">Telephone <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="regPhone"
                  type="tel"
                  placeholder="+33 1 23 45 67 89"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="regPassword" className="text-sm font-medium">Mot de passe</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="regPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 caracteres"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="regConfirmPassword" className="text-sm font-medium">Confirmer</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="regConfirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirmer"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="pl-10"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                <strong>Essai gratuit 14 jours</strong> inclut : 3 utilisateurs, 100 contacts, 500 appels/mois.
                Passez au plan superieur a tout moment.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-medium h-11"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creation en cours...
                </span>
              ) : (
                "Creer mon compte gratuit"
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={onBack}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              Deja un compte ? Se connecter
            </button>
          </div>

          <div className="mt-4 pt-3 border-t">
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Shield className="w-3 h-3 text-emerald-500" />
                <span>Connexion securisee</span>
              </div>
              <div className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-emerald-500" />
                <span>Donnees protegees</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
