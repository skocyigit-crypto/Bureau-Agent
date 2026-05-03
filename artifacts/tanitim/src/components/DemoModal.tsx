import { useState } from "react";
import { X, Loader2, CheckCircle2, PhoneCall, Calendar, Users, Building2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";

interface DemoModalProps {
  open: boolean;
  onClose: () => void;
}

export function DemoModal({ open, onClose }: DemoModalProps) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    company: "", employeeCount: "", message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/public/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
      } else {
        setError(data.error || "Une erreur est survenue. Veuillez réessayer.");
      }
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setSuccess(false);
      setError("");
      setForm({ firstName: "", lastName: "", email: "", phone: "", company: "", employeeCount: "", message: "" });
    }, 300);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative bg-background rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-border"
          >
            <button
              onClick={handleClose}
              className="absolute top-5 right-5 z-10 w-9 h-9 rounded-full bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {success ? (
              <div className="p-12 text-center flex flex-col items-center gap-6">
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground mb-3">Demande envoyée !</h2>
                  <p className="text-muted-foreground text-lg leading-relaxed">
                    Merci <strong>{form.firstName}</strong> ! Notre équipe vous contactera dans les <strong>24 heures ouvrées</strong> pour planifier votre démonstration personnalisée.
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">Un email de confirmation a été envoyé à <strong>{form.email}</strong>.</p>
                <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
                  <a href="/register" className="flex-1">
                    <Button className="w-full h-12 bg-primary text-primary-foreground font-bold text-base">
                      Démarrer l'essai gratuit
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </a>
                  <Button variant="outline" className="flex-1 h-12" onClick={handleClose}>
                    Fermer
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-8">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shrink-0">
                    <Calendar className="w-7 h-7" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">Planifier une démonstration</h2>
                    <p className="text-muted-foreground mt-1">Session personnalisée de 30 min avec notre équipe produit.</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-8 p-4 bg-muted/30 rounded-2xl border border-border/60">
                  {[
                    { icon: <PhoneCall className="w-4 h-4" />, label: "Démo en visio" },
                    { icon: <Users className="w-4 h-4" />, label: "Équipe dédiée" },
                    { icon: <Building2 className="w-4 h-4" />, label: "Sur mesure" },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col items-center gap-2 text-center">
                      <div className="text-primary">{item.icon}</div>
                      <span className="text-xs font-semibold text-muted-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>

                <form onSubmit={submit} className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="demo-firstName">Prénom *</Label>
                      <Input id="demo-firstName" value={form.firstName} onChange={set("firstName")} placeholder="Jean" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="demo-lastName">Nom *</Label>
                      <Input id="demo-lastName" value={form.lastName} onChange={set("lastName")} placeholder="Dupont" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="demo-email">Email professionnel *</Label>
                      <Input id="demo-email" type="email" value={form.email} onChange={set("email")} placeholder="jean@societe.fr" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="demo-phone">Téléphone</Label>
                      <Input id="demo-phone" value={form.phone} onChange={set("phone")} placeholder="+33 6 12 34 56 78" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="demo-company">Société *</Label>
                      <Input id="demo-company" value={form.company} onChange={set("company")} placeholder="Ma Société SAS" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="demo-employees">Taille de l'équipe</Label>
                      <select
                        id="demo-employees"
                        value={form.employeeCount}
                        onChange={set("employeeCount")}
                        className="w-full h-10 px-3 py-2 bg-background border border-input rounded-md text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      >
                        <option value="">Choisir...</option>
                        <option value="1-5">1 à 5 personnes</option>
                        <option value="6-15">6 à 15 personnes</option>
                        <option value="16-50">16 à 50 personnes</option>
                        <option value="51-100">51 à 100 personnes</option>
                        <option value="100+">Plus de 100</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="demo-message">Vos besoins spécifiques</Label>
                    <Textarea
                      id="demo-message"
                      value={form.message}
                      onChange={set("message")}
                      placeholder="Dites-nous en plus sur votre activité, vos défis actuels et ce que vous souhaitez voir lors de la démonstration..."
                      rows={3}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg border border-destructive/20">
                      {error}
                    </p>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <Button type="submit" disabled={submitting} className="flex-1 h-13 text-base font-bold bg-primary text-primary-foreground h-12">
                      {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Envoi en cours...</> : <>Envoyer ma demande <ArrowRight className="ml-2 w-4 h-4" /></>}
                    </Button>
                    <Button type="button" variant="outline" className="h-12" onClick={handleClose}>
                      Annuler
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    Aucune carte bancaire requise • Réponse sous 24h ouvrées • Données protégées RGPD
                  </p>
                </form>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
