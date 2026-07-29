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
import { useTranslation } from "@/i18n";

type ComposerStep = "configure" | "generating" | "preview" | "approved";

interface EmailComposerProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedContactId?: number;
  preselectedPurpose?: string;
}

// Cles stables; libelles/descriptions rendus via t() au point d'usage.
const PURPOSE_OPTIONS = [
  { value: "suivi_appel" },
  { value: "relance_prospect" },
  { value: "confirmation_rdv" },
  { value: "remerciement" },
  { value: "rappel_paiement" },
  { value: "information" },
  { value: "presentation" },
  { value: "excuses" },
  { value: "bienvenue" },
  { value: "personnalise" },
];

const TONE_OPTIONS = [
  { value: "formel", color: "bg-slate-500" },
  { value: "cordial", color: "bg-blue-500" },
  { value: "direct", color: "bg-amber-500" },
  { value: "empathique", color: "bg-emerald-500" },
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
  const { t } = useTranslation();

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
      toast({ title: t("emailComposer.toast.purposeRequiredTitle"), description: t("emailComposer.toast.purposeRequiredDesc"), variant: "destructive" });
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
        toast({ title: t("emailComposer.toast.genErrorTitle"), description: t("emailComposer.toast.genErrorDesc"), variant: "destructive" });
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
      toast({ title: t("emailComposer.toast.emailRequiredTitle"), description: t("emailComposer.toast.emailRequiredDesc"), variant: "destructive" });
      return;
    }

    setIsSending(true);

    try {
      await handleCopyToClipboard();
    } catch (err) {
      toast({ title: t("emailComposer.toast.errorTitle"), description: t("emailComposer.toast.copyEmailError"), variant: "destructive" });
    }

    setStep("approved");
    setIsSending(false);
  };

  const handleCopyToClipboard = async () => {
    const emailText = `A: ${recipientEmail}\nObjet: ${editedSubject}\n\n${editedBody}`;
    try {
      await navigator.clipboard.writeText(emailText);
      toast({ title: t("emailComposer.toast.copiedTitle"), description: t("emailComposer.toast.copiedDesc") });
    } catch {
      toast({ title: t("emailComposer.toast.errorTitle"), description: t("emailComposer.toast.clipboardError"), variant: "destructive" });
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
                <span className="text-lg">{t("emailComposer.title")}</span>
                <p className="text-sm font-normal text-muted-foreground mt-0.5">
                  {step === "configure" && t("emailComposer.subtitle.configure")}
                  {step === "generating" && t("emailComposer.subtitle.generating")}
                  {step === "preview" && t("emailComposer.subtitle.preview")}
                  {step === "approved" && t("emailComposer.subtitle.approved")}
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
                {step === "configure" && t("emailComposer.stepIndicator.step1")}
                {step === "generating" && t("emailComposer.stepIndicator.generating")}
                {step === "preview" && t("emailComposer.stepIndicator.step2")}
                {step === "approved" && t("emailComposer.stepIndicator.step3")}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 pt-4">
          <AnimatePresence mode="wait">
            {step === "configure" && (
              <motion.div key="configure" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("emailComposer.recipient.label")}</Label>
                  <Select value={selectedContactId} onValueChange={(v) => {
                    setSelectedContactId(v);
                    const c = contactsData?.contacts?.find(ct => ct.id.toString() === v);
                    setRecipientEmail(c?.email || "");
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("emailComposer.recipient.selectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("emailComposer.recipient.free")}</SelectItem>
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
                      placeholder={t("emailComposer.recipient.emailPlaceholder")}
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
                  <Label className="text-sm font-medium">{t("emailComposer.purposeLabel")}</Label>
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
                        <div className="text-sm font-medium">{t(`emailComposer.purpose.${opt.value}.label`)}</div>
                        <div className="text-xs text-muted-foreground">{t(`emailComposer.purpose.${opt.value}.desc`)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("emailComposer.toneLabel")}</Label>
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
                        <span className="text-xs font-medium">{t(`emailComposer.tone.${opt.value}`)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {purpose === "personnalise" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("emailComposer.aiInstructions.label")}</Label>
                    <Textarea
                      placeholder={t("emailComposer.aiInstructions.placeholder")}
                      value={additionalContext}
                      onChange={(e) => setAdditionalContext(e.target.value)}
                      className="h-24 resize-none"
                    />
                  </div>
                )}

                {purpose !== "personnalise" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t("emailComposer.additionalContext.label")}</Label>
                    <Textarea
                      placeholder={t("emailComposer.additionalContext.placeholder")}
                      value={additionalContext}
                      onChange={(e) => setAdditionalContext(e.target.value)}
                      className="h-16 resize-none"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={handleClose}>{t("common.cancel")}</Button>
                  <Button onClick={handleGenerate} disabled={!purpose} className="gap-2">
                    <Brain className="w-4 h-4" />
                    {t("emailComposer.generateBtn")}
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
                <h3 className="text-lg font-semibold mb-2">{t("emailComposer.generating.heading")}</h3>
                <p className="text-sm text-muted-foreground text-center max-w-sm">
                  {t("emailComposer.generating.desc")}
                </p>
                <div className="flex items-center gap-2 mt-6 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t("emailComposer.generating.inProgress")}
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
                        <p className="text-sm font-medium">{t("emailComposer.preview.aiAnalysis")}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{draftEmail.data.resumeIA}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="secondary" className="text-[10px]">{t("emailComposer.preview.toneBadge", { tone: draftEmail.data.tonUtilise })}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{t("emailComposer.preview.recipientBadge", { recipient: draftEmail.data.destinataire })}</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      {t("emailComposer.preview.emailPreview")}
                    </Label>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleCopyToClipboard}>
                        <Copy className="w-3 h-3" />
                        {t("emailComposer.preview.copy")}
                      </Button>
                      <Button
                        variant={isEditing ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setIsEditing(!isEditing)}
                      >
                        <Edit3 className="w-3 h-3" />
                        {isEditing ? t("emailComposer.preview.previewMode") : t("common.edit")}
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden">
                    <div className="bg-muted/50 px-4 py-3 border-b space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-8">{t("emailComposer.preview.to")}</span>
                        {isEditing ? (
                          <Input
                            value={recipientEmail}
                            onChange={(e) => setRecipientEmail(e.target.value)}
                            className="h-7 text-sm flex-1"
                            placeholder={t("emailComposer.recipient.emailPlaceholder")}
                          />
                        ) : (
                          <span className="font-medium">{recipientEmail || selectedContact?.email || t("emailComposer.preview.notProvided")}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-8">{t("emailComposer.preview.subject")}</span>
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
                      {t("emailComposer.preview.alternatives")}
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
                            {selectedAlternative === i && <Badge className="text-[10px] bg-primary">{t("emailComposer.preview.selected")}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t("emailComposer.preview.subjectPrefix", { subject: alt.objet })}</p>
                        </button>
                      ))}
                      {selectedAlternative !== null && (
                        <Button variant="ghost" size="sm" className="text-xs" onClick={handleRevertToOriginal}>
                          {t("emailComposer.preview.revert")}
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
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t("emailComposer.warning.title")}</p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        {t("emailComposer.warning.desc")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep("configure")} className="gap-2">
                    <ChevronLeft className="w-4 h-4" />
                    {t("emailComposer.preview.editSettings")}
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={handleGenerate} className="gap-2">
                      <RefreshCw className="w-4 h-4" />
                      {t("emailComposer.preview.regenerate")}
                    </Button>
                    <Button onClick={handleApproveAndSend} disabled={isSending || !recipientEmail} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                      {isSending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      {isSending ? t("emailComposer.preview.preparing") : t("emailComposer.preview.approveCopy")}
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
                <h3 className="text-xl font-bold mb-2">{t("emailComposer.approved.heading")}</h3>
                <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
                  {t("emailComposer.approved.desc", { email: recipientEmail })}
                </p>
                <div className="border rounded-lg p-4 w-full max-w-md bg-muted/30">
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>{t("emailComposer.approved.recipient")}</span>
                      <span className="font-medium text-foreground">{recipientEmail}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t("emailComposer.approved.subject")}</span>
                      <span className="font-medium text-foreground truncate ml-4">{editedSubject}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t("emailComposer.approved.status")}</span>
                      <Badge className="bg-emerald-500 text-white text-[10px]">{t("emailComposer.approved.ready")}</Badge>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-8">
                  <Button variant="outline" onClick={handleClose}>{t("common.close")}</Button>
                  <Button onClick={() => { resetComposer(); }} className="gap-2">
                    <Mail className="w-4 h-4" />
                    {t("emailComposer.approved.newEmail")}
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
