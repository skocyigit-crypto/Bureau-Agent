import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Phone, PhoneOff, Voicemail, Clock, User, Building, Star, PhoneIncoming, MessageSquare, Calendar, AlertTriangle, Brain, Loader2, X, Volume2, Mic, MicOff, Pause, Play, CheckSquare, Sparkles, CalendarPlus, Smile, Zap, Target, MessageCircle, Shield, Send, Lightbulb, ArrowRight, FileText, Bot, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCall, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type CallPhase = "ringing" | "active" | "ended" | "missed" | "ai_active" | "ai_ended";

interface IncomingCallData {
  phoneNumber: string;
  contactName?: string;
  contactId?: number;
  company?: string;
  category?: string;
  previousCalls?: number;
  lastCallDate?: string;
}

interface AIBriefing {
  relationSummary: string;
  keyPoints: string[];
  suggestedPhrases: string[];
  alerts: string[];
  callerMood: string;
  priority: string;
}

interface AICoaching {
  suggestions: string[];
  detectedIntents: string[];
  proposedResponse: string;
  actionItems: { type: string; description: string }[];
  urgencyLevel: string;
  tips: string;
}

interface IncomingCallOverlayProps {
  isVisible: boolean;
  callData: IncomingCallData;
  onClose: () => void;
}

const RING_DURATION = 60;

const pulseVariants: Variants = {
  pulse: {
    scale: [1, 1.15, 1],
    opacity: [0.7, 0.3, 0.7],
    transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
  }
};

const slideUp = {
  initial: { y: "100%", opacity: 0 } as const,
  animate: { y: 0, opacity: 1, transition: { type: "spring", damping: 25, stiffness: 200 } } as const,
  exit: { y: "100%", opacity: 0, transition: { duration: 0.3, ease: "easeIn" } } as const,
};

const fadeIn = {
  initial: { opacity: 0, scale: 0.9 } as const,
  animate: { opacity: 1, scale: 1, transition: { delay: 0.2, duration: 0.4 } } as const,
  exit: { opacity: 0, scale: 0.9, transition: { duration: 0.2 } } as const,
};

export function IncomingCallOverlay({ isVisible, callData, onClose }: IncomingCallOverlayProps) {
  const [phase, setPhase] = useState<CallPhase>("ringing");
  const [ringTimer, setRingTimer] = useState(RING_DURATION);
  const [callTimer, setCallTimer] = useState(0);
  const [notes, setNotes] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [briefing, setBriefing] = useState<AIBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingContext, setBriefingContext] = useState<any>(null);
  const [coaching, setCoaching] = useState<AICoaching | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(true);
  const coachingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [aiConversation, setAiConversation] = useState<{role: "agent"|"client"; text: string; time: string; intent?: string}[]>([]);
  const [aiTyping, setAiTyping] = useState(false);
  const [aiClientInput, setAiClientInput] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [aiDetectedIntents, setAiDetectedIntents] = useState<string[]>([]);
  const [aiActions, setAiActions] = useState<any[]>([]);
  const [aiSaveResult, setAiSaveResult] = useState<any>(null);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiCallTimer, setAiCallTimer] = useState(0);
  const [aiSentiment, setAiSentiment] = useState("neutre");
  const [aiSatisfactionScore, setAiSatisfactionScore] = useState<number | null>(null);
  const [aiKeyInfo, setAiKeyInfo] = useState<any>(null);
  const [aiNextBestAction, setAiNextBestAction] = useState("");
  const [aiProactiveInsights, setAiProactiveInsights] = useState<string[]>([]);
  const [aiDetectedLanguage, setAiDetectedLanguage] = useState("fr");
  const aiChatEndRef = useRef<HTMLDivElement>(null);
  const createCall = useCreateCall();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    if (!isVisible) {
      setPhase("ringing");
      setRingTimer(RING_DURATION);
      setCallTimer(0);
      setNotes("");
      setIsMuted(false);
      setIsOnHold(false);
      setShowNotes(false);
      setBriefing(null);
      setBriefingContext(null);
      setCoaching(null);
      setAiResult(null);
      setAiProcessing(false);
      setShowAiPanel(true);
      setAiConversation([]);
      setAiTyping(false);
      setAiClientInput("");
      setAiSummary("");
      setAiDetectedIntents([]);
      setAiActions([]);
      setAiSaveResult(null);
      setAiSaving(false);
      setAiCallTimer(0);
      setAiSentiment("neutre");
      setAiSatisfactionScore(null);
      setAiKeyInfo(null);
      setAiNextBestAction("");
      setAiProactiveInsights([]);
      setAiDetectedLanguage("fr");
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || phase !== "ringing") return;
    setBriefingLoading(true);
    fetch(`${baseUrl}/api/calls/ai-briefing`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: callData.phoneNumber,
        contactId: callData.contactId,
        contactName: callData.contactName,
      }),
    })
      .then(r => r.json())
      .then(data => {
        setBriefing(data.briefing);
        setBriefingContext(data.context);
      })
      .catch(() => {})
      .finally(() => setBriefingLoading(false));
  }, [isVisible, callData.phoneNumber]);

  useEffect(() => {
    if (phase !== "ringing") return;
    if (ringTimer <= 0) {
      setPhase("missed");
      return;
    }
    const interval = setInterval(() => setRingTimer(t => t - 1), 1000);
    return () => clearInterval(interval);
  }, [phase, ringTimer]);

  useEffect(() => {
    if (phase !== "active" && phase !== "ai_active") return;
    const interval = setInterval(() => {
      if (phase === "active") setCallTimer(t => t + 1);
      if (phase === "ai_active") setAiCallTimer(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    aiChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiConversation, aiTyping]);

  const requestCoaching = useCallback((currentNotes: string) => {
    if (coachingDebounce.current) clearTimeout(coachingDebounce.current);
    coachingDebounce.current = setTimeout(() => {
      if (!currentNotes || currentNotes.trim().length < 5) return;
      setCoachingLoading(true);
      fetch(`${baseUrl}/api/calls/ai-coaching`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: currentNotes,
          contactName: callData.contactName,
          phoneNumber: callData.phoneNumber,
          callDuration: callTimer,
          contactCategory: callData.category,
        }),
      })
        .then(r => r.json())
        .then(data => setCoaching(data))
        .catch(() => {})
        .finally(() => setCoachingLoading(false));
    }, 2000);
  }, [baseUrl, callData, callTimer]);

  const handleNotesChange = useCallback((value: string) => {
    setNotes(value);
    if (phase === "active") {
      requestCoaching(value);
    }
  }, [phase, requestCoaching]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleAnswer = useCallback(() => {
    setPhase("active");
    setCallTimer(0);
    setShowNotes(true);
  }, []);

  const handleReject = useCallback(() => {
    setPhase("missed");
  }, []);

  const handleHangup = useCallback(() => {
    setPhase("ended");
  }, []);

  const sendAiAgentMessage = useCallback(async (history: typeof aiConversation, phaseStr: string) => {
    setAiTyping(true);
    try {
      const res = await fetch(`${baseUrl}/api/calls/ai-agent-respond`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: callData.phoneNumber,
          contactId: callData.contactId,
          contactName: callData.contactName,
          contactCompany: callData.company,
          contactCategory: callData.category,
          conversationHistory: history,
          callPhase: phaseStr,
        }),
      });
      if (!res.ok) throw new Error("AI respond failed");
      const data = await res.json();
      const now = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setAiConversation(prev => [...prev, { role: "agent", text: data.response, time: now, intent: data.detectedIntent }]);
      if (data.summary) setAiSummary(data.summary);
      if (data.detectedIntent && data.detectedIntent !== "salutation" && data.detectedIntent !== "autre") {
        setAiDetectedIntents(prev => prev.includes(data.detectedIntent) ? prev : [...prev, data.detectedIntent]);
      }
      if (data.suggestedActions?.length > 0) {
        setAiActions(prev => [...prev, ...data.suggestedActions]);
      }
      if (data.sentiment) setAiSentiment(data.sentiment);
      if (data.clientSatisfactionScore != null) setAiSatisfactionScore(data.clientSatisfactionScore);
      if (data.keyInfoExtracted) setAiKeyInfo(data.keyInfoExtracted);
      if (data.nextBestAction) setAiNextBestAction(data.nextBestAction);
      if (data.proactiveInsights?.length > 0) setAiProactiveInsights(data.proactiveInsights);
      if (data.detectedLanguage) setAiDetectedLanguage(data.detectedLanguage);
      if (data.shouldEscalate) {
        const urgencyLabels: Record<string, string> = { immediate: "IMMEDIATE", dans_heure: "dans l'heure", dans_journee: "dans la journee" };
        toast({ title: `Escalade ${data.escalateUrgency ? urgencyLabels[data.escalateUrgency] || "" : ""}`, description: data.escalateReason || "Sophie recommande un transfert a un agent humain.", variant: "destructive" });
      }
    } catch {
      const now = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setAiConversation(prev => [...prev, { role: "agent", text: "Excusez-moi, puis-je prendre votre message ?", time: now }]);
    } finally {
      setAiTyping(false);
    }
  }, [baseUrl, callData, toast]);

  const handleAiAnswer = useCallback(() => {
    setPhase("ai_active");
    setAiCallTimer(0);
    setAiConversation([]);
    sendAiAgentMessage([], "greeting");
  }, [sendAiAgentMessage]);

  const handleAiClientSend = useCallback(() => {
    if (!aiClientInput.trim()) return;
    const now = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const newMsg = { role: "client" as const, text: aiClientInput.trim(), time: now };
    const updatedHistory = [...aiConversation, newMsg];
    setAiConversation(updatedHistory);
    setAiClientInput("");
    sendAiAgentMessage(updatedHistory, "conversation");
  }, [aiClientInput, aiConversation, sendAiAgentMessage]);

  const handleAiHangup = useCallback(() => {
    setPhase("ai_ended");
  }, []);

  const handleAiSave = useCallback(async () => {
    setAiSaving(true);
    try {
      const res = await fetch(`${baseUrl}/api/calls/ai-agent-save`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: callData.phoneNumber,
          contactId: callData.contactId,
          contactName: callData.contactName,
          duration: aiCallTimer,
          transcript: aiConversation,
          summary: aiSummary,
          detectedIntents: aiDetectedIntents,
          suggestedActions: aiActions,
          sentiment: aiSentiment,
          satisfactionScore: aiSatisfactionScore,
          keyInfoExtracted: aiKeyInfo,
          nextBestAction: aiNextBestAction,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      setAiSaveResult(data);
      queryClient.invalidateQueries({ queryKey: ["calls"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      toast({ title: "Appel IA enregistre", description: data.message });
    } catch {
      toast({ title: "Erreur", description: "Impossible d'enregistrer l'appel IA.", variant: "destructive" });
    } finally {
      setAiSaving(false);
    }
  }, [baseUrl, callData, aiCallTimer, aiConversation, aiSummary, aiDetectedIntents, aiActions, aiSentiment, aiSatisfactionScore, aiKeyInfo, aiNextBestAction, queryClient, toast]);

  const saveCall = useCallback((status: "repondu" | "manque" | "messagerie") => {
    createCall.mutate({
      data: {
        phoneNumber: callData.phoneNumber,
        contactId: callData.contactId ?? null,
        direction: "entrant",
        status,
        duration: status === "repondu" ? callTimer : 0,
        notes: notes || (callData.contactName ? `Contact: ${callData.contactName}` : null),
        sentiment: null,
      }
    }, {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["calls"] });
        const toastMsg = status === "repondu" ? "Appel enregistre" : status === "manque" ? "Appel manque enregistre" : "Message vocal enregistre";
        toast({ title: toastMsg });

        if (status === "repondu" && notes && notes.trim().length > 5 && data?.id) {
          setAiProcessing(true);
          fetch(`${baseUrl}/api/calls/${data.id}/process`, { method: "POST", credentials: "include" })
            .then(r => r.json())
            .then(result => {
              setAiResult(result);
              setAiProcessing(false);
              queryClient.invalidateQueries({ queryKey: ["tasks"] });
              queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
              queryClient.invalidateQueries({ queryKey: ["notifications"] });
              if (result.tasksCreated > 0 || result.appointmentCreated) {
                toast({
                  title: "IA : Actions creees",
                  description: `${result.tasksCreated || 0} tache(s) et ${result.appointmentCreated ? "1 rendez-vous" : "0 rendez-vous"} cree(s) automatiquement.`,
                });
              }
            })
            .catch(() => {
              setAiProcessing(false);
            });
        } else if (status !== "repondu") {
          onClose();
        }
      },
      onError: () => {
        toast({ title: "Erreur d'enregistrement", variant: "destructive" });
      }
    });
  }, [callData, callTimer, notes, createCall, queryClient, toast, onClose, baseUrl]);

  const getCategoryColor = (cat?: string) => {
    switch (cat) {
      case "client": return "bg-blue-500";
      case "prospect": return "bg-amber-500";
      case "fournisseur": return "bg-purple-500";
      case "partenaire": return "bg-emerald-500";
      default: return "bg-gray-400";
    }
  };

  const getCategoryLabel = (cat?: string) => {
    switch (cat) {
      case "client": return "Client";
      case "prospect": return "Prospect";
      case "fournisseur": return "Fournisseur";
      case "partenaire": return "Partenaire";
      default: return "Autre";
    }
  };

  const intentIcons: Record<string, any> = {
    rdv: Calendar,
    devis: FileText,
    facture: FileText,
    rappel: Phone,
    reclamation: AlertTriangle,
    information: MessageCircle,
    urgence: Zap,
  };

  const intentLabels: Record<string, string> = {
    rdv: "Rendez-vous",
    devis: "Devis",
    facture: "Facture",
    rappel: "Rappel",
    reclamation: "Reclamation",
    information: "Information",
    urgence: "Urgence",
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            className="relative w-full max-w-lg mx-4 mb-4 sm:mb-0 rounded-3xl overflow-hidden shadow-2xl max-h-[92vh] overflow-y-auto"
            {...slideUp}
          >
            {phase === "ringing" && (
              <div className="bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white">
                <div className="relative px-8 pt-10 pb-4 text-center">
                  <div className="absolute inset-0 overflow-hidden">
                    <motion.div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-white/10" variants={pulseVariants} animate="pulse" />
                    <motion.div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-white/5" variants={pulseVariants} animate="pulse" style={{ animationDelay: "0.5s" }} />
                  </div>

                  <motion.div className="relative" {...fadeIn}>
                    <div className="flex justify-center mb-1">
                      <Badge className="bg-white/20 text-white/90 border-white/30 text-[10px] px-2">
                        <PhoneIncoming className="w-3 h-3 mr-1" />
                        Appel entrant
                      </Badge>
                    </div>

                    <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm mx-auto mb-3 flex items-center justify-center border-2 border-white/30">
                      {callData.contactName ? (
                        <span className="text-2xl font-bold">{callData.contactName.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                      ) : (
                        <User className="w-8 h-8" />
                      )}
                    </div>

                    <h2 className="text-2xl font-bold mb-1">{callData.contactName || "Numero inconnu"}</h2>
                    <p className="text-white/80 text-lg mb-2 tabular-nums">{callData.phoneNumber}</p>

                    <div className="flex items-center justify-center gap-2 mb-3 flex-wrap">
                      {callData.company && (
                        <Badge className="bg-white/15 text-white border-white/20 text-xs">
                          <Building className="w-3 h-3 mr-1" />
                          {callData.company}
                        </Badge>
                      )}
                      {callData.category && (
                        <Badge className={`${getCategoryColor(callData.category)} text-white border-0 text-xs`}>
                          {getCategoryLabel(callData.category)}
                        </Badge>
                      )}
                      {callData.previousCalls !== undefined && callData.previousCalls > 0 && (
                        <Badge className="bg-white/15 text-white border-white/20 text-xs">
                          {callData.previousCalls} appel(s)
                        </Badge>
                      )}
                    </div>

                    <div className="text-white/50 text-sm tabular-nums">
                      Sonnerie... {ringTimer}s
                    </div>
                  </motion.div>
                </div>

                {(briefing || briefingLoading) && (
                  <motion.div
                    className="mx-6 mb-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 p-4"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-4 h-4 text-amber-300" />
                      <span className="text-sm font-semibold text-amber-200">Brifing IA</span>
                      {briefing?.priority === "haute" && (
                        <Badge className="bg-red-500/30 text-red-200 border-red-400/30 text-[10px] ml-auto">Priorite haute</Badge>
                      )}
                    </div>

                    {briefingLoading ? (
                      <div className="flex items-center gap-2 text-white/60 text-xs">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Preparation du brifing...
                      </div>
                    ) : briefing ? (
                      <div className="space-y-2">
                        <p className="text-xs text-white/80 leading-relaxed">{briefing.relationSummary}</p>

                        {briefing.alerts.length > 0 && (
                          <div className="space-y-1">
                            {briefing.alerts.map((alert, i) => (
                              <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-200">
                                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                <span>{alert}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {briefing.keyPoints.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-white/50 uppercase tracking-wider">Points cles</p>
                            {briefing.keyPoints.slice(0, 3).map((point, i) => (
                              <div key={i} className="flex items-start gap-1.5 text-[11px] text-white/70">
                                <Target className="w-3 h-3 mt-0.5 shrink-0 text-emerald-300" />
                                <span>{point}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {briefing.suggestedPhrases.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-white/10">
                            <p className="text-[10px] font-medium text-white/50 uppercase tracking-wider">Phrases suggerees</p>
                            {briefing.suggestedPhrases.slice(0, 2).map((phrase, i) => (
                              <div key={i} className="flex items-start gap-1.5 text-[11px] text-white/80 bg-white/5 rounded-lg px-2 py-1.5">
                                <MessageCircle className="w-3 h-3 mt-0.5 shrink-0 text-blue-300" />
                                <span className="italic">"{phrase}"</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {briefingContext && (
                          <div className="flex gap-3 pt-1 text-[10px] text-white/50">
                            {briefingContext.openTasks > 0 && <span>{briefingContext.openTasks} tache(s) ouvertes</span>}
                            {briefingContext.upcomingEvents > 0 && <span>{briefingContext.upcomingEvents} RDV a venir</span>}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </motion.div>
                )}

                <div className="px-8 pb-4">
                  <div className="flex items-center justify-center gap-6">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/30 transition-colors"
                      onClick={handleReject}
                    >
                      <PhoneOff className="w-7 h-7 text-white" />
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="w-20 h-20 rounded-full bg-white hover:bg-gray-100 flex items-center justify-center shadow-xl shadow-white/30 transition-colors"
                      onClick={handleAnswer}
                    >
                      <Phone className="w-9 h-9 text-emerald-600" />
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="w-16 h-16 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center backdrop-blur-sm transition-colors"
                      onClick={() => { setPhase("missed"); saveCall("messagerie"); }}
                    >
                      <Voicemail className="w-7 h-7 text-white" />
                    </motion.button>
                  </div>
                  <div className="flex justify-center gap-12 mt-3 text-xs text-white/60">
                    <span>Refuser</span>
                    <span className="ml-2">Repondre</span>
                    <span>Messagerie</span>
                  </div>
                </div>

                <motion.div
                  className="px-8 pb-8"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                >
                  <button
                    onClick={handleAiAnswer}
                    className="w-full py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-violet-500/30 transition-all"
                  >
                    <Bot className="w-5 h-5" />
                    Sophie IA repond
                    <Badge className="bg-white/20 text-white border-0 text-[10px] ml-1">Auto</Badge>
                  </button>
                </motion.div>
              </div>
            )}

            {phase === "active" && (
              <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
                <div className="px-6 pt-6 pb-3 text-center">
                  <div className="flex justify-between items-center mb-2">
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5 inline-block" />
                      En cours
                    </Badge>
                    <button
                      onClick={() => setShowAiPanel(!showAiPanel)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] transition-colors ${showAiPanel ? "bg-violet-500/20 text-violet-400 border border-violet-500/30" : "bg-white/5 text-white/40 border border-white/10"}`}
                    >
                      <Brain className="w-3 h-3" />
                      IA Coach
                    </button>
                  </div>

                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center border border-white/20">
                      {callData.contactName ? (
                        <span className="text-lg font-bold">{callData.contactName.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                      ) : (
                        <User className="w-5 h-5" />
                      )}
                    </div>
                    <div className="text-left flex-1">
                      <h2 className="text-lg font-bold leading-tight">{callData.contactName || "Numero inconnu"}</h2>
                      <p className="text-white/50 text-xs">{callData.phoneNumber}</p>
                    </div>
                    <div className="text-2xl font-mono font-light text-emerald-400 tabular-nums">
                      {formatTimer(callTimer)}
                    </div>
                  </div>

                  {isOnHold && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-2">
                      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">En attente</Badge>
                    </motion.div>
                  )}
                </div>

                <div className="px-6 pb-3">
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <button
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${isMuted ? "bg-red-500/20 text-red-400" : "bg-white/5 hover:bg-white/10 text-white/70"}`}
                      onClick={() => setIsMuted(!isMuted)}
                    >
                      {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      <span className="text-[10px]">{isMuted ? "Active" : "Muet"}</span>
                    </button>
                    <button
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${isOnHold ? "bg-amber-500/20 text-amber-400" : "bg-white/5 hover:bg-white/10 text-white/70"}`}
                      onClick={() => setIsOnHold(!isOnHold)}
                    >
                      {isOnHold ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      <span className="text-[10px]">{isOnHold ? "Reprendre" : "Attente"}</span>
                    </button>
                    <button
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${showNotes ? "bg-blue-500/20 text-blue-400" : "bg-white/5 hover:bg-white/10 text-white/70"}`}
                      onClick={() => setShowNotes(!showNotes)}
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span className="text-[10px]">Notes</span>
                    </button>
                    <button
                      className="flex flex-col items-center gap-1 p-2 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 text-violet-400 transition-colors"
                      onClick={() => requestCoaching(notes)}
                      disabled={coachingLoading || notes.length < 5}
                    >
                      {coachingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      <span className="text-[10px]">Analyser</span>
                    </button>
                  </div>

                  <AnimatePresence>
                    {showNotes && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden mb-3"
                      >
                        <Textarea
                          placeholder="Tapez vos notes ici... L'IA analysera en temps reel et vous proposera des suggestions."
                          className="bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none h-20 text-sm"
                          value={notes}
                          onChange={(e) => handleNotesChange(e.target.value)}
                        />
                        <p className="text-[10px] text-white/30 mt-1 flex items-center gap-1">
                          <Brain className="w-2.5 h-2.5" />
                          L'IA analyse vos notes automatiquement apres 2 secondes de pause
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {showAiPanel && coaching && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden mb-3"
                      >
                        <div className="bg-gradient-to-br from-violet-900/40 to-blue-900/40 rounded-xl p-3 border border-violet-500/20 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Brain className="w-3.5 h-3.5 text-violet-400" />
                              <span className="text-xs font-semibold text-violet-300">Coach IA</span>
                            </div>
                            {coaching.urgencyLevel && (
                              <Badge className={`text-[9px] border-0 ${
                                coaching.urgencyLevel === "haute" ? "bg-red-500/20 text-red-300" :
                                coaching.urgencyLevel === "basse" ? "bg-green-500/20 text-green-300" :
                                "bg-blue-500/20 text-blue-300"
                              }`}>
                                {coaching.urgencyLevel}
                              </Badge>
                            )}
                          </div>

                          {coaching.detectedIntents.length > 0 && (
                            <div className="flex gap-1.5 flex-wrap">
                              {coaching.detectedIntents.map((intent, i) => {
                                const Icon = intentIcons[intent] || Zap;
                                return (
                                  <Badge key={i} className="bg-white/10 text-white/80 border-white/20 text-[9px] gap-1">
                                    <Icon className="w-2.5 h-2.5" />
                                    {intentLabels[intent] || intent}
                                  </Badge>
                                );
                              })}
                            </div>
                          )}

                          {coaching.proposedResponse && (
                            <div className="bg-white/5 rounded-lg p-2 border border-white/10">
                              <p className="text-[10px] text-white/40 mb-1 flex items-center gap-1">
                                <Send className="w-2.5 h-2.5" />
                                Reponse suggeree
                              </p>
                              <p className="text-xs text-white/90 italic leading-relaxed">"{coaching.proposedResponse}"</p>
                            </div>
                          )}

                          {coaching.suggestions.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-[10px] text-white/40 flex items-center gap-1">
                                <Lightbulb className="w-2.5 h-2.5" />
                                Prochaines actions
                              </p>
                              {coaching.suggestions.map((s, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-[11px] text-white/70">
                                  <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-violet-400" />
                                  <span>{s}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {coaching.actionItems.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-white/10">
                              <p className="text-[10px] text-white/40 flex items-center gap-1">
                                <CheckSquare className="w-2.5 h-2.5" />
                                Actions detectees (seront creees automatiquement)
                              </p>
                              {coaching.actionItems.map((item, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-[11px] text-amber-300/80">
                                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  <span className="capitalize">{item.type}:</span>
                                  <span className="text-white/60">{item.description}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {coaching.tips && (
                            <div className="text-[10px] text-violet-300/60 italic flex items-start gap-1 pt-1 border-t border-white/10">
                              <Shield className="w-3 h-3 mt-0.5 shrink-0" />
                              <span>{coaching.tips}</span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="px-6 pb-6">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/30 mx-auto transition-colors"
                    onClick={handleHangup}
                  >
                    <PhoneOff className="w-7 h-7 text-white" />
                  </motion.button>
                  <p className="text-center text-white/40 text-xs mt-2">Raccrocher</p>
                </div>
              </div>
            )}

            {phase === "ai_active" && (
              <div className="bg-gradient-to-br from-violet-950 via-slate-900 to-slate-900 text-white flex flex-col max-h-[85vh]">
                <div className="px-6 pt-5 pb-3 text-center border-b border-violet-500/20">
                  <div className="flex justify-between items-center mb-2">
                    <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-xs animate-pulse">
                      <Bot className="w-3 h-3 mr-1" />
                      Sophie IA
                    </Badge>
                    <span className="text-xs text-white/50 font-mono">{formatTimer(aiCallTimer)}</span>
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 inline-block animate-pulse" />
                      Active
                    </Badge>
                  </div>
                  <p className="text-sm text-white/70 flex items-center justify-center gap-2">
                    <Headphones className="w-4 h-4" />
                    {callData.contactName || callData.phoneNumber}
                    {callData.company && <span className="text-white/40">• {callData.company}</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                    <Badge className={`text-[10px] border ${aiSentiment === "tres_positif" || aiSentiment === "positif" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : aiSentiment === "negatif" || aiSentiment === "tres_negatif" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-white/10 text-white/60 border-white/20"}`}>
                      <Smile className="w-3 h-3 mr-0.5" />
                      {aiSentiment.replace("_", " ")}
                    </Badge>
                    {aiSatisfactionScore != null && (
                      <Badge className={`text-[10px] border ${aiSatisfactionScore >= 7 ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : aiSatisfactionScore >= 4 ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>
                        <Star className="w-3 h-3 mr-0.5" />
                        {aiSatisfactionScore}/10
                      </Badge>
                    )}
                    <Badge className="bg-blue-500/10 text-blue-300 border-blue-500/20 text-[10px]">
                      {aiDetectedLanguage === "fr" ? "Francais" : aiDetectedLanguage === "en" ? "English" : aiDetectedLanguage === "tr" ? "Turkce" : aiDetectedLanguage === "de" ? "Deutsch" : aiDetectedLanguage === "es" ? "Espanol" : aiDetectedLanguage === "ar" ? "Arabic" : aiDetectedLanguage}
                    </Badge>
                    {aiDetectedIntents.map((i, idx) => (
                      <Badge key={idx} className="bg-violet-500/10 text-violet-300 border-violet-500/20 text-[10px]">
                        {i === "rdv" ? "Rendez-vous" : i === "devis" ? "Devis" : i === "reclamation" ? "Reclamation" : i === "urgence" ? "Urgence" : i === "rappel" ? "Rappel" : i === "information" ? "Information" : i === "achat" ? "Achat" : i === "annulation" ? "Annulation" : i === "suivi_commande" ? "Suivi" : i === "demande_technique" ? "Technique" : i === "plainte" ? "Plainte" : i === "partenariat" ? "Partenariat" : i}
                      </Badge>
                    ))}
                  </div>
                  {aiProactiveInsights.length > 0 && (
                    <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <div className="flex items-center gap-1 text-[10px] text-amber-300 mb-1">
                        <Lightbulb className="w-3 h-3" />
                        Insights Sophie
                      </div>
                      {aiProactiveInsights.map((insight, idx) => (
                        <p key={idx} className="text-[10px] text-amber-200/80">{insight}</p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px] max-h-[45vh]">
                  {aiConversation.map((msg, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === "agent" ? "justify-start" : "justify-end"}`}
                    >
                      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        msg.role === "agent"
                          ? "bg-violet-500/20 text-violet-100 rounded-bl-md"
                          : "bg-white/10 text-white rounded-br-md"
                      }`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          {msg.role === "agent" ? <Bot className="w-3 h-3 text-violet-400" /> : <User className="w-3 h-3 text-white/50" />}
                          <span className="text-[10px] text-white/40">{msg.time}</span>
                          {msg.intent && msg.intent !== "autre" && msg.intent !== "salutation" && (
                            <Badge className="bg-violet-400/10 text-violet-300 border-0 text-[9px] py-0">{msg.intent}</Badge>
                          )}
                        </div>
                        <p>{msg.text}</p>
                      </div>
                    </motion.div>
                  ))}
                  {aiTyping && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                      <div className="bg-violet-500/20 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Bot className="w-3 h-3 text-violet-400 mr-1" />
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                        </div>
                      </div>
                    </motion.div>
                  )}
                  <div ref={aiChatEndRef} />
                </div>

                <div className="px-4 py-3 border-t border-violet-500/20">
                  <p className="text-[10px] text-white/30 mb-2 text-center">Simulez la reponse du client pour tester l'agent IA</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiClientInput}
                      onChange={e => setAiClientInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleAiClientSend()}
                      placeholder="Ecrivez comme le client..."
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
                      disabled={aiTyping}
                    />
                    <button
                      onClick={handleAiClientSend}
                      disabled={aiTyping || !aiClientInput.trim()}
                      className="w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 flex items-center justify-center transition-colors"
                    >
                      <Send className="w-4 h-4 text-white" />
                    </button>
                  </div>
                </div>

                <div className="px-6 pb-5 pt-2 flex items-center justify-center gap-4">
                  <button
                    onClick={() => { setPhase("active"); setCallTimer(aiCallTimer); }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Reprendre
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleAiHangup}
                    className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/30 transition-colors"
                  >
                    <PhoneOff className="w-6 h-6 text-white" />
                  </motion.button>
                  <div className="w-[72px]" />
                </div>
              </div>
            )}

            {phase === "ai_ended" && (
              <motion.div
                className="bg-card text-foreground max-h-[85vh] overflow-y-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="px-8 pt-8 pb-4 text-center">
                  <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center bg-violet-100 dark:bg-violet-900/30">
                    <Bot className="w-7 h-7 text-violet-600 dark:text-violet-400" />
                  </div>
                  <h3 className="text-lg font-bold">Appel gere par Sophie IA</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Duree: {formatTimer(aiCallTimer)} • {aiConversation.length} messages
                  </p>
                </div>

                <div className="mx-6 mb-3 flex flex-wrap gap-2">
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${aiSentiment === "tres_positif" || aiSentiment === "positif" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" : aiSentiment === "negatif" || aiSentiment === "tres_negatif" ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300" : "bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
                    <Smile className="w-3.5 h-3.5" />
                    {aiSentiment.replace("_", " ")}
                  </div>
                  {aiSatisfactionScore != null && (
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${aiSatisfactionScore >= 7 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" : aiSatisfactionScore >= 4 ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"}`}>
                      <Star className="w-3.5 h-3.5" />
                      Satisfaction: {aiSatisfactionScore}/10
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                    {aiDetectedLanguage === "fr" ? "Francais" : aiDetectedLanguage === "en" ? "English" : aiDetectedLanguage === "tr" ? "Turkce" : aiDetectedLanguage === "de" ? "Deutsch" : aiDetectedLanguage === "es" ? "Espanol" : aiDetectedLanguage === "ar" ? "Arabic" : aiDetectedLanguage}
                  </div>
                </div>

                {aiSummary && (
                  <div className="mx-6 mb-3 p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
                    <p className="text-xs font-medium text-violet-700 dark:text-violet-300 mb-1 flex items-center gap-1">
                      <Brain className="w-3 h-3" /> Resume Sophie
                    </p>
                    <p className="text-sm text-violet-900 dark:text-violet-100">{aiSummary}</p>
                  </div>
                )}

                {aiNextBestAction && (
                  <div className="mx-6 mb-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1">
                      <ArrowRight className="w-3 h-3" /> Prochaine action recommandee
                    </p>
                    <p className="text-sm text-blue-900 dark:text-blue-100">{aiNextBestAction}</p>
                  </div>
                )}

                {aiKeyInfo && (aiKeyInfo.budget || aiKeyInfo.deadline || aiKeyInfo.specificNeeds?.length > 0) && (
                  <div className="mx-6 mb-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" /> Informations extraites
                    </p>
                    <div className="text-xs space-y-0.5 text-amber-900 dark:text-amber-100">
                      {aiKeyInfo.budget && <p>Budget: {aiKeyInfo.budget}</p>}
                      {aiKeyInfo.deadline && <p>Echeance: {aiKeyInfo.deadline}</p>}
                      {aiKeyInfo.specificNeeds?.length > 0 && <p>Besoins: {aiKeyInfo.specificNeeds.join(", ")}</p>}
                    </div>
                  </div>
                )}

                {aiDetectedIntents.length > 0 && (
                  <div className="mx-6 mb-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Intentions detectees</p>
                    <div className="flex flex-wrap gap-1">
                      {aiDetectedIntents.map((i, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {i === "rdv" ? "Rendez-vous" : i === "devis" ? "Devis" : i === "reclamation" ? "Reclamation" : i === "urgence" ? "Urgence" : i === "rappel" ? "Rappel" : i === "information" ? "Information" : i === "achat" ? "Achat" : i === "annulation" ? "Annulation" : i === "suivi_commande" ? "Suivi" : i === "demande_technique" ? "Technique" : i === "plainte" ? "Plainte" : i === "partenariat" ? "Partenariat" : i}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {aiActions.length > 0 && (
                  <div className="mx-6 mb-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Actions suggerees</p>
                    <div className="space-y-1.5">
                      {aiActions.map((a, idx) => (
                        <div key={idx} className={`flex items-start gap-2 p-2 rounded-lg text-sm ${a.type === "escalation" ? "bg-red-50 dark:bg-red-900/10" : "bg-muted/50"}`}>
                          {a.type === "task" || a.type === "callback" ? <CheckSquare className="w-3.5 h-3.5 text-blue-500 mt-0.5" /> :
                           a.type === "appointment" ? <CalendarPlus className="w-3.5 h-3.5 text-emerald-500 mt-0.5" /> :
                           a.type === "escalation" ? <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5" /> :
                           a.type === "devis" ? <FileText className="w-3.5 h-3.5 text-violet-500 mt-0.5" /> :
                           a.type === "email" ? <Send className="w-3.5 h-3.5 text-cyan-500 mt-0.5" /> :
                           <MessageSquare className="w-3.5 h-3.5 text-orange-500 mt-0.5" />}
                          <div>
                            <p className="font-medium text-xs">{a.description}</p>
                            <p className="text-[10px] text-muted-foreground">{a.type === "escalation" ? "Escalade" : a.type === "devis" ? "Devis" : a.type === "email" ? "Email" : a.type} • {a.priority}{a.dueInHours ? ` • ${a.dueInHours}h` : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mx-6 mb-3">
                  <details className="group">
                    <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" />
                      Transcription ({aiConversation.length} messages)
                    </summary>
                    <div className="mt-2 space-y-2 max-h-[200px] overflow-y-auto">
                      {aiConversation.map((msg, idx) => (
                        <div key={idx} className={`text-xs p-2 rounded-lg ${msg.role === "agent" ? "bg-violet-50 dark:bg-violet-900/10" : "bg-muted/50"}`}>
                          <span className="font-medium">{msg.role === "agent" ? "Sophie IA" : "Client"}</span>
                          <span className="text-muted-foreground ml-1">{msg.time}</span>
                          <p className="mt-0.5">{msg.text}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>

                <div className="px-6 pb-6 space-y-2">
                  {!aiSaveResult ? (
                    <Button
                      onClick={handleAiSave}
                      disabled={aiSaving}
                      className="w-full bg-violet-600 hover:bg-violet-700"
                    >
                      {aiSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckSquare className="w-4 h-4 mr-2" />}
                      Enregistrer l'appel et creer les taches
                    </Button>
                  ) : (
                    <div className="text-center p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{aiSaveResult.message}</p>
                    </div>
                  )}
                  <Button variant="outline" onClick={() => onClose?.()} className="w-full">
                    <X className="w-4 h-4 mr-2" />
                    Fermer
                  </Button>
                </div>
              </motion.div>
            )}

            {(phase === "ended" || phase === "missed") && (
              <motion.div
                className="bg-card text-foreground max-h-[85vh] overflow-y-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="px-8 pt-8 pb-4 text-center">
                  <div className={`w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center ${phase === "ended" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                    {phase === "ended" ? (
                      <Phone className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <PhoneOff className="w-6 h-6 text-red-600 dark:text-red-400" />
                    )}
                  </div>

                  <h3 className="text-lg font-semibold mb-1">
                    {phase === "ended" ? "Appel termine" : "Appel manque"}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {callData.contactName || callData.phoneNumber}
                    {phase === "ended" && ` - ${formatTimer(callTimer)}`}
                  </p>
                </div>

                {phase === "ended" && !aiResult && (
                  <div className="px-8 pb-4">
                    <Textarea
                      placeholder="Notes de l'appel (l'IA analysera automatiquement)..."
                      className="resize-none h-20"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      L'IA detectera les rendez-vous, creera les taches et coordonnera les agents automatiquement
                    </p>
                  </div>
                )}

                {aiProcessing && (
                  <motion.div
                    className="px-8 pb-4"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/30 rounded-xl p-4 border border-violet-200 dark:border-violet-800">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center">
                          <Brain className="w-4 h-4 text-violet-600 dark:text-violet-400 animate-pulse" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Analyse IA & coordination agents...</p>
                          <p className="text-xs text-muted-foreground">Detection RDV, creation taches, dispatch agents</p>
                        </div>
                      </div>
                      <div className="space-y-1.5 mt-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin text-violet-500" />
                          <span className="text-xs text-violet-600 dark:text-violet-400">Traitement Gemini...</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                          <span className="text-xs text-blue-600 dark:text-blue-400">Coordination avec les agents IA...</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {aiResult && (
                  <motion.div
                    className="px-8 pb-4 space-y-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-sm font-medium">Analyse IA</span>
                        {aiResult.analysis?.sentiment && (
                          <Badge className={`ml-auto text-[10px] ${
                            aiResult.analysis.sentiment === "tres_positif" ? "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-300 border-emerald-300" :
                            aiResult.analysis.sentiment === "positif" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 border-emerald-200" :
                            aiResult.analysis.sentiment === "tres_negatif" ? "bg-red-200 text-red-800 dark:bg-red-900/70 dark:text-red-300 border-red-300" :
                            aiResult.analysis.sentiment === "negatif" ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400 border-red-200" :
                            "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border-gray-200"
                          }`}>
                            {aiResult.analysis.sentiment}
                          </Badge>
                        )}
                      </div>
                      {aiResult.analysis?.summary && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{aiResult.analysis.summary}</p>
                      )}
                    </div>

                    {aiResult.appointmentCreated && aiResult.appointment && (
                      <motion.div
                        className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4 border border-blue-200 dark:border-blue-800"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <CalendarPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <span className="text-sm font-medium">Rendez-vous cree</span>
                        </div>
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-200">{aiResult.appointment.title}</p>
                        {aiResult.appointment.startDate && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                            {new Date(aiResult.appointment.startDate).toLocaleDateString("fr-FR", {
                              weekday: "long", day: "numeric", month: "long", year: "numeric",
                              hour: "2-digit", minute: "2-digit"
                            })}
                          </p>
                        )}
                        {aiResult.appointment.location && (
                          <p className="text-xs text-muted-foreground mt-0.5">{aiResult.appointment.location}</p>
                        )}
                      </motion.div>
                    )}

                    {aiResult.tasksCreated > 0 && aiResult.tasks && (
                      <motion.div
                        className="bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4 border border-amber-200 dark:border-amber-800"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <CheckSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          <span className="text-sm font-medium">{aiResult.tasksCreated} tache(s) creee(s)</span>
                        </div>
                        <div className="space-y-1.5">
                          {aiResult.tasks.map((task: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full ${
                                task.priority === "haute" ? "bg-red-500" :
                                task.priority === "moyenne" ? "bg-amber-500" : "bg-green-500"
                              }`} />
                              <span className="text-xs">{task.title}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}

                    {aiResult.analysis?.joke && (
                      <motion.div
                        className="bg-pink-50 dark:bg-pink-950/30 rounded-xl p-4 border border-pink-200 dark:border-pink-800"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Smile className="w-4 h-4 text-pink-600 dark:text-pink-400" />
                          <span className="text-sm font-medium">Petite blague du jour</span>
                        </div>
                        <p className="text-xs text-pink-800 dark:text-pink-300 leading-relaxed italic">
                          "{aiResult.analysis.joke}"
                        </p>
                      </motion.div>
                    )}
                  </motion.div>
                )}

                <div className="px-8 pb-8 flex gap-3">
                  {!aiResult && !aiProcessing && (
                    <>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={onClose}
                      >
                        Fermer
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={() => saveCall(phase === "ended" ? "repondu" : "manque")}
                        disabled={createCall.isPending}
                      >
                        {createCall.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : null}
                        Enregistrer
                      </Button>
                    </>
                  )}
                  {aiProcessing && (
                    <Button variant="outline" className="flex-1" disabled>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analyse en cours...
                    </Button>
                  )}
                  {aiResult && (
                    <Button className="flex-1" onClick={onClose}>
                      Terminer
                    </Button>
                  )}
                </div>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function useIncomingCall() {
  const [isVisible, setIsVisible] = useState(false);
  const [callData, setCallData] = useState<IncomingCallData>({ phoneNumber: "" });
  const { data: contactsData } = useListContacts({ limit: 200 }, { query: { queryKey: ["contacts", "all-lookup"] } });

  const simulateIncomingCall = useCallback((phoneNumber?: string) => {
    const sampleNumbers = [
      "+33 1 42 56 78 90", "+33 1 43 22 11 33", "+33 1 55 44 33 22",
      "+33 1 42 33 44 55", "+33 1 40 11 22 33", "+33 6 12 34 56 78",
    ];

    const number = phoneNumber || sampleNumbers[Math.floor(Math.random() * sampleNumbers.length)];
    const cleanNumber = number.replace(/\s/g, "");

    const matchedContact = contactsData?.contacts?.find(c => {
      const contactPhone = c.phone?.replace(/\s/g, "");
      return contactPhone === cleanNumber;
    });

    setCallData({
      phoneNumber: number,
      contactName: matchedContact ? `${matchedContact.firstName} ${matchedContact.lastName}` : undefined,
      contactId: matchedContact?.id,
      company: matchedContact?.company || undefined,
      category: matchedContact?.category,
      previousCalls: matchedContact?.totalCalls ? Number(matchedContact.totalCalls) : undefined,
    });

    setIsVisible(true);
  }, [contactsData]);

  const closeCall = useCallback(() => {
    setIsVisible(false);
  }, []);

  return {
    isVisible,
    callData,
    simulateIncomingCall,
    closeCall,
  };
}
