import { useState, type ReactNode } from "react";
import { X, Loader2, CheckCircle2, PhoneCall, FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";

export type ContactKind = "rappel" | "devis";

interface ContactModalProps {
  open: boolean;
  kind: ContactKind;
  onClose: () => void;
}

const COPY: Record<ContactKind, {
  icon: ReactNode;
  title: string;
  subtitle: string;
  cta: string;
  successTitle: string;
  successBody: (firstName: string) => string;
  phoneRequired: boolean;
  showBudget: boolean;
}> = {
  rappel: {
    icon: <PhoneCall className="w-7 h-7" />,
    title: "Être rappelé par notre équipe",
    subtitle: "Laissez-nous votre numéro, nous vous rappelons sous 2 heures ouvrées.",
    cta: "Demander un rappel",
    successTitle: "Demande de rappel envoyée !",
    successBody: (fn) => `Merci ${fn} ! Notre équipe vous appelle dans les 2 heures ouvrées.`,
    phoneRequired: true,
    showBudget: false,
  },
  devis: {
    icon: <FileText className="w-7 h-7" />,
    title: "Demander un devis sur mesure",
    subtitle: "Solution personnalisée pour votre organisation. Réponse sous 24h ouvrées.",
    cta: "Demander mon devis",
    successTitle: "Demande de devis envoyée !",
    successBody: (fn) => `Merci ${fn} ! Notre équipe commerciale vous envoie une proposition personnalisée sous 24h ouvrées.`,
    phoneRequired: false,
    showBudget: true,
  },
};

export function ContactModal({ open, kind, onClose }: ContactModalProps) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    company: "", employeeCount: "", budget: "", message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const copy = COPY[kind];

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/public/contact-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...form }),
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
      setForm({ firstName: "", lastName: "", email: "", phone: "", company: "", employeeCount: "", budget: "", message: "" });
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
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>

            {success ? (
              <div className="p-12 text-center flex flex-col items-center gap-6">
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground mb-3">{copy.successTitle}</h2>
                  <p className="text-muted-foreground text-lg leading-relaxed">
                    {copy.successBody(form.firstName)}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">Un email de confirmation a été envoyé à <strong>{form.email}</strong>.</p>
                <Button variant="outline" className="h-12 w-full sm:w-auto px-8" onClick={handleClose}>
                  Fermer
                </Button>
              </div>
            ) : (
              <div className="p-8">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shrink-0">
                    {copy.icon}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">{copy.title}</h2>
                    <p className="text-muted-foreground mt-1">{copy.subtitle}</p>
                  </div>
                </div>

                <form onSubmit={submit} className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-firstName">Prénom *</Label>
                      <Input id="contact-firstName" value={form.firstName} onChange={set("firstName")} placeholder="Jean" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-lastName">Nom *</Label>
                      <Input id="contact-lastName" value={form.lastName} onChange={set("lastName")} placeholder="Dupont" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-email">Email professionnel *</Label>
                      <Input id="contact-email" type="email" value={form.email} onChange={set("email")} placeholder="jean@societe.fr" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-phone">Téléphone {copy.phoneRequired ? "*" : ""}</Label>
                      <Input id="contact-phone" value={form.phone} onChange={set("phone")} placeholder="+33 6 12 34 56 78" required={copy.phoneRequired} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-company">Société *</Label>
                      <Input id="contact-company" value={form.company} onChange={set("company")} placeholder="Ma Société SAS" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-employees">Taille de l'équipe</Label>
                      <select
                        id="contact-employees"
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

                  {copy.showBudget && (
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-budget">Budget mensuel indicatif</Label>
                      <select
                        id="contact-budget"
                        value={form.budget}
                        onChange={set("budget")}
                        className="w-full h-10 px-3 py-2 bg-background border border-input rounded-md text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      >
                        <option value="">Choisir...</option>
                        <option value="< 200 €">Moins de 200 €</option>
                        <option value="200-500 €">200 à 500 €</option>
                        <option value="500-1500 €">500 à 1 500 €</option>
                        <option value="1500-5000 €">1 500 à 5 000 €</option>
                        <option value="> 5000 €">Plus de 5 000 €</option>
                        <option value="à définir">À définir ensemble</option>
                      </select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="contact-message">
                      {kind === "rappel" ? "Sujet de l'appel (optionnel)" : "Vos besoins spécifiques"}
                    </Label>
                    <Textarea
                      id="contact-message"
                      value={form.message}
                      onChange={set("message")}
                      placeholder={kind === "rappel"
                        ? "Une question précise, un horaire préféré pour le rappel..."
                        : "Décrivez votre activité, le nombre de lignes téléphoniques, vos intégrations actuelles, vos contraintes..."}
                      rows={3}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg border border-destructive/20">
                      {error}
                    </p>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <Button type="submit" disabled={submitting} className="flex-1 h-12 text-base font-bold bg-primary text-primary-foreground">
                      {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Envoi en cours...</> : <>{copy.cta} <ArrowRight className="ml-2 w-4 h-4" /></>}
                    </Button>
                    <Button type="button" variant="outline" className="h-12" onClick={handleClose}>
                      Annuler
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    Aucune carte bancaire requise • Données protégées RGPD
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
