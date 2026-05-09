import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Send, Brain, Loader2, X, ChevronRight, ChevronLeft, Eye, Edit3, Sparkles, RefreshCw, User, Building, AlertTriangle, CheckCircle2, FileText, Copy, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { useListContacts, useDraftAiEmail } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { GhostTextarea } from "@/components/ghost-textarea";

type ComposerStep = "configure" | "generating" | "preview" | "approved";

interface EmailComposerProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedContactId?: number;
  preselectedPurpose?: string;
}

const PURPOSE_OPTIONS = [
  { value: "suivi_appel", label: "Suivi d'appel", description: "Apres un appel telephonique" },
  { value: "relance_prospect", label: "Relance prospect", description: "Relance commerciale" },
  { value: "confirmation_rdv", label: "Confirmation RDV", description: "Confirmer un rendez-vous" },
  { value: "remerciement", label: "Remerciement", description: "Apres un echange" },
  { value: "rappel_paiement", label: "Rappel de paiement", description: "Facture ou paiement" },
  { value: "information", label: "Information", description: "Transmettre des documents" },
  { value: "presentation", label: "Presentation", description: "Presenter des services" },
  { value: "excuses", label: "Excuses", description: "Pour un desagrement" },
  { value: "bienvenue", label: "Bienvenue", description: "Nouveau contact" },
  { value: "personnalise", label: "Personnalise", description: "Instructions libres" },
];

const TONE_OPTIONS = [
  { value: "formel", label: "Formel", color: "bg-slate-500" },
  { value: "cordial", label: "Cordial", color: "bg-blue-500" },
  { value: "direct", label: "Direct", color: "bg-amber-500" },
  { value: "empathique", label: "Empathique", color: "bg-emerald-500" },
];

export function EmailComposer({ isOpen, onClose, preselectedContactId, preselectedPurpose }: EmailComposerProps) {
  const [step, setStep] = useState<ComposerStep>("configure");
  const [selectedContactId, setSelectedContactId] = useState<string>(preselectedContactId?.toString() || "none");
  const [purpose, setPurpose] = useState(preselectedPurpose || "");
  const [tone, setTone] = useState("cordial");
  const [additionalContext, setAdditionalContext] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [selectedAlternative, setSelectedAlternative] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);

  const { data: contactsData } = useListContacts({ limit: 200 }, { query: { queryKey: ["contacts", "all-composer"] } });
  const draftEmail = useDraftAiEmail();
  const { toast } = useToast();

  const selectedContact = contactsData?.contacts?.find(c => c.id.toString() === selectedContactId);

  const [generationId, setGenerationId] = useState(0);

  const resetComposer = useCallback(() => {
    setStep("configure");
    setSelectedContactId(preselectedContactId?.toString() || "none");
    setPurpose(preselectedPurpose || "");
    setTone("cordial");
    setAdditionalContext("");
    setRecipientEmail("");
    setEditedSubject("");
    setEditedBody("");
    setIsEditing(false);
    setSelectedAlternative(null);
    setIsSending(false);
    setGenerationId(id => id + 1);
  }, [preselectedContactId, preselectedPurpose]);

  const handleClose = () => {
    resetComposer();
    onClose();
  };

  const handleGenerate = () => {
    if (!purpose) {
      toast({ title: "Objectif requis", description: "Veuillez selectionner l'objectif de l'e-mail.", variant: "destructive" });
      return;
    }

    setStep("generating");
    const currentGenId = generationId;

    draftEmail.mutate({
      data: {
        contactId: selectedContactId !== "none" ? selectedContactId : null,
        contactName: selectedContact ? `${selectedContact.firstName} ${selectedContact.lastName}` : null,
        contactEmail: selectedContact?.email || recipientEmail || null,
        company: selectedContact?.company || null,
        category: selectedContact?.category || null,
        purpose: purpose as any,
        tone: tone as any,
        additionalContext: additionalContext || null,
      }
    }, {
      onSuccess: (data) => {
        if (currentGenId !== generationId) return;
        setEditedSubject(data.objet);
        setEditedBody(data.corps);
        if (selectedContact?.email) {
          setRecipientEmail(selectedContact.email);
        }
        setStep("preview");
      },
      onError: () => {
        if (currentGenId !== generationId) return;
        toast({ title: "Erreur de generation", description: "L'IA n'a pas pu generer l'e-mail. Reessayez.", variant: "destructive" });
        setStep("configure");
      }
    });
  };

  const handleApplyAlternative = (index: number) => {
    if (!draftEmail.data?.suggestionsAlternatives?.[index]) return;
    const alt = draftEmail.data.suggestionsAlternatives[index];
    setEditedSubject(alt.objet);
    setEditedBody(alt.corps);
    setSelectedAlternative(index);
    setIsEditing(false);
  };

  const handleRevertToOriginal = () => {
    if (!draftEmail.data) return;
    setEditedSubject(draftEmail.data.objet);
    setEditedBody(draftEmail.data.corps);
    setSelectedAlternative(null);
    setIsEditing(false);
  };

  const handleApproveAndSend = async () => {
    if (!recipientEmail) {
      toast({ title: "Adresse e-mail requise", description: "Veuillez renseigner l'adresse e-mail du destinataire.", variant: "destructive" });
      return;
    }

    setIsSending(true);

    try {
      await handleCopyToClipboard();
    } catch (err) {
      toast({ title: "Erreur", description: "Impossible de copier l'e-mail.", variant: "destructive" });
    }

    setStep("approved");
    setIsSending(false);
  };

  const handleCopyToClipboard = async () => {
    const emailText = `A: ${recipientEmail}\nObjet: ${editedSubject}\n\n${editedBody}`;
    try {
      await navigator.clipboard.writeText(emailText);
      toast({ title: "E-mail copie", description: "L'e-mail a ete copie dans le presse-papiers." });
    } catch {
      toast({ title: "Erreur", description: "Impossible de copier dans le presse-papiers.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-card border-b">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div>
                <span className="text-lg">Compositeur d'e-mail IA</span>
                <p className="text-sm font-normal text-muted-foreground mt-0.5">
                  {step === "configure" && "Configurez les parametres de votre e-mail"}
                  {step === "generating" && "L'IA redige votre e-mail..."}
                  {step === "preview" && "Verifiez et approuvez avant envoi"}
                  {step === "approved" && "E-mail pret a etre envoye"}
                </p>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 pb-3">
            <div className="flex items-center gap-2">
              {["configure", "generating", "preview", "approved"].map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    step === s ? "bg-primary text-primary-foreground" :
                    ["configure", "generating", "preview", "approved"].indexOf(step) > i ? "bg-emerald-500 text-white" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {["configure", "generating", "preview", "approved"].indexOf(step) > i ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : i + 1}
                  </div>
                  {i < 3 && <div className={`w-8 h-0.5 ${["configure", "generating", "preview", "approved"].indexOf(step) > i ? "bg-emerald-500" : "bg-muted"}`} />}
                </div>
              ))}
              <div className="flex-1" />
              <div className="text-xs text-muted-foreground">
                {step === "configure" && "Etape 1/3"}
                {step === "generating" && "Generation..."}
                {step === "preview" && "Etape 2/3"}
                {step === "approved" && "Etape 3/3"}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 pt-4">
          <AnimatePresence mode="wait">
            {step === "configure" && (
              <motion.div key="configure" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Destinataire</Label>
                  <Select value={selectedContactId} onValueChange={(v) => {
                    setSelectedContactId(v);
                    const c = contactsData?.contacts?.find(ct => ct.id.toString() === v);
                    setRecipientEmail(c?.email || "");
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir un contact..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Destinataire libre</SelectItem>
                      {contactsData?.contacts?.map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          <div className="flex items-center gap-2">
                            <span>{c.firstName} {c.lastName}</span>
                            {c.company && <span className="text-muted-foreground">- {c.company}</span>}
                            {c.email && <Badge variant="secondary" className="text-[10px] ml-1">{c.email}</Badge>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedContactId === "none" && (
                    <Input
                      placeholder="adresse@email.com"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      className="mt-2"
                    />
                  )}
                  {selectedContact && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 mt-2">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{selectedContact.firstName} {selectedContact.lastName}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {selectedContact.company && <span className="flex items-center gap-1"><Building className="w-3 h-3" />{selectedContact.company}</span>}
                          {selectedContact.email && <span>{selectedContact.email}</span>}
                          <Badge variant="secondary" className="text-[10px]">{selectedContact.category}</Badge>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Objectif de l'e-mail</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {PURPOSE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={`text-left p-3 rounded-lg border transition-all ${
                          purpose === opt.value
                            ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                            : "border-border hover:border-primary/30 hover:bg-muted/50"
                        }`}
                        onClick={() => setPurpose(opt.value)}
                      >
                        <div className="text-sm font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground">{opt.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Ton souhaite</Label>
                  <div className="flex gap-2">
                    {TONE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={`flex-1 p-2.5 rounded-lg border text-center transition-all ${
                          tone === opt.value
                            ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                            : "border-border hover:border-primary/30"
                        }`}
                        onClick={() => setTone(opt.value)}
                      >
                        <div className={`w-3 h-3 rounded-full ${opt.color} mx-auto mb-1`} />
                        <span className="text-xs font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {purpose === "personnalise" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Instructions pour l'IA</Label>
                    <Textarea
                      placeholder="Decrivez ce que vous souhaitez dans cet e-mail..."
                      value={additionalContext}
                      onChange={(e) => setAdditionalContext(e.target.value)}
                      className="h-24 resize-none"
                    />
                  </div>
                )}

                {purpose !== "personnalise" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Contexte supplementaire (optionnel)</Label>
                    <Textarea
                      placeholder="Ajoutez des details ou instructions specifiques..."
                      value={additionalContext}
                      onChange={(e) => setAdditionalContext(e.target.value)}
                      className="h-16 resize-none"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={handleClose}>Annuler</Button>
                  <Button onClick={handleGenerate} disabled={!purpose} className="gap-2">
                    <Brain className="w-4 h-4" />
                    Generer avec l'IA
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === "generating" && (
              <motion.div key="generating" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex flex-col items-center justify-center py-16">
                <div className="relative mb-6">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <Brain className="w-10 h-10 text-primary" />
                  </div>
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-primary/30"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </div>
                <h3 className="text-lg font-semibold mb-2">L'IA redige votre e-mail</h3>
                <p className="text-sm text-muted-foreground text-center max-w-sm">
                  Analyse du contexte, de l'historique du contact et generation d'un e-mail professionnel adapte...
                </p>
                <div className="flex items-center gap-2 mt-6 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Generation en cours...
                </div>
              </motion.div>
            )}

            {step === "preview" && draftEmail.data && (
              <motion.div key="preview" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-5">
                <Card className="border-primary/20 bg-primary/[0.02]">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-md bg-primary/10">
                        <Sparkles className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">Analyse IA</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{draftEmail.data.resumeIA}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="secondary" className="text-[10px]">Ton: {draftEmail.data.tonUtilise}</Badge>
                          <Badge variant="secondary" className="text-[10px]">Destinataire: {draftEmail.data.destinataire}</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      Apercu de l'e-mail
                    </Label>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleCopyToClipboard}>
                        <Copy className="w-3 h-3" />
                        Copier
                      </Button>
                      <Button
                        variant={isEditing ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setIsEditing(!isEditing)}
                      >
                        <Edit3 className="w-3 h-3" />
                        {isEditing ? "Mode apercu" : "Modifier"}
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden">
                    <div className="bg-muted/50 px-4 py-3 border-b space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-8">A:</span>
                        {isEditing ? (
                          <Input
                            value={recipientEmail}
                            onChange={(e) => setRecipientEmail(e.target.value)}
                            className="h-7 text-sm flex-1"
                            placeholder="adresse@email.com"
                          />
                        ) : (
                          <span className="font-medium">{recipientEmail || selectedContact?.email || "Non renseigne"}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-8">Obj:</span>
                        {isEditing ? (
                          <Input
                            value={editedSubject}
                            onChange={(e) => setEditedSubject(e.target.value)}
                            className="h-7 text-sm flex-1 font-medium"
                          />
                        ) : (
                          <span className="font-medium">{editedSubject}</span>
                        )}
                      </div>
                    </div>
                    <div className="p-4">
                      {isEditing ? (
                        <GhostTextarea
                          fieldType="email_body"
                          context={{
                            title: editedSubject,
                            contactName: selectedContact ? `${selectedContact.firstName} ${selectedContact.lastName}` : null,
                          }}
                          value={editedBody}
                          onChange={(e) => setEditedBody(e.target.value)}
                          className="min-h-[250px] resize-none border-0 p-0 focus-visible:ring-0 text-sm leading-relaxed"
                        />
                      ) : (
                        <div className="text-sm leading-relaxed whitespace-pre-wrap min-h-[200px]">
                          {editedBody}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {draftEmail.data.suggestionsAlternatives && draftEmail.data.suggestionsAlternatives.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      Alternatives proposees par l'IA
                    </Label>
                    <div className="grid gap-2">
                      {draftEmail.data.suggestionsAlternatives.map((alt, i) => (
                        <button
                          key={i}
                          className={`text-left p-3 rounded-lg border transition-all ${
                            selectedAlternative === i
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/30 hover:bg-muted/30"
                          }`}
                          onClick={() => handleApplyAlternative(i)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{alt.label}</span>
                            {selectedAlternative === i && <Badge className="text-[10px] bg-primary">Selectionne</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">Objet: {alt.objet}</p>
                        </button>
                      ))}
                      {selectedAlternative !== null && (
                        <Button variant="ghost" size="sm" className="text-xs" onClick={handleRevertToOriginal}>
                          Revenir a la version originale
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <Separator />

                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Verification requise</p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        Veuillez relire attentivement l'e-mail avant de l'approuver. L'IA peut generer du contenu inexact.
                        Vous etes responsable du contenu final envoye.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep("configure")} className="gap-2">
                    <ChevronLeft className="w-4 h-4" />
                    Modifier les parametres
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={handleGenerate} className="gap-2">
                      <RefreshCw className="w-4 h-4" />
                      Regenerer
                    </Button>
                    <Button onClick={handleApproveAndSend} disabled={isSending || !recipientEmail} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                      {isSending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      {isSending ? "Preparation..." : "Approuver et copier"}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}

            {step === "approved" && (
              <motion.div key="approved" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center py-12">
                <motion.div
                  className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-6"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", damping: 12 }}
                >
                  <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                </motion.div>
                <h3 className="text-xl font-bold mb-2">E-mail approuve et pret</h3>
                <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
                  L'e-mail a ete copie dans le presse-papiers. Collez-le dans votre client de messagerie pour l'envoyer a {recipientEmail}.
                  Connectez Gmail dans les Parametres pour l'envoi direct.
                </p>
                <div className="border rounded-lg p-4 w-full max-w-md bg-muted/30">
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Destinataire:</span>
                      <span className="font-medium text-foreground">{recipientEmail}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Objet:</span>
                      <span className="font-medium text-foreground truncate ml-4">{editedSubject}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Statut:</span>
                      <Badge className="bg-emerald-500 text-white text-[10px]">Pret</Badge>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-8">
                  <Button variant="outline" onClick={handleClose}>Fermer</Button>
                  <Button onClick={() => { resetComposer(); }} className="gap-2">
                    <Mail className="w-4 h-4" />
                    Nouvel e-mail
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
