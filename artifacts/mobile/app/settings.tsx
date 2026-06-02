import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import { usePrivacy } from "@/contexts/PrivacyContext";
import { useNotificationPrefs } from "@/contexts/NotificationPrefsContext";
import {
  INLINE_SUGGEST_LANGUAGES,
  useInlineSuggestPreferences,
  type InlineSuggestConfigurableField,
} from "@/hooks/useInlineSuggest";

const INLINE_SUGGEST_FIELD_OPTIONS: ReadonlyArray<{
  field: InlineSuggestConfigurableField;
  label: string;
  description: string;
}> = [
  { field: "note", label: "Notes internes", description: "Suggestions pendant la rédaction des notes internes." },
  { field: "prospect_note", label: "Notes de prospect", description: "Suggestions dans les notes attachées à un prospect." },
  { field: "email_body", label: "Corps des e-mails", description: "Suggestions dans le corps des messages d’e-mail." },
];

interface Subscription {
  plan: string;
  status: string;
  licenseKey?: string;
  maxUsers: number;
  maxContacts: number;
  maxCallsPerMonth: number;
  price: string;
  billingCycle: string;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
}

const PLAN_LABELS: Record<string, string> = {
  essai: "Essai gratuit",
  starter: "Starter",
  professionnel: "Professionnel",
  entreprise: "Entreprise",
};

const PLAN_COLORS: Record<string, string> = {
  essai: "#64748b",
  starter: "#3b82f6",
  professionnel: "#8b5cf6",
  entreprise: "#f59e0b",
};

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/subscription`);
        if (res.ok) { const data = await res.json(); setSub(data.subscription ?? data); }
      } catch (err) { console.warn("[Settings] fetch failed:", err); } finally { setLoading(false); }
    })();
  }, [fetchAuth]);

  function InfoRow({ icon, label, value, color }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; color?: string }) {
    return (
      <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
        <Feather name={icon} size={16} color={color || colors.mutedForeground} style={styles.infoIcon} />
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Parametres</Text>
          <View style={{ width: 22 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 40 }]} showsVerticalScrollIndicator={false}>
        {user ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="user" size={18} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Profil</Text>
            </View>
            <InfoRow icon="user" label="Nom" value={`${user.prenom} ${user.nom}`} />
            <InfoRow icon="mail" label="E-mail" value={user.email} />
            <InfoRow icon="shield" label="Role" value={user.role === "super_admin" ? "Super Admin" : user.role === "administrateur" ? "Administrateur" : user.role === "agent" ? "Agent" : "Lecture seule"} />
            {user.departement ? <InfoRow icon="briefcase" label="Departement" value={user.departement} /> : null}
            {user.organisation ? <InfoRow icon="home" label="Organisation" value={user.organisation} /> : null}
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="credit-card" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Abonnement</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.subLoading} />
          ) : sub ? (
            <>
              <View style={[styles.planBadge, { backgroundColor: (PLAN_COLORS[sub.plan] ?? "#64748b") + "18" }]}>
                <Feather name="star" size={16} color={PLAN_COLORS[sub.plan] ?? "#64748b"} />
                <Text style={[styles.planName, { color: PLAN_COLORS[sub.plan] ?? "#64748b" }]}>
                  {PLAN_LABELS[sub.plan] ?? sub.plan}
                </Text>
                <View style={[styles.statusDot, { backgroundColor: sub.status === "active" ? "#22c55e" : "#f59e0b" }]} />
                <Text style={[styles.statusText, { color: sub.status === "active" ? "#22c55e" : "#f59e0b" }]}>
                  {sub.status === "active" ? "Actif" : sub.status}
                </Text>
              </View>
              <InfoRow icon="users" label="Utilisateurs max" value={`${sub.maxUsers}`} />
              <InfoRow icon="book" label="Contacts max" value={sub.maxContacts >= 999999 ? "Illimite" : `${sub.maxContacts}`} />
              <InfoRow icon="phone" label="Appels/mois" value={sub.maxCallsPerMonth >= 999999 ? "Illimite" : `${sub.maxCallsPerMonth}`} />
              <InfoRow icon="tag" label="Prix" value={`${sub.price} EUR/${sub.billingCycle === "monthly" ? "mois" : "an"}`} />
              {sub.trialEndsAt ? <InfoRow icon="clock" label="Fin d'essai" value={new Date(sub.trialEndsAt).toLocaleDateString("fr-FR")} color="#f59e0b" /> : null}
              {sub.currentPeriodEnd ? <InfoRow icon="calendar" label="Prochain renouvellement" value={new Date(sub.currentPeriodEnd).toLocaleDateString("fr-FR")} /> : null}
            </>
          ) : (
            <Text style={[styles.noSub, { color: colors.mutedForeground }]}>Aucun abonnement actif</Text>
          )}
        </View>

        <ThemeCard />

        <AlertsCard />

        <WhatsAppNotificationsCard />

        <PreferencesIaCard />

        <PrivacyCard />

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="info" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Application</Text>
          </View>
          <InfoRow icon="smartphone" label="Version" value="1.0.0" />
          <InfoRow icon="globe" label="Plateforme" value={Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web"} />
          <InfoRow icon="code" label="Framework" value="React Native / Expo" />
        </View>
      </ScrollView>
    </View>
  );
}

// ── Tema kartı ─────────────────────────────────────────────────────────────────

function ThemeCard() {
  const colors = useColors();
  const { mode, setMode } = useTheme();
  const modes: { key: "system" | "light" | "dark"; icon: keyof typeof Feather.glyphMap; label: string }[] = [
    { key: "system", icon: "smartphone", label: "Systeme" },
    { key: "light", icon: "sun", label: "Clair" },
    { key: "dark", icon: "moon", label: "Sombre" },
  ];
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="moon" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Apparence</Text>
      </View>
      <View style={styles.themeRow}>
        {modes.map(m => (
          <Pressable
            key={m.key}
            onPress={() => setMode(m.key)}
            style={[styles.themeBtn, { borderColor: mode === m.key ? colors.primary : colors.border, backgroundColor: mode === m.key ? colors.primary + "18" : "transparent" }]}
          >
            <Feather name={m.icon} size={20} color={mode === m.key ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.themeBtnLabel, { color: mode === m.key ? colors.primary : colors.mutedForeground }]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ── Gizlilik kartı ─────────────────────────────────────────────────────────────

const AUTO_LOCK_OPTIONS = [
  { minutes: 0, label: "Desactive" },
  { minutes: 1, label: "1 minute" },
  { minutes: 5, label: "5 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
];

function PrivacyCard() {
  const colors = useColors();
  const {
    settings,
    updateSettings,
    setPIN,
    removePIN,
    biometricAvailable,
    biometricType,
    lock,
  } = usePrivacy();

  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinStep, setPinStep] = useState<"enter" | "confirm">("enter");
  const [pinFirst, setPinFirst] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  const handleSetPIN = useCallback(async () => {
    if (pinStep === "enter") {
      if (pinInput.length !== 4) { setPinError("Le code PIN doit contenir 4 chiffres"); return; }
      setPinFirst(pinInput);
      setPinInput("");
      setPinStep("confirm");
      setPinError("");
    } else {
      if (pinInput !== pinFirst) {
        setPinError("Les codes PIN ne correspondent pas");
        setPinInput("");
        setPinStep("enter");
        return;
      }
      await setPIN(pinInput);
      setPinInput("");
      setPinFirst("");
      setPinStep("enter");
      setPinError("");
      setShowPinSetup(false);
    }
  }, [pinStep, pinInput, pinFirst, setPIN]);

  const handleRemovePIN = useCallback(() => {
    Alert.alert(
      "Supprimer le code PIN",
      "Etes-vous sur de vouloir supprimer le code PIN ? La protection par PIN sera desactivee.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            await removePIN();
            await updateSettings({ biometricEnabled: false });
          },
        },
      ]
    );
  }, [removePIN, updateSettings]);

  function ToggleRow({
    icon,
    label,
    sublabel,
    value,
    onToggle,
    disabled,
  }: {
    icon: keyof typeof Feather.glyphMap;
    label: string;
    sublabel?: string;
    value: boolean;
    onToggle: (v: boolean) => void;
    disabled?: boolean;
  }) {
    return (
      <View style={[styles.toggleRow, { borderBottomColor: colors.border, opacity: disabled ? 0.45 : 1 }]}>
        <Feather name={icon} size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{label}</Text>
          {sublabel ? <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>{sublabel}</Text> : null}
        </View>
        <Switch
          value={value}
          onValueChange={onToggle}
          disabled={disabled}
          trackColor={{ false: colors.border, true: colors.primary + "88" }}
          thumbColor={value ? colors.primary : colors.mutedForeground}
        />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Başlık */}
      <View style={styles.cardHeader}>
        <Feather name="lock" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Confidentialite et securite</Text>
      </View>

      {/* Arka plan örtüsü */}
      <ToggleRow
        icon="eye-off"
        label="Ecran de confidentialite"
        sublabel="Masque le contenu dans le selecteur d'applications"
        value={settings.privacyScreenEnabled}
        onToggle={v => updateSettings({ privacyScreenEnabled: v })}
      />

      {/* Hassas veri maskesi */}
      <ToggleRow
        icon="minus-circle"
        label="Masquer les donnees sensibles"
        sublabel="Telephone, e-mail — appuyez pour afficher"
        value={settings.maskSensitiveData}
        onToggle={v => updateSettings({ maskSensitiveData: v })}
      />

      {/* Biyometrik */}
      <ToggleRow
        icon="activity"
        label={biometricType ? `Deverrouillage ${biometricType}` : "Biometrie"}
        sublabel={
          !biometricAvailable && Platform.OS !== "web"
            ? "Non disponible sur cet appareil"
            : !settings.hasPIN
            ? "Definissez d'abord un code PIN"
            : undefined
        }
        value={settings.biometricEnabled}
        onToggle={v => updateSettings({ biometricEnabled: v })}
        disabled={!biometricAvailable || !settings.hasPIN}
      />

      {/* Otomatik kilit süresi */}
      <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
        <Feather name="clock" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Verrouillage automatique</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            Apres inactivite
          </Text>
        </View>
      </View>
      <View style={styles.lockOptionsRow}>
        {AUTO_LOCK_OPTIONS.map(opt => (
          <Pressable
            key={opt.minutes}
            onPress={() => updateSettings({ autoLockMinutes: opt.minutes })}
            style={[
              styles.lockOptionBtn,
              {
                borderColor: settings.autoLockMinutes === opt.minutes ? colors.primary : colors.border,
                backgroundColor: settings.autoLockMinutes === opt.minutes ? colors.primary + "18" : "transparent",
              },
            ]}
          >
            <Text style={[
              styles.lockOptionText,
              { color: settings.autoLockMinutes === opt.minutes ? colors.primary : colors.mutedForeground },
            ]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* PIN Yönetimi */}
      <View style={[styles.pinSection, { borderTopColor: colors.border }]}>
        {!settings.hasPIN ? (
          <Pressable
            style={[styles.pinActionBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "12" }]}
            onPress={() => { setShowPinSetup(true); setPinStep("enter"); setPinInput(""); setPinError(""); }}
          >
            <Feather name="lock" size={15} color={colors.primary} />
            <Text style={[styles.pinActionText, { color: colors.primary }]}>Definir un code PIN</Text>
          </Pressable>
        ) : (
          <View style={styles.pinActionsRow}>
            <Pressable
              style={[styles.pinActionBtn, { flex: 1, borderColor: colors.border }]}
              onPress={() => { setShowPinSetup(true); setPinStep("enter"); setPinInput(""); setPinError(""); }}
            >
              <Feather name="edit-2" size={14} color={colors.mutedForeground} />
              <Text style={[styles.pinActionText, { color: colors.mutedForeground }]}>Changer le PIN</Text>
            </Pressable>
            <Pressable
              style={[styles.pinActionBtn, { flex: 1, borderColor: "#ef444444", backgroundColor: "#ef444408" }]}
              onPress={handleRemovePIN}
            >
              <Feather name="trash-2" size={14} color="#ef4444" />
              <Text style={[styles.pinActionText, { color: "#ef4444" }]}>Supprimer le PIN</Text>
            </Pressable>
          </View>
        )}

        {/* PIN kurulum formu */}
        {showPinSetup && (
          <View style={[styles.pinForm, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.pinFormTitle, { color: colors.foreground }]}>
              {pinStep === "enter" ? "Nouveau code PIN (4 chiffres)" : "Confirmez le code PIN"}
            </Text>
            <TextInput
              style={[styles.pinInput, { borderColor: pinError ? "#ef4444" : colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              value={pinInput}
              onChangeText={t => { setPinInput(t.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
              placeholder="••••"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
            />
            {pinError ? <Text style={styles.pinErrText}>{pinError}</Text> : null}
            <View style={styles.pinFormBtns}>
              <Pressable
                style={[styles.pinFormBtn, { borderColor: colors.border }]}
                onPress={() => { setShowPinSetup(false); setPinInput(""); setPinError(""); setPinStep("enter"); }}
              >
                <Text style={[styles.pinFormBtnText, { color: colors.mutedForeground }]}>Annuler</Text>
              </Pressable>
              <Pressable
                style={[styles.pinFormBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={handleSetPIN}
              >
                <Text style={[styles.pinFormBtnText, { color: colors.secondary }]}>
                  {pinStep === "enter" ? "Suivant" : "Confirmer"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Manuel kilit butonu */}
      <Pressable
        style={[styles.lockNowBtn, { borderTopColor: colors.border }]}
        onPress={() => { lock(); router.back(); }}
      >
        <Feather name="lock" size={15} color="#ef4444" />
        <Text style={[styles.lockNowText]}>Verrouiller maintenant</Text>
      </Pressable>
    </View>
  );
}

// ── Alertes (haptiques + notifications locales) ───────────────────────────────

const ALERT_CHANNEL_ROWS: ReadonlyArray<{
  key: "message" | "task" | "call" | "rappel" | "security";
  icon: keyof typeof Feather.glyphMap;
  label: string;
  sublabel: string;
}> = [
  {
    key: "message",
    icon: "mail",
    label: "Nouveaux messages",
    sublabel: "Buzz et notification quand un message arrive.",
  },
  {
    key: "task",
    icon: "check-square",
    label: "Nouvelles tâches",
    sublabel: "Buzz et notification quand une tâche vous est assignée.",
  },
  {
    key: "call",
    icon: "phone-missed",
    label: "Appels manqués",
    sublabel: "Coupez ce canal si vous suivez les appels sur un autre téléphone.",
  },
  {
    // Tâche #98 : mute des rappels calendrier. Le compteur de la tuile
    // Rappels continue d'incrémenter, seules vibration + notif système
    // sont coupées.
    key: "rappel",
    icon: "bell",
    label: "Rappels",
    sublabel: "Coupez ce canal si vous gardez votre agenda ouvert ailleurs.",
  },
  {
    // Tâche #146 : mute des alertes de menace documentaire. La suggestion
    // de menace reste visible dans l'app ; seules vibration + notif système
    // sont coupées. Actif par défaut (les menaces sont urgentes).
    key: "security",
    icon: "shield",
    label: "Sécurité / Documents",
    sublabel: "Alerte quand un document analysé est jugé dangereux. La suggestion reste visible dans l'app.",
  },
];

function AlertsCard() {
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const {
    hapticsEnabled,
    notificationsEnabled,
    channelMuted,
    loaded,
    setHapticsEnabled,
    setNotificationsEnabled,
    setChannelMuted,
  } = useNotificationPrefs();

  const onToggleNotifications = useCallback(
    async (v: boolean) => {
      const ok = await setNotificationsEnabled(v);
      if (v && !ok) {
        Alert.alert(
          "Notifications refusées",
          isWeb
            ? "Les notifications locales ne sont pas disponibles dans la version web."
            : "Autorisez les notifications dans les réglages système pour recevoir une alerte quand l'app est en arrière-plan.",
        );
      }
    },
    [setNotificationsEnabled, isWeb],
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="bell" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Alertes en temps réel</Text>
      </View>

      <View style={[styles.toggleRow, { borderBottomColor: colors.border, opacity: isWeb ? 0.45 : 1 }]}>
        <Feather name="smartphone" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Vibration</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            Buzz léger pour les nouveaux messages, tâches et appels manqués (selon les canaux ci-dessous).
          </Text>
        </View>
        <Switch
          value={hapticsEnabled && !isWeb}
          onValueChange={setHapticsEnabled}
          disabled={!loaded || isWeb}
          trackColor={{ false: colors.border, true: colors.primary + "88" }}
          thumbColor={hapticsEnabled ? colors.primary : colors.mutedForeground}
        />
      </View>

      <View style={[styles.toggleRow, { borderBottomColor: colors.border, opacity: isWeb ? 0.45 : 1 }]}>
        <Feather name="bell" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Notifications système</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            Affiche une notification sur l'écran de verrouillage quand l'app est en arrière-plan.
          </Text>
        </View>
        <Switch
          value={notificationsEnabled && !isWeb}
          onValueChange={onToggleNotifications}
          disabled={!loaded || isWeb}
          trackColor={{ false: colors.border, true: colors.primary + "88" }}
          thumbColor={notificationsEnabled ? colors.primary : colors.mutedForeground}
        />
      </View>

      {/* Tâche #85 : mute par canal — la secrétaire peut couper un type
          d'alerte (ex. appels manqués) sans toucher aux autres. */}
      <Text style={[styles.channelGroupLabel, { color: colors.mutedForeground }]}>
        Par type d'alerte
      </Text>
      {ALERT_CHANNEL_ROWS.map((row, idx) => {
        const active = !channelMuted[row.key];
        const isLast = idx === ALERT_CHANNEL_ROWS.length - 1;
        return (
          <View
            key={row.key}
            style={[
              styles.toggleRow,
              {
                borderBottomColor: colors.border,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                opacity: isWeb ? 0.45 : 1,
              },
            ]}
          >
            <Feather name={row.icon} size={16} color={colors.mutedForeground} style={styles.infoIcon} />
            <View style={styles.toggleText}>
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{row.label}</Text>
              <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
                {row.sublabel}
              </Text>
            </View>
            <Switch
              value={active && !isWeb}
              onValueChange={(v) => setChannelMuted(row.key, !v)}
              disabled={!loaded || isWeb}
              trackColor={{ false: colors.border, true: colors.primary + "88" }}
              thumbColor={active ? colors.primary : colors.mutedForeground}
            />
          </View>
        );
      })}
    </View>
  );
}

// ── Notifications WhatsApp (opt-in serveur) ──────────────────────────────────
//
// Lit/ecrit les flags whatsappNotifications dans user_preferences via
// /api/me/preferences. Cote serveur, ces flags determinent si l'utilisateur
// recoit un message WhatsApp pour chaque categorie (task / call / appointment
// / message). Necessite un numero de telephone renseigne et un fournisseur
// Twilio actif sur l'org. La persistance est faite cote serveur, le draft
// local n'est jamais ecrase tant qu'il y a des modifications non sauvegardees.

type WhatsAppFlag = "task" | "call" | "appointment" | "message";

const WHATSAPP_ROWS: ReadonlyArray<{
  key: WhatsAppFlag;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  sublabel: string;
}> = [
  { key: "task", icon: "check-square", label: "Nouvelle tache assignee", sublabel: "Quand une tache vous est attribuee." },
  { key: "call", icon: "phone-incoming", label: "Appel entrant", sublabel: "Lorsque l'agent telephonique recoit un appel." },
  { key: "appointment", icon: "calendar", label: "Nouveau rendez-vous", sublabel: "Quand un evenement est cree dans l'agenda." },
  { key: "message", icon: "message-circle", label: "Nouveau message", sublabel: "Lorsqu'un message interne est ajoute." },
];

const WA_DEFAULTS: Record<WhatsAppFlag, boolean> = {
  task: false,
  call: false,
  appointment: false,
  message: false,
};

function WhatsAppNotificationsCard() {
  const colors = useColors();
  const { fetchAuth, isAuthenticated } = useAuth();
  const [serverFlags, setServerFlags] = useState<Record<WhatsAppFlag, boolean>>(WA_DEFAULTS);
  const [draft, setDraft] = useState<Record<WhatsAppFlag, boolean>>(WA_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = (Object.keys(draft) as WhatsAppFlag[]).some((k) => draft[k] !== serverFlags[k]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/me/preferences`);
        if (!res || !res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const data = await res.json().catch(() => ({}));
        const wa = (data?.whatsappNotifications ?? {}) as Partial<Record<WhatsAppFlag, boolean>>;
        const merged: Record<WhatsAppFlag, boolean> = {
          task: wa.task === true,
          call: wa.call === true,
          appointment: wa.appointment === true,
          message: wa.message === true,
        };
        if (!cancelled) {
          setServerFlags(merged);
          // Hydratation : on n'ecrase un draft modifie qu'au premier chargement.
          setDraft((prev) => {
            const hasLocalChange = (Object.keys(prev) as WhatsAppFlag[]).some(
              (k) => prev[k] !== WA_DEFAULTS[k],
            );
            return hasLocalChange ? prev : merged;
          });
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAuth, isAuthenticated]);

  const onToggle = useCallback((key: WhatsAppFlag, value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onSave = useCallback(async () => {
    if (!isAuthenticated || saving) return;
    setSaving(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/me/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappNotifications: draft }),
      });
      if (!res || !res.ok) {
        Alert.alert("Echec", "Impossible d'enregistrer les notifications WhatsApp.");
        return;
      }
      setServerFlags(draft);
    } catch {
      Alert.alert("Echec", "Erreur reseau pendant l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }, [fetchAuth, isAuthenticated, saving, draft]);

  const rowDisabled = !loaded || !isAuthenticated || saving;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="message-circle" size={18} color="#22c55e" />
        <Text style={[styles.cardTitle, { color: colors.foreground, flex: 1 }]}>Notifications WhatsApp</Text>
        {dirty && (
          <Pressable
            onPress={onSave}
            disabled={saving}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 6,
              backgroundColor: colors.primary,
              opacity: pressed || saving ? 0.6 : 1,
            })}
          >
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
              {saving ? "..." : "Enregistrer"}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
          Recevez les alertes du bureau sur WhatsApp. Necessite un numero de telephone
          dans votre profil et un fournisseur Twilio actif cote organisation.
        </Text>
      </View>

      {WHATSAPP_ROWS.map((row, idx) => {
        const isLast = idx === WHATSAPP_ROWS.length - 1;
        const value = draft[row.key];
        return (
          <View
            key={row.key}
            style={[
              styles.toggleRow,
              {
                borderBottomColor: colors.border,
                borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                opacity: rowDisabled ? 0.5 : 1,
              },
            ]}
          >
            <Feather name={row.icon} size={16} color={colors.mutedForeground} style={styles.infoIcon} />
            <View style={styles.toggleText}>
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{row.label}</Text>
              <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
                {row.sublabel}
              </Text>
            </View>
            <Switch
              value={value}
              disabled={rowDisabled}
              onValueChange={(v) => onToggle(row.key, v)}
              trackColor={{ false: colors.border, true: "#22c55e88" }}
              thumbColor={value ? "#22c55e" : colors.mutedForeground}
            />
          </View>
        );
      })}

      {!isAuthenticated && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            Connectez-vous pour synchroniser cette preference.
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Préférences IA ─────────────────────────────────────────────────────────────

function PreferencesIaCard() {
  const colors = useColors();
  const {
    enabled,
    language,
    fields,
    loaded,
    isAuthenticated,
    setEnabled,
    setLanguage,
    setField,
  } = useInlineSuggestPreferences();

  const onToggleEnabled = useCallback((v: boolean) => setEnabled(v), [setEnabled]);
  const onSelectLanguage = useCallback((v: string) => setLanguage(v), [setLanguage]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="cpu" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Préférences IA</Text>
      </View>

      <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
        <Feather name="zap" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Suggestions IA en ligne</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            Affiche une suggestion grise pendant que vous rédigez.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggleEnabled}
          disabled={!loaded || !isAuthenticated}
          trackColor={{ false: colors.border, true: colors.primary + "88" }}
          thumbColor={enabled ? colors.primary : colors.mutedForeground}
        />
      </View>

      <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
        <Feather name="globe" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Langue des suggestions</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            Langue dans laquelle l’IA proposera la suite de votre texte.
          </Text>
        </View>
      </View>
      <View style={[styles.lockOptionsRow, { opacity: enabled && isAuthenticated ? 1 : 0.45 }]}>
        {INLINE_SUGGEST_LANGUAGES.map(opt => {
          const active = language === opt.value;
          const disabled = !enabled || !loaded || !isAuthenticated;
          return (
            <Pressable
              key={opt.value}
              onPress={() => !disabled && onSelectLanguage(opt.value)}
              disabled={disabled}
              style={[
                styles.lockOptionBtn,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary + "18" : "transparent",
                },
              ]}
            >
              <Text style={[
                styles.lockOptionText,
                { color: active ? colors.primary : colors.mutedForeground },
              ]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 }}>
        <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Champs concernés</Text>
        <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
          Activez ou désactivez les suggestions par type de champ. Le commutateur principal reste prioritaire.
        </Text>
      </View>
      {INLINE_SUGGEST_FIELD_OPTIONS.map(opt => {
        const value = fields[opt.field];
        const disabled = !enabled || !loaded || !isAuthenticated;
        return (
          <View
            key={opt.field}
            style={[styles.toggleRow, { borderBottomColor: colors.border, opacity: disabled ? 0.45 : 1 }]}
          >
            <Feather name="edit-3" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
            <View style={styles.toggleText}>
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{opt.label}</Text>
              <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>{opt.description}</Text>
            </View>
            <Switch
              value={value}
              disabled={disabled}
              onValueChange={(v) => setField(opt.field, v)}
              trackColor={{ false: colors.border, true: colors.primary + "88" }}
              thumbColor={value ? colors.primary : colors.mutedForeground}
            />
          </View>
        );
      })}

      <View style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 10 }}>
        <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
          {isAuthenticated
            ? "Cette préférence est enregistrée sur votre compte et synchronisée sur tous vos appareils."
            : "Connectez-vous pour synchroniser cette préférence sur vos appareils."}
        </Text>
      </View>
    </View>
  );
}

// ── Stiller ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  scrollContent: { padding: 16 },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  infoRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  infoIcon: { marginRight: 12 },
  infoLabel: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  infoValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
  planBadge: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 10 },
  planName: { fontSize: 15, fontFamily: "Inter_700Bold", flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  subLoading: { padding: 20 },
  noSub: { padding: 16, textAlign: "center", fontSize: 14, fontFamily: "Inter_400Regular" },
  themeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  themeBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, gap: 4 },
  themeBtnLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // Toggle rows
  toggleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  toggleSublabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  channelGroupLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },

  // Auto-lock options
  lockOptionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent" },
  lockOptionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  lockOptionText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // PIN
  pinSection: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  pinActionsRow: { flexDirection: "row", gap: 8 },
  pinActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  pinActionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  pinForm: { marginTop: 12, padding: 14, borderRadius: 10, borderWidth: 1, gap: 10 },
  pinFormTitle: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  pinInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 8 },
  pinErrText: { color: "#ef4444", fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  pinFormBtns: { flexDirection: "row", gap: 8 },
  pinFormBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  pinFormBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Kilit butonu
  lockNowBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  lockNowText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#ef4444" },
});
