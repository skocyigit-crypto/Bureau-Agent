import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { AvatarDock } from "@/components/AvatarDock";

type Tab = "preparer" | "script" | "compiler" | "sante";

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { key: "preparer", label: "Préparer",  icon: "zap",          color: "#3b82f6" },
  { key: "script",   label: "Script",    icon: "list",         color: "#8b5cf6" },
  { key: "compiler", label: "Compiler",  icon: "file-text",    color: "#22c55e" },
  { key: "sante",    label: "Santé CRM", icon: "heart",        color: "#ec4899" },
];

function SentimentBadge({ s }: { s: string }) {
  const cfg: Record<string, { color: string; icon: keyof typeof Feather.glyphMap }> = {
    positif:  { color: "#22c55e", icon: "smile" },
    neutre:   { color: "#64748b", icon: "meh" },
    negatif:  { color: "#ef4444", icon: "frown" },
    urgente:  { color: "#dc2626", icon: "alert-circle" },
    haute:    { color: "#f97316", icon: "alert-triangle" },
    moyenne:  { color: "#f59e0b", icon: "clock" },
    basse:    { color: "#22c55e", icon: "check-circle" },
  };
  const c = cfg[s] ?? { color: "#64748b", icon: "circle" as const };
  return (
    <View style={[st.badge, { backgroundColor: c.color + "18" }]}>
      <Feather name={c.icon} size={11} color={c.color} />
      <Text style={[st.badgeText, { color: c.color }]}>{s}</Text>
    </View>
  );
}

// ─── PRÉPARER ────────────────────────────────────────────────────────────────
function PreparerTab({ phone, name, direction, callId }: { phone: string; name: string; direction: string; callId?: string }) {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [callNotes, setCallNotes] = useState("");

  const prepare = useCallback(async () => {
    setLoading(true); setData(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/call-smart-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerPhone: phone,
          callerName: name,
          callDirection: direction || "entrant",
          callId: callId ? parseInt(callId) : undefined,
          callNotes,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.success) setData(d);
      }
    } catch {} finally { setLoading(false); }
  }, [fetchAuth, phone, name, direction, callId, callNotes]);

  useEffect(() => { if (phone || name) prepare(); }, []);

  const ai = data?.aiResponse;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      {/* Contact context bar */}
      {data?.contact && (
        <View style={[st.contactCard, { backgroundColor: "#3b82f610", borderColor: "#3b82f630" }]}>
          <View style={[st.avatarBox, { backgroundColor: "#3b82f620" }]}>
            <Text style={[st.avatarText, { color: "#3b82f6" }]}>{(data.contact.name || "?")[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[st.contactName, { color: colors.foreground }]}>{data.contact.name}</Text>
            {data.contact.company && <Text style={[st.contactSub, { color: colors.mutedForeground }]}>{data.contact.company}</Text>}
          </View>
          <View style={{ gap: 4 }}>
            <Text style={[st.metaBit, { color: colors.mutedForeground }]}>{data.context?.recentCallsCount ?? 0} appels</Text>
            {data.context?.overdueInvoicesCount > 0 && (
              <View style={[st.badge, { backgroundColor: "#ef444418" }]}>
                <Feather name="alert-triangle" size={10} color="#ef4444" />
                <Text style={[st.badgeText, { color: "#ef4444" }]}>{data.context.overdueInvoicesCount} facture{data.context.overdueInvoicesCount > 1 ? "s" : ""} impayée{data.context.overdueInvoicesCount > 1 ? "s" : ""}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Greeting */}
      {ai?.greeting && (
        <View style={[st.card, { backgroundColor: "#3b82f608", borderColor: "#3b82f630" }]}>
          <View style={st.cardHead}>
            <Feather name="message-circle" size={14} color="#3b82f6" />
            <Text style={[st.cardTitle, { color: colors.foreground }]}>Phrase d'accueil suggérée</Text>
          </View>
          <View style={[st.quoteBox, { backgroundColor: "#3b82f610" }]}>
            <Text style={[st.quoteText, { color: colors.foreground }]}>"{ai.greeting}"</Text>
          </View>
        </View>
      )}

      {/* Intent + sentiment + priority */}
      {ai && (ai.detectedIntent || ai.sentiment || ai.priority) && (
        <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={st.cardHead}>
            <Feather name="target" size={14} color="#8b5cf6" />
            <Text style={[st.cardTitle, { color: colors.foreground }]}>Analyse contextuelle</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            {ai.detectedIntent && (
              <View style={[st.intentChip, { backgroundColor: "#8b5cf618" }]}>
                <Feather name="radio" size={10} color="#8b5cf6" />
                <Text style={[st.intentChipText, { color: "#8b5cf6" }]}>Intent: {ai.detectedIntent}</Text>
              </View>
            )}
            {ai.sentiment && <SentimentBadge s={ai.sentiment} />}
            {ai.priority && <SentimentBadge s={ai.priority} />}
          </View>
          {ai.contextBriefing && (
            <Text style={[st.bodyText, { color: colors.foreground, marginTop: 8 }]}>{ai.contextBriefing}</Text>
          )}
        </View>
      )}

      {/* Warning flags */}
      {ai?.warningFlags?.length > 0 && (
        <View style={[st.card, { backgroundColor: "#ef444408", borderColor: "#ef444430" }]}>
          <View style={st.cardHead}>
            <Feather name="alert-triangle" size={14} color="#ef4444" />
            <Text style={[st.cardTitle, { color: "#ef4444" }]}>Alertes à connaître</Text>
          </View>
          {ai.warningFlags.map((w: string, i: number) => (
            <View key={i} style={[st.flagRow, { backgroundColor: "#ef444410" }]}>
              <Feather name="alert-circle" size={12} color="#ef4444" />
              <Text style={[st.flagText, { color: colors.foreground }]}>{w}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Talking points */}
      {ai?.talkingPoints?.length > 0 && (
        <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={st.cardHead}>
            <Feather name="list" size={14} color="#22c55e" />
            <Text style={[st.cardTitle, { color: colors.foreground }]}>Points à aborder</Text>
          </View>
          {ai.talkingPoints.map((p: string, i: number) => (
            <View key={i} style={st.bulletRow}>
              <View style={[st.bullet, { backgroundColor: "#22c55e" }]} />
              <Text style={[st.bulletText, { color: colors.foreground }]}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Recommended actions */}
      {ai?.recommendedActions?.length > 0 && (
        <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={st.cardHead}>
            <Feather name="check-square" size={14} color="#f59e0b" />
            <Text style={[st.cardTitle, { color: colors.foreground }]}>Actions recommandées après l'appel</Text>
          </View>
          {ai.recommendedActions.map((a: string, i: number) => (
            <View key={i} style={st.bulletRow}>
              <Feather name="arrow-right" size={11} color="#f59e0b" />
              <Text style={[st.bulletText, { color: colors.foreground }]}>{a}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Agent insights summary */}
      {ai?.agentInsightsSummary && (
        <View style={[st.card, { backgroundColor: "#6366f108", borderColor: "#6366f130" }]}>
          <View style={st.cardHead}>
            <Feather name="cpu" size={14} color="#6366f1" />
            <Text style={[st.cardTitle, { color: colors.foreground }]}>Agents IA consultés</Text>
            {data?.collaboration?.agentsConsulted?.length > 0 && (
              <View style={[st.badge, { backgroundColor: "#6366f118", marginLeft: "auto" }]}>
                <Text style={[st.badgeText, { color: "#6366f1" }]}>{data.collaboration.agentsConsulted.length} agents</Text>
              </View>
            )}
          </View>
          <Text style={[st.bodyText, { color: colors.foreground }]}>{ai.agentInsightsSummary}</Text>
        </View>
      )}

      {/* Notes + refresh */}
      <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[st.fieldLabel, { color: colors.mutedForeground }]}>Notes contextuelles (optionnel)</Text>
        <TextInput
          style={[st.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          placeholder="Raison de l'appel, contexte supplémentaire..."
          placeholderTextColor={colors.mutedForeground}
          value={callNotes}
          onChangeText={setCallNotes}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
        <Pressable onPress={prepare} disabled={loading} style={[st.btn, { backgroundColor: "#3b82f6", opacity: loading ? 0.7 : 1 }]}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="refresh-cw" size={14} color="#fff" />}
          <Text style={st.btnText}>{loading ? "Analyse IA en cours..." : "Relancer l'analyse"}</Text>
        </Pressable>
      </View>

      {loading && !data && (
        <View style={st.loadingBox}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={[st.loadingText, { color: colors.mutedForeground }]}>Préparation IA de l'appel...</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── SCRIPT ──────────────────────────────────────────────────────────────────
function ScriptTab({ phone, name, direction }: { phone: string; name: string; direction: string }) {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [scenario, setScenario] = useState("standard");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  const SCENARIOS = [
    { key: "standard",     label: "Standard",      icon: "phone" as const,        color: "#3b82f6" },
    { key: "plainte",      label: "Réclamation",   icon: "alert-circle" as const, color: "#ef4444" },
    { key: "devis",        label: "Devis/Vente",   icon: "dollar-sign" as const,  color: "#22c55e" },
    { key: "relance",      label: "Relance",       icon: "bell" as const,         color: "#f59e0b" },
    { key: "support",      label: "Support",       icon: "life-buoy" as const,    color: "#8b5cf6" },
    { key: "nouveau",      label: "Nouveau client",icon: "user-plus" as const,    color: "#ec4899" },
  ];

  const SCRIPT_TEMPLATES: Record<string, { title: string; steps: { phase: string; text: string; tips?: string }[] }> = {
    standard: {
      title: "Appel standard professionnel",
      steps: [
        { phase: "Ouverture", text: `Bonjour, je suis [Votre nom] d'Ajant Bureau${name ? `, je m'adresse bien à ${name}` : ""}. Comment puis-je vous aider aujourd'hui ?`, tips: "Parlez clairement et avec le sourire." },
        { phase: "Écoute active", text: "Je vous écoute attentivement. Pouvez-vous me donner plus de détails sur votre demande ?", tips: "Prenez des notes. Reformulez pour confirmer la compréhension." },
        { phase: "Réponse/Solution", text: "Parfaitement, voici ce que je peux vous proposer : [votre solution]. Est-ce que cela correspond à vos besoins ?", tips: "Soyez concis et direct." },
        { phase: "Confirmation", text: "Pour résumer, nous avons convenu de [résumé]. Je vous envoie une confirmation par email. Avez-vous d'autres questions ?", tips: "Récapitulez les actions prises." },
        { phase: "Clôture", text: "Merci pour votre appel. N'hésitez pas à nous recontacter. Bonne journée !", tips: "Laissez une impression positive." },
      ],
    },
    plainte: {
      title: "Gestion de réclamation client",
      steps: [
        { phase: "Accueil empathique", text: "Je comprends tout à fait votre mécontentement et je vous présente mes sincères excuses pour les désagréments causés.", tips: "Ne vous défendez pas immédiatement. Validez d'abord le ressenti." },
        { phase: "Recueil des faits", text: "Afin de traiter au mieux votre demande, pouvez-vous me préciser la date et la nature exacte du problème rencontré ?", tips: "Écoutez sans interrompre. Posez des questions ouvertes." },
        { phase: "Prise en charge", text: "Je prends personnellement en charge votre réclamation. Voici les actions que je vais engager immédiatement : [actions concrètes].", tips: "Donnez un délai précis. Engagez-vous sur ce que vous pouvez tenir." },
        { phase: "Proposition de résolution", text: "Pour réparer ce préjudice, je vous propose [solution/compensation]. Cette solution vous convient-elle ?", tips: "Proposez une solution avant qu'ils la demandent." },
        { phase: "Suivi et clôture", text: "Je vous confirme par email dans l'heure. Je vous recontacte personnellement d'ici [délai] pour m'assurer de votre satisfaction.", tips: "Tenez vos engagements absolument." },
      ],
    },
    devis: {
      title: "Proposition commerciale et devis",
      steps: [
        { phase: "Découverte des besoins", text: "Pour vous proposer la solution la plus adaptée, j'ai quelques questions. Quel est votre principal défi en ce moment ?", tips: "Écoutez plus que vous ne parlez. 70/30." },
        { phase: "Qualification", text: "Quel est votre calendrier pour ce projet ? Avez-vous déjà évalué d'autres solutions ?", tips: "Identifiez le budget, l'autorité décisionnelle et l'urgence." },
        { phase: "Présentation de valeur", text: "En fonction de vos besoins, notre solution [produit/service] vous permettrait de [bénéfice 1], [bénéfice 2] et [bénéfice 3].", tips: "Parlez bénéfices, pas fonctionnalités." },
        { phase: "Gestion des objections", text: "Je comprends cette préoccupation. Beaucoup de nos clients la partageaient au départ. Voici comment nous la résolvons : [réponse].", tips: "Reformulez l'objection positivement avant de répondre." },
        { phase: "Closing", text: "Pour aller plus loin, je vous prépare une proposition personnalisée. Quel est le meilleur moment cette semaine pour vous la présenter ?", tips: "Proposez toujours une prochaine étape concrète." },
      ],
    },
    relance: {
      title: "Relance commerciale / suivi",
      steps: [
        { phase: "Rappel contextuel", text: `Bonjour${name ? ` ${name}` : ""}, je vous rappelle suite à notre échange du [date]. Avez-vous eu l'occasion d'étudier ma proposition ?`, tips: "Soyez naturel, pas insistant." },
        { phase: "Recueil des freins", text: "Quels points vous semblent encore flous ou nécessitent des clarifications de ma part ?", tips: "Questionnez plutôt que de forcer." },
        { phase: "Réponse aux freins", text: "C'est tout à fait normal. Voici comment nous pouvons adresser ce point précisément : [réponse adaptée].", tips: "Chaque frein est une opportunité d'adapter l'offre." },
        { phase: "Création d'urgence douce", text: "Je dois vous informer que cette offre est valable jusqu'au [date]. Au-delà, les conditions tarifaires pourraient changer.", tips: "L'urgence doit être réelle pour rester crédible." },
        { phase: "Prochaine étape", text: "Que diriez-vous d'un rendez-vous de 30 minutes pour finaliser les détails ? Je suis disponible [proposer 2 créneaux].", tips: "Proposez toujours deux options, jamais une question ouverte." },
      ],
    },
    support: {
      title: "Support technique / assistance",
      steps: [
        { phase: "Identification du problème", text: "Bonjour, service support Ajant Bureau. Pouvez-vous me décrire précisément le problème que vous rencontrez ?", tips: "Posez des questions fermées pour diagnostiquer rapidement." },
        { phase: "Reproduction", text: "Depuis quand rencontrez-vous ce problème ? Sur quel appareil ou navigateur ? Avez-vous remarqué un message d'erreur particulier ?", tips: "Collectez le maximum d'informations avant d'agir." },
        { phase: "Résolution guidée", text: "Voici la procédure à suivre étape par étape : [étapes]. Êtes-vous prêt à essayer ? Je reste avec vous.", tips: "Guidez pas à pas. Attendez confirmation à chaque étape." },
        { phase: "Validation", text: "Avez-vous pu résoudre le problème ? L'application fonctionne-t-elle correctement maintenant ?", tips: "Ne clôturez jamais sans confirmation." },
        { phase: "Prévention", text: "Pour éviter que cela ne se reproduise, voici ce que je vous recommande : [conseil]. Je vous envoie un récapitulatif par email.", tips: "Transformez l'incident en opportunité d'apprentissage." },
      ],
    },
    nouveau: {
      title: "Accueil nouveau client",
      steps: [
        { phase: "Accueil chaleureux", text: "Bonjour et bienvenue chez Ajant Bureau ! Je suis [nom], votre responsable de compte. Je suis ravi(e) de vous compter parmi nous.", tips: "La première impression dure. Soyez enthousiaste et sincère." },
        { phase: "Présentation rapide", text: "En quelques mots, je vais vous présenter comment nous allons travailler ensemble et les prochaines étapes.", tips: "Rassurez immédiatement sur ce qui va se passer." },
        { phase: "Recueil des attentes", text: "Pour personnaliser au mieux notre accompagnement, qu'est-ce qui vous a décidé à nous rejoindre ? Quels sont vos objectifs principaux ?", tips: "Notez mot pour mot les attentes exprimées." },
        { phase: "Onboarding", text: "Voici ce que je vous propose pour démarrer : [plan d'onboarding]. La prochaine étape sera [action] que je m'engage à faire avant [date].", tips: "Engagez-vous sur des actions concrètes et datées." },
        { phase: "Relation durable", text: "Je serai votre interlocuteur(trice) privilégié(e). N'hésitez pas à me contacter directement. Mon objectif est votre succès.", tips: "Positionnez-vous comme partenaire, pas prestataire." },
      ],
    },
  };

  async function generateAI() {
    setLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/call-smart-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerPhone: phone,
          callerName: name,
          callDirection: direction || "entrant",
          callNotes: `Scénario: ${scenario}`,
        }),
      });
      if (res.ok) { const d = await res.json(); if (d.success) setData(d); }
    } catch {} finally { setLoading(false); }
  }

  const template = SCRIPT_TEMPLATES[scenario] ?? SCRIPT_TEMPLATES.standard;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      {/* Scenario selector */}
      <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[st.fieldLabel, { color: colors.mutedForeground }]}>Type d'appel</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
          {SCENARIOS.map(s => (
            <Pressable key={s.key} onPress={() => { setScenario(s.key); setExpandedIdx(0); }} style={[st.scenarioChip, { backgroundColor: scenario === s.key ? s.color : colors.background, borderColor: scenario === s.key ? s.color : colors.border }]}>
              <Feather name={s.icon} size={11} color={scenario === s.key ? "#fff" : colors.mutedForeground} />
              <Text style={[st.scenarioChipText, { color: scenario === s.key ? "#fff" : colors.mutedForeground }]}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Script steps */}
      <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={st.cardHead}>
          <Feather name="list" size={14} color="#8b5cf6" />
          <Text style={[st.cardTitle, { color: colors.foreground }]}>{template.title}</Text>
        </View>
        {template.steps.map((step, i) => {
          const isOpen = expandedIdx === i;
          return (
            <Pressable key={i} onPress={() => setExpandedIdx(isOpen ? null : i)} style={[st.stepRow, { borderColor: colors.border, backgroundColor: isOpen ? "#8b5cf608" : "transparent" }]}>
              <View style={[st.stepNum, { backgroundColor: isOpen ? "#8b5cf6" : colors.muted }]}>
                <Text style={[st.stepNumText, { color: isOpen ? "#fff" : colors.mutedForeground }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.stepPhase, { color: isOpen ? "#8b5cf6" : colors.mutedForeground }]}>{step.phase}</Text>
                {isOpen && (
                  <>
                    <View style={[st.quoteBox, { backgroundColor: "#8b5cf610", marginTop: 8 }]}>
                      <Text style={[st.quoteText, { color: colors.foreground }]}>"{step.text}"</Text>
                    </View>
                    {step.tips && (
                      <View style={[st.tipRow, { backgroundColor: "#f59e0b10" }]}>
                        <Feather name="info" size={11} color="#f59e0b" />
                        <Text style={[st.tipText, { color: "#b45309" }]}>{step.tips}</Text>
                      </View>
                    )}
                  </>
                )}
              </View>
              <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
            </Pressable>
          );
        })}
      </View>

      {/* AI suggested responses */}
      {data?.aiResponse?.suggestedResponses?.length > 0 && (
        <View style={[st.card, { backgroundColor: "#8b5cf608", borderColor: "#8b5cf630" }]}>
          <View style={st.cardHead}>
            <Feather name="cpu" size={14} color="#8b5cf6" />
            <Text style={[st.cardTitle, { color: colors.foreground }]}>Réponses IA personnalisées</Text>
          </View>
          {data.aiResponse.suggestedResponses.map((r: string, i: number) => (
            <View key={i} style={[st.quoteBox, { backgroundColor: "#8b5cf610", marginTop: 6 }]}>
              <Text style={[st.quoteText, { color: colors.foreground }]}>"{r}"</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable onPress={generateAI} disabled={loading} style={[st.btn, { backgroundColor: "#8b5cf6", opacity: loading ? 0.7 : 1 }]}>
        {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="cpu" size={14} color="#fff" />}
        <Text style={st.btnText}>{loading ? "Génération IA..." : "Générer réponses IA personnalisées"}</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── COMPILER ────────────────────────────────────────────────────────────────
function CompilerTab({ phone, name, callId, contactId }: { phone: string; name: string; callId?: string; contactId?: string }) {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [autoResult, setAutoResult] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("");

  async function compile() {
    setLoading(true); setResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/call-compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: callId ? parseInt(callId) : undefined,
          callerName: name,
          callerPhone: phone,
          notes,
          duration: parseInt(duration) || undefined,
        }),
      });
      if (res.ok) { const d = await res.json(); if (d.success) setResult(d); }
    } catch {} finally { setLoading(false); }
  }

  async function autoCreate() {
    setAutoLoading(true); setAutoResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/auto-create-from-interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interactionType: "appel",
          content: notes || `Appel avec ${name || phone}`,
          contactId: contactId ? parseInt(contactId) : undefined,
          contactName: name,
        }),
      });
      if (res.ok) { const d = await res.json(); if (d.success) setAutoResult(d); }
    } catch {} finally { setAutoLoading(false); }
  }

  const comp = result?.compilation;
  const URGENCY_COLORS: Record<string, string> = { normal: "#22c55e", eleve: "#f59e0b", critique: "#ef4444" };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      {/* Form */}
      <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={st.cardHead}>
          <Feather name="edit-3" size={14} color="#22c55e" />
          <Text style={[st.cardTitle, { color: colors.foreground }]}>Notes de l'appel</Text>
        </View>
        <TextInput
          style={[st.inputLg, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          placeholder="Résumez ce qui a été dit, les décisions prises, les engagements pris..."
          placeholderTextColor={colors.mutedForeground}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={[st.fieldLabel, { color: colors.mutedForeground }]}>Durée (secondes)</Text>
            <TextInput style={[st.inputSm, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} placeholder="Ex: 180" placeholderTextColor={colors.mutedForeground} value={duration} onChangeText={setDuration} keyboardType="numeric" />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <Pressable onPress={compile} disabled={loading || !notes.trim()} style={[st.btn, { flex: 1, backgroundColor: "#22c55e", opacity: loading || !notes.trim() ? 0.6 : 1 }]}>
            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="file-text" size={14} color="#fff" />}
            <Text style={st.btnText}>{loading ? "Compilation..." : "Compiler l'appel"}</Text>
          </Pressable>
          <Pressable onPress={autoCreate} disabled={autoLoading || !notes.trim()} style={[st.btn, { flex: 1, backgroundColor: "#3b82f6", opacity: autoLoading || !notes.trim() ? 0.6 : 1 }]}>
            {autoLoading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="zap" size={14} color="#fff" />}
            <Text style={st.btnText}>{autoLoading ? "Création..." : "Créer tâches auto"}</Text>
          </Pressable>
        </View>
      </View>

      {/* Compilation result */}
      {comp && (
        <View style={{ gap: 10 }}>
          <View style={[st.card, { backgroundColor: "#22c55e08", borderColor: "#22c55e30" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Feather name="check-circle" size={14} color="#22c55e" />
              <Text style={[st.cardTitle, { color: colors.foreground }]}>Résumé de l'appel</Text>
              {comp.urgencyLevel && (
                <View style={[st.badge, { backgroundColor: (URGENCY_COLORS[comp.urgencyLevel] ?? "#64748b") + "18", marginLeft: "auto" }]}>
                  <Text style={[st.badgeText, { color: URGENCY_COLORS[comp.urgencyLevel] ?? "#64748b" }]}>{comp.urgencyLevel}</Text>
                </View>
              )}
            </View>
            {comp.summary && <Text style={[st.bodyText, { color: colors.foreground }]}>{comp.summary}</Text>}
            {comp.summary ? (
              <View style={{ marginTop: 8 }}>
                <AvatarDock text={comp.summary} autoSpeak={false} storageKey="buro.callassist.voice" />
              </View>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {comp.sentiment && <SentimentBadge s={comp.sentiment} />}
              {comp.followUpNeeded && (
                <View style={[st.badge, { backgroundColor: "#f59e0b18" }]}>
                  <Feather name="bell" size={10} color="#f59e0b" />
                  <Text style={[st.badgeText, { color: "#f59e0b" }]}>Suivi requis{comp.followUpDate ? ` — ${comp.followUpDate}` : ""}</Text>
                </View>
              )}
            </View>
          </View>

          {comp.keyDecisions?.length > 0 && (
            <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[st.cardTitle, { color: colors.foreground, marginBottom: 6 }]}>✅ Décisions prises</Text>
              {comp.keyDecisions.map((d: string, i: number) => (
                <View key={i} style={st.bulletRow}>
                  <View style={[st.bullet, { backgroundColor: "#22c55e" }]} />
                  <Text style={[st.bulletText, { color: colors.foreground }]}>{d}</Text>
                </View>
              ))}
            </View>
          )}

          {comp.topics?.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {comp.topics.map((t: string, i: number) => (
                <View key={i} style={[st.topicChip, { backgroundColor: "#3b82f618", borderColor: "#3b82f630" }]}>
                  <Text style={[st.topicChipText, { color: "#3b82f6" }]}>{t}</Text>
                </View>
              ))}
            </View>
          )}

          {(result?.createdTasks?.length > 0 || result?.createdEvents?.length > 0) && (
            <View style={[st.card, { backgroundColor: "#3b82f608", borderColor: "#3b82f630" }]}>
              <Text style={[st.cardTitle, { color: colors.foreground, marginBottom: 6 }]}>
                🗂 Créé automatiquement : {result.createdTasks?.length ?? 0} tâche{(result.createdTasks?.length ?? 0) > 1 ? "s" : ""}, {result.createdEvents?.length ?? 0} RDV
              </Text>
              {result.createdTasks?.map((t: any, i: number) => (
                <Text key={i} style={[st.bodyText, { color: colors.foreground }]}>• {t.title}</Text>
              ))}
              {result.createdEvents?.map((e: any, i: number) => (
                <Text key={i} style={[st.bodyText, { color: "#8b5cf6" }]}>📅 {e.title}</Text>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Auto-create result */}
      {autoResult && (
        <View style={[st.card, { backgroundColor: "#3b82f608", borderColor: "#3b82f630" }]}>
          <View style={st.cardHead}>
            <Feather name="zap" size={14} color="#3b82f6" />
            <Text style={[st.cardTitle, { color: colors.foreground }]}>Actions créées automatiquement</Text>
          </View>
          {autoResult.summary && <Text style={[st.bodyText, { color: colors.mutedForeground, marginBottom: 8 }]}>{autoResult.summary}</Text>}
          {autoResult.createdTasks?.map((t: any, i: number) => (
            <View key={i} style={[st.bulletRow, { marginTop: 4 }]}>
              <Feather name="check-square" size={11} color="#22c55e" />
              <Text style={[st.bulletText, { color: colors.foreground }]}>{t.title}</Text>
            </View>
          ))}
          {autoResult.createdEvents?.map((e: any, i: number) => (
            <View key={i} style={[st.bulletRow, { marginTop: 4 }]}>
              <Feather name="calendar" size={11} color="#8b5cf6" />
              <Text style={[st.bulletText, { color: colors.foreground }]}>{e.title}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── SANTÉ CRM ────────────────────────────────────────────────────────────────
function SanteTab({ contactId, contactName }: { contactId?: string; contactName?: string }) {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [manualId, setManualId] = useState(contactId ?? "");

  const load = useCallback(async (id?: string) => {
    const cid = id ?? manualId;
    if (!cid) return;
    setLoading(true); setData(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/contact-health/${cid}`);
      if (res.ok) { const d = await res.json(); if (d.success) setData(d); }
    } catch {} finally { setLoading(false); }
  }, [fetchAuth, manualId]);

  useEffect(() => { if (contactId) load(contactId); }, [contactId]);

  function getHealthColor(score: number) {
    if (score >= 75) return "#22c55e";
    if (score >= 55) return "#f59e0b";
    if (score >= 35) return "#f97316";
    return "#ef4444";
  }

  if (!contactId && !manualId) {
    return (
      <View style={{ gap: 12 }}>
        <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[st.bodyText, { color: colors.mutedForeground, marginBottom: 8 }]}>Saisissez l'ID du contact pour analyser sa santé CRM.</Text>
          <TextInput style={[st.inputSm, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]} placeholder="ID du contact" placeholderTextColor={colors.mutedForeground} value={manualId} onChangeText={setManualId} keyboardType="numeric" />
          <Pressable onPress={() => load()} disabled={loading || !manualId} style={[st.btn, { backgroundColor: "#ec4899", marginTop: 8, opacity: !manualId ? 0.6 : 1 }]}>
            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="heart" size={14} color="#fff" />}
            <Text style={st.btnText}>Analyser</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (loading) return <View style={st.loadingBox}><ActivityIndicator size="large" color="#ec4899" /><Text style={[st.loadingText, { color: colors.mutedForeground }]}>Calcul santé CRM...</Text></View>;

  if (!data) return (
    <View style={st.emptyBox}>
      <Feather name="heart" size={40} color="#ec4899" />
      <Text style={[st.emptyText, { color: colors.foreground }]}>{contactName ?? "Contact"}</Text>
      <Pressable onPress={() => load()} style={[st.btn, { backgroundColor: "#ec4899" }]}>
        <Feather name="refresh-cw" size={14} color="#fff" />
        <Text style={st.btnText}>Charger la santé CRM</Text>
      </Pressable>
    </View>
  );

  const score = data.healthScore ?? 50;
  const healthColor = getHealthColor(score);
  const STATUS_LABELS: Record<string, string> = { excellent: "Excellent", bon: "Bon", attention: "Attention", critique: "Critique" };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      {/* Score card */}
      <View style={[st.card, { backgroundColor: healthColor + "10", borderColor: healthColor + "40" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={[st.healthCircle, { borderColor: healthColor }]}>
            <Text style={[st.healthScore, { color: healthColor }]}>{score}</Text>
            <Text style={[st.healthScoreSub, { color: healthColor }]}>/100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[st.cardTitle, { color: colors.foreground }]}>{data.contact?.name ?? contactName}</Text>
            {data.contact?.company && <Text style={[st.contactSub, { color: colors.mutedForeground }]}>{data.contact.company}</Text>}
            <View style={[st.badge, { backgroundColor: healthColor + "18", marginTop: 6, alignSelf: "flex-start" }]}>
              <Text style={[st.badgeText, { color: healthColor }]}>{STATUS_LABELS[data.status] ?? data.status}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Metrics grid */}
      {data.metrics && (
        <View style={st.metricsGrid}>
          {[
            { icon: "phone" as const,       color: "#3b82f6", label: "Appels",         val: `${data.metrics.calls?.total ?? 0} total / ${data.metrics.calls?.recent ?? 0} ce mois` },
            { icon: "phone-missed" as const, color: "#ef4444", label: "Manqués",        val: `${data.metrics.calls?.missed ?? 0}` },
            { icon: "check-square" as const, color: "#22c55e", label: "Tâches faites",  val: `${data.metrics.tasks?.completed ?? 0}` },
            { icon: "alert-circle" as const, color: "#f59e0b", label: "Tâches retard",  val: `${data.metrics.tasks?.overdue ?? 0}` },
            { icon: "message-circle" as const, color: "#8b5cf6", label: "Messages",    val: `${data.metrics.messages?.unread ?? 0} non lus` },
            { icon: "file-text" as const,    color: "#ef4444", label: "Fact. impayées", val: `${data.metrics.invoices?.overdue ?? 0}` },
          ].map(m => (
            <View key={m.label} style={[st.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name={m.icon} size={14} color={m.color} />
              <Text style={[st.metricVal, { color: colors.foreground }]}>{m.val}</Text>
              <Text style={[st.metricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Risks */}
      {data.risks?.length > 0 && (
        <View style={[st.card, { backgroundColor: "#ef444408", borderColor: "#ef444430" }]}>
          <View style={st.cardHead}>
            <Feather name="alert-triangle" size={14} color="#ef4444" />
            <Text style={[st.cardTitle, { color: "#ef4444" }]}>Risques identifiés</Text>
          </View>
          {data.risks.map((r: string, i: number) => (
            <View key={i} style={[st.flagRow, { backgroundColor: "#ef444410" }]}>
              <Feather name="x-circle" size={12} color="#ef4444" />
              <Text style={[st.flagText, { color: colors.foreground }]}>{r}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Opportunities */}
      {data.opportunities?.length > 0 && (
        <View style={[st.card, { backgroundColor: "#22c55e08", borderColor: "#22c55e30" }]}>
          <View style={st.cardHead}>
            <Feather name="trending-up" size={14} color="#22c55e" />
            <Text style={[st.cardTitle, { color: "#22c55e" }]}>Opportunités</Text>
          </View>
          {data.opportunities.map((o: string, i: number) => (
            <View key={i} style={[st.flagRow, { backgroundColor: "#22c55e10" }]}>
              <Feather name="check" size={12} color="#22c55e" />
              <Text style={[st.flagText, { color: colors.foreground }]}>{o}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Contributing factors */}
      {data.factors?.length > 0 && (
        <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[st.cardTitle, { color: colors.foreground, marginBottom: 8 }]}>Facteurs du score</Text>
          {data.factors.map((f: any, i: number) => (
            <View key={i} style={st.factorRow}>
              <Text style={[st.factorImpact, { color: f.impact >= 0 ? "#22c55e" : "#ef4444" }]}>
                {f.impact >= 0 ? "+" : ""}{f.impact}
              </Text>
              <Text style={[st.factorDetail, { color: colors.foreground }]}>{f.detail}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable onPress={() => load()} style={[st.btn, { backgroundColor: "#ec4899", marginBottom: 16 }]}>
        <Feather name="refresh-cw" size={14} color="#fff" />
        <Text style={st.btnText}>Actualiser</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function CallAssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { phone = "", name = "", direction = "entrant", callId, contactId } = useLocalSearchParams<{
    phone?: string; name?: string; direction?: string; callId?: string; contactId?: string;
  }>();

  const [tab, setTab] = useState<Tab>("preparer");
  const activeColor = TABS.find(t => t.key === tab)?.color ?? "#3b82f6";

  const displayName = name || phone || "Appel entrant";
  const isOutbound = direction === "sortant" || direction === "outbound";

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[st.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={st.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={st.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={st.headerTitle} numberOfLines={1}>{displayName}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
              <Feather name={isOutbound ? "phone-outgoing" : "phone-incoming"} size={11} color="rgba(255,255,255,0.7)" />
              <Text style={st.headerSub}>{isOutbound ? "Sortant" : "Entrant"}{phone && name ? ` · ${phone}` : ""}</Text>
            </View>
          </View>
          {phone && (
            <Pressable onPress={() => Linking.openURL(`tel:${phone}`)} style={[st.callBtn, { backgroundColor: "#22c55e" }]}>
              <Feather name="phone" size={18} color="#fff" />
            </Pressable>
          )}
        </View>

        {/* Tab row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
          {TABS.map(t => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[st.tabChip, { backgroundColor: tab === t.key ? t.color : "rgba(255,255,255,0.12)" }]}>
              <Feather name={t.icon} size={12} color={tab === t.key ? "#fff" : "rgba(255,255,255,0.7)"} />
              <Text style={[st.tabChipText, { color: tab === t.key ? "#fff" : "rgba(255,255,255,0.7)" }]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={[st.body, { paddingBottom: isWeb ? 120 : 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {tab === "preparer" && <PreparerTab phone={phone} name={name} direction={direction} callId={callId} />}
        {tab === "script"   && <ScriptTab   phone={phone} name={name} direction={direction} />}
        {tab === "compiler" && <CompilerTab phone={phone} name={name} callId={callId} contactId={contactId} />}
        {tab === "sante"    && <SanteTab    contactId={contactId} contactName={name} />}
      </ScrollView>
    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#166534", paddingHorizontal: 16, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  callBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  tabChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  tabChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  body: { padding: 14, gap: 12 },
  loadingBox: { paddingTop: 60, alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyBox: { paddingTop: 60, alignItems: "center", gap: 14 },
  emptyText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  contactCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  avatarBox: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  contactName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  contactSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  metaBit: { fontSize: 11, fontFamily: "Inter_400Regular" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  quoteBox: { borderRadius: 8, padding: 10 },
  quoteText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, fontStyle: "italic" },
  intentChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  intentChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  flagRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 8, borderRadius: 8, marginTop: 4 },
  flagText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 6 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 6, flexShrink: 0 },
  bulletText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 19 },
  bodyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 70, marginBottom: 4 },
  inputLg: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 90, marginBottom: 4 },
  inputSm: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontFamily: "Inter_400Regular" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13, borderRadius: 10 },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  scenarioChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  scenarioChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  stepNumText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stepPhase: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 7, borderRadius: 6, marginTop: 6 },
  tipText: { fontSize: 11, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 16 },
  topicChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  topicChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metricCard: { minWidth: "30%", flex: 1, alignItems: "center", padding: 10, borderRadius: 10, borderWidth: 1, gap: 3 },
  metricVal: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  metricLabel: { fontSize: 9, fontFamily: "Inter_400Regular", textAlign: "center" },
  healthCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, alignItems: "center", justifyContent: "center" },
  healthScore: { fontSize: 24, fontFamily: "Inter_700Bold" },
  healthScoreSub: { fontSize: 10, fontFamily: "Inter_400Regular" },
  factorRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f020" },
  factorImpact: { fontSize: 13, fontFamily: "Inter_700Bold", width: 34, textAlign: "right", flexShrink: 0 },
  factorDetail: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
});
