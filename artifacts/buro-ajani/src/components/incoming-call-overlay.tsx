import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Voicemail, Clock, User, Building, Star, PhoneIncoming, MessageSquare, Calendar, AlertTriangle, Brain, Loader2, X, Volume2, Mic, MicOff, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCall, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type CallPhase = "ringing" | "active" | "ended" | "missed";

interface IncomingCallData {
  phoneNumber: string;
  contactName?: string;
  contactId?: number;
  company?: string;
  category?: string;
  previousCalls?: number;
  lastCallDate?: string;
}

interface IncomingCallOverlayProps {
  isVisible: boolean;
  callData: IncomingCallData;
  onClose: () => void;
}

const RING_DURATION = 30;

const pulseVariants = {
  pulse: {
    scale: [1, 1.15, 1],
    opacity: [0.7, 0.3, 0.7],
    transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
  }
};

const slideUp = {
  initial: { y: "100%", opacity: 0 },
  animate: { y: 0, opacity: 1, transition: { type: "spring", damping: 25, stiffness: 200 } },
  exit: { y: "100%", opacity: 0, transition: { duration: 0.3, ease: "easeIn" } }
};

const fadeIn = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1, transition: { delay: 0.2, duration: 0.4 } },
  exit: { opacity: 0, scale: 0.9, transition: { duration: 0.2 } }
};

export function IncomingCallOverlay({ isVisible, callData, onClose }: IncomingCallOverlayProps) {
  const [phase, setPhase] = useState<CallPhase>("ringing");
  const [ringTimer, setRingTimer] = useState(RING_DURATION);
  const [callTimer, setCallTimer] = useState(0);
  const [notes, setNotes] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const createCall = useCreateCall();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!isVisible) {
      setPhase("ringing");
      setRingTimer(RING_DURATION);
      setCallTimer(0);
      setNotes("");
      setIsMuted(false);
      setIsOnHold(false);
      setShowNotes(false);
    }
  }, [isVisible]);

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
    if (phase !== "active") return;
    const interval = setInterval(() => setCallTimer(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleAnswer = useCallback(() => {
    setPhase("active");
    setCallTimer(0);
  }, []);

  const handleReject = useCallback(() => {
    setPhase("missed");
  }, []);

  const handleHangup = useCallback(() => {
    setPhase("ended");
  }, []);

  const saveCall = useCallback((status: "repondu" | "manque" | "messagerie") => {
    createCall.mutate({
      data: {
        phoneNumber: callData.phoneNumber,
        contactId: callData.contactId ?? null,
        contactName: callData.contactName || null,
        direction: "entrant",
        status,
        duration: status === "repondu" ? callTimer : 0,
        notes: notes || null,
        sentiment: null,
        tags: null,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["calls"] });
        toast({ title: status === "repondu" ? "Appel enregistre" : status === "manque" ? "Appel manque enregistre" : "Message vocal enregistre" });
        onClose();
      },
      onError: () => {
        toast({ title: "Erreur d'enregistrement", variant: "destructive" });
      }
    });
  }, [callData, callTimer, notes, createCall, queryClient, toast, onClose]);

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
            className="relative w-full max-w-md mx-4 mb-4 sm:mb-0 rounded-3xl overflow-hidden shadow-2xl"
            {...slideUp}
          >
            {phase === "ringing" && (
              <div className="bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white">
                <div className="relative px-8 pt-10 pb-6 text-center">
                  <div className="absolute inset-0 overflow-hidden">
                    <motion.div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-white/10" variants={pulseVariants} animate="pulse" />
                    <motion.div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-white/5" variants={pulseVariants} animate="pulse" style={{ animationDelay: "0.5s" }} />
                    <motion.div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-white/[0.03]" variants={pulseVariants} animate="pulse" style={{ animationDelay: "1s" }} />
                  </div>

                  <motion.div className="relative" {...fadeIn}>
                    <div className="flex justify-center mb-1">
                      <Badge className="bg-white/20 text-white/90 border-white/30 text-[10px] px-2">
                        <PhoneIncoming className="w-3 h-3 mr-1" />
                        Appel entrant
                      </Badge>
                    </div>

                    <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm mx-auto mb-4 flex items-center justify-center border-2 border-white/30">
                      {callData.contactName ? (
                        <span className="text-2xl font-bold">{callData.contactName.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                      ) : (
                        <User className="w-8 h-8" />
                      )}
                    </div>

                    <h2 className="text-2xl font-bold mb-1">{callData.contactName || "Numero inconnu"}</h2>
                    <p className="text-white/80 text-lg mb-3 tabular-nums">{callData.phoneNumber}</p>

                    {callData.company && (
                      <div className="flex items-center justify-center gap-2 mb-2">
                        <Building className="w-4 h-4 text-white/70" />
                        <span className="text-white/80 text-sm">{callData.company}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-center gap-2 mb-4">
                      {callData.category && (
                        <Badge className={`${getCategoryColor(callData.category)} text-white border-0 text-xs`}>
                          {getCategoryLabel(callData.category)}
                        </Badge>
                      )}
                      {callData.previousCalls !== undefined && callData.previousCalls > 0 && (
                        <Badge className="bg-white/20 text-white border-0 text-xs">
                          {callData.previousCalls} appel(s) precedent(s)
                        </Badge>
                      )}
                    </div>

                    <div className="text-white/50 text-sm tabular-nums">
                      Sonnerie... {ringTimer}s
                    </div>
                  </motion.div>
                </div>

                <div className="px-8 pb-8">
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
              </div>
            )}

            {phase === "active" && (
              <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
                <div className="px-8 pt-8 pb-4 text-center">
                  <div className="flex justify-center mb-2">
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5 inline-block" />
                      En cours
                    </Badge>
                  </div>

                  <div className="w-16 h-16 rounded-full bg-white/10 mx-auto mb-3 flex items-center justify-center border border-white/20">
                    {callData.contactName ? (
                      <span className="text-xl font-bold">{callData.contactName.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                    ) : (
                      <User className="w-7 h-7" />
                    )}
                  </div>

                  <h2 className="text-xl font-bold">{callData.contactName || "Numero inconnu"}</h2>
                  <p className="text-white/60 text-sm mb-2">{callData.phoneNumber}</p>

                  <div className="text-3xl font-mono font-light text-emerald-400 tabular-nums mb-4">
                    {formatTimer(callTimer)}
                  </div>

                  {isOnHold && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-3">
                      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">En attente</Badge>
                    </motion.div>
                  )}
                </div>

                <div className="px-8 pb-4">
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <button
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors ${isMuted ? "bg-red-500/20 text-red-400" : "bg-white/5 hover:bg-white/10 text-white/70"}`}
                      onClick={() => setIsMuted(!isMuted)}
                    >
                      {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                      <span className="text-[11px]">{isMuted ? "Active" : "Muet"}</span>
                    </button>
                    <button
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors ${isOnHold ? "bg-amber-500/20 text-amber-400" : "bg-white/5 hover:bg-white/10 text-white/70"}`}
                      onClick={() => setIsOnHold(!isOnHold)}
                    >
                      {isOnHold ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                      <span className="text-[11px]">{isOnHold ? "Reprendre" : "Attente"}</span>
                    </button>
                    <button
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors ${showNotes ? "bg-blue-500/20 text-blue-400" : "bg-white/5 hover:bg-white/10 text-white/70"}`}
                      onClick={() => setShowNotes(!showNotes)}
                    >
                      <MessageSquare className="w-5 h-5" />
                      <span className="text-[11px]">Notes</span>
                    </button>
                  </div>

                  <AnimatePresence>
                    {showNotes && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden mb-4"
                      >
                        <Textarea
                          placeholder="Notes de l'appel..."
                          className="bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none h-20"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="px-8 pb-8">
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

            {(phase === "ended" || phase === "missed") && (
              <motion.div
                className="bg-card text-foreground"
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

                {phase === "ended" && (
                  <div className="px-8 pb-4">
                    <Textarea
                      placeholder="Ajouter des notes sur cet appel..."
                      className="resize-none h-20"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                )}

                <div className="px-8 pb-8 flex gap-3">
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
      previousCalls: matchedContact?.callCount ? Number(matchedContact.callCount) : undefined,
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
