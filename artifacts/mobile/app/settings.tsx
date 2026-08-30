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
import { useTranslation, LANGUAGES } from "@/lib/i18n";
import { usePrivacy } from "@/contexts/PrivacyContext";
import { useNotificationPrefs } from "@/contexts/NotificationPrefsContext";
import { disableBiometric, getBiometricCapability, isBiometricEnabled } from "@/lib/biometric";
import {
  INLINE_SUGGEST_LANGUAGES,
  useInlineSuggestPreferences,
  type InlineSuggestConfigurableField,
} from "@/hooks/useInlineSuggest";

const INLINE_SUGGEST_FIELD_OPTIONS: ReadonlyArray<{
  field: InlineSuggestConfigurableField;
  labelKey: string;
  descriptionKey: string;
}> = [
  { field: "note", labelKey: "settingsScreen.iaFieldNoteLabel", descriptionKey: "settingsScreen.iaFieldNoteDesc" },
  { field: "prospect_note", labelKey: "settingsScreen.iaFieldProspectLabel", descriptionKey: "settingsScreen.iaFieldProspectDesc" },
  { field: "email_body", labelKey: "settingsScreen.iaFieldEmailLabel", descriptionKey: "settingsScreen.iaFieldEmailDesc" },
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
  essai: "settingsScreen.planEssai",
  starter: "settingsScreen.planStarter",
  professionnel: "settingsScreen.planProfessionnel",
  entreprise: "settingsScreen.planEntreprise",
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
  const { t } = useTranslation();
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
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>{t("settingsScreen.header")}</Text>
          <View style={{ width: 22 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 40 }]} showsVerticalScrollIndicator={false}>
        {user ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="user" size={18} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("settingsScreen.profilTitle")}</Text>
            </View>
            <InfoRow icon="user" label={t("settingsScreen.name")} value={`${user.prenom} ${user.nom}`} />
            <InfoRow icon="mail" label={t("settingsScreen.email")} value={user.email} />
            <InfoRow icon="shield" label={t("settingsScreen.role")} value={user.role === "super_admin" ? t("settingsScreen.roleSuperAdmin") : user.role === "administrateur" ? t("settingsScreen.roleAdmin") : user.role === "agent" ? t("settingsScreen.roleAgent") : t("settingsScreen.roleReadOnly")} />
            {user.departement ? <InfoRow icon="briefcase" label={t("settingsScreen.department")} value={user.departement} /> : null}
            {user.organisation ? <InfoRow icon="home" label={t("settingsScreen.organisation")} value={user.organisation} /> : null}
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="credit-card" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("settingsScreen.subscriptionTitle")}</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.subLoading} />
          ) : sub ? (
            <>
              <View style={[styles.planBadge, { backgroundColor: (PLAN_COLORS[sub.plan] ?? "#64748b") + "18" }]}>
                <Feather name="star" size={16} color={PLAN_COLORS[sub.plan] ?? "#64748b"} />
                <Text style={[styles.planName, { color: PLAN_COLORS[sub.plan] ?? "#64748b" }]}>
                  {PLAN_LABELS[sub.plan] ? t(PLAN_LABELS[sub.plan]) : sub.plan}
                </Text>
                <View style={[styles.statusDot, { backgroundColor: sub.status === "active" ? "#22c55e" : "#f59e0b" }]} />
                <Text style={[styles.statusText, { color: sub.status === "active" ? "#22c55e" : "#f59e0b" }]}>
                  {sub.status === "active" ? t("settingsScreen.statusActive") : sub.status}
                </Text>
              </View>
              <InfoRow icon="users" label={t("settingsScreen.maxUsers")} value={`${sub.maxUsers}`} />
              <InfoRow icon="book" label={t("settingsScreen.maxContacts")} value={sub.maxContacts >= 999999 ? t("settingsScreen.unlimited") : `${sub.maxContacts}`} />
              <InfoRow icon="phone" label={t("settingsScreen.callsPerMonth")} value={sub.maxCallsPerMonth >= 999999 ? t("settingsScreen.unlimited") : `${sub.maxCallsPerMonth}`} />
              <InfoRow icon="tag" label={t("settingsScreen.price")} value={t("settingsScreen.priceValue", { price: sub.price, cycle: sub.billingCycle === "monthly" ? t("settingsScreen.cycleMonth") : t("settingsScreen.cycleYear") })} />
              {sub.trialEndsAt ? <InfoRow icon="clock" label={t("settingsScreen.trialEnd")} value={new Date(sub.trialEndsAt).toLocaleDateString("fr-FR")} color="#f59e0b" /> : null}
              {sub.currentPeriodEnd ? <InfoRow icon="calendar" label={t("settingsScreen.nextRenewal")} value={new Date(sub.currentPeriodEnd).toLocaleDateString("fr-FR")} /> : null}
            </>
          ) : (
            <Text style={[styles.noSub, { color: colors.mutedForeground }]}>{t("settingsScreen.noSubscription")}</Text>
          )}
        </View>

        <ThemeCard />

        <LanguageCard />

        <AlertsCard />

        <WhatsAppNotificationsCard />

        <PreferencesIaCard />

        <ClosuresCard />

        <PrivacyCard />

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="info" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("settingsScreen.appTitle")}</Text>
          </View>
          <InfoRow icon="smartphone" label={t("settingsScreen.version")} value="1.0.0" />
          <InfoRow icon="globe" label={t("settingsScreen.platform")} value={Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web"} />
          <InfoRow icon="code" label={t("settingsScreen.framework")} value="React Native / Expo" />
        </View>
      </ScrollView>
    </View>
  );
}

// ── Tema kartı ─────────────────────────────────────────────────────────────────

function ThemeCard() {
  const colors = useColors();
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const modes: { key: "system" | "light" | "dark"; icon: keyof typeof Feather.glyphMap; label: string }[] = [
    { key: "system", icon: "smartphone", label: t("settingsScreen.themeSystem") },
    { key: "light", icon: "sun", label: t("settingsScreen.themeLight") },
    { key: "dark", icon: "moon", label: t("settingsScreen.themeDark") },
  ];
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="moon" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("settingsScreen.appearance")}</Text>
      </View>
      <View style={styles.themeRow}>
        {modes.map(m => (
          <Pressable accessibilityRole="button"
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

// ── Dil kartı ──────────────────────────────────────────────────────────────────

function LanguageCard() {
  const colors = useColors();
  const { lang, i18n, t } = useTranslation();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="globe" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("common.language")}</Text>
      </View>
      <View style={styles.langRow}>
        {LANGUAGES.map(l => (
          <Pressable accessibilityRole="button"
            key={l.code}
            onPress={() => i18n.changeLanguage(l.code)}
            style={[styles.langBtn, { borderColor: lang === l.code ? colors.primary : colors.border, backgroundColor: lang === l.code ? colors.primary + "18" : "transparent" }]}
          >
            <Text style={[styles.langBtnLabel, { color: lang === l.code ? colors.primary : colors.mutedForeground }]}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ── Gizlilik kartı ─────────────────────────────────────────────────────────────

const AUTO_LOCK_OPTIONS = [
  { minutes: 0, labelKey: "settingsScreen.autoLockDisabled" },
  { minutes: 1, labelKey: "settingsScreen.autoLock1" },
  { minutes: 5, labelKey: "settingsScreen.autoLock5" },
  { minutes: 15, labelKey: "settingsScreen.autoLock15" },
  { minutes: 30, labelKey: "settingsScreen.autoLock30" },
];

function PrivacyCard() {
  const colors = useColors();
  const { t } = useTranslation();
  const {
    settings,
    updateSettings,
    setPIN,
    removePIN,
    biometricAvailable,
    biometricType,
    lock,
  } = usePrivacy();

  // Etat de la connexion biometrique (identifiants du trousseau, cf.
  // `@/lib/biometric`) — independant du verrouillage par PIN ci-dessus.
  const [loginBioCapable, setLoginBioCapable] = useState(false);
  const [loginBioEnabled, setLoginBioEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cap, enabled] = await Promise.all([
        getBiometricCapability(),
        isBiometricEnabled(),
      ]);
      if (cancelled) return;
      setLoginBioCapable(cap.available);
      setLoginBioEnabled(enabled);
    })();
    return () => { cancelled = true; };
  }, []);

  const onToggleLoginBiometric = useCallback((v: boolean) => {
    // Activation: uniquement depuis l'ecran de connexion, ou le mot de passe
    // vient d'etre saisi — on ne peut pas le reconstruire ici.
    if (v) return;
    Alert.alert(
      t("settingsScreen.disableLoginBioTitle"),
      t("settingsScreen.disableLoginBioMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settingsScreen.disable"),
          style: "destructive",
          onPress: async () => {
            await disableBiometric();
            setLoginBioEnabled(false);
          },
        },
      ],
    );
  }, []);

  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinStep, setPinStep] = useState<"enter" | "confirm">("enter");
  const [pinFirst, setPinFirst] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  const handleSetPIN = useCallback(async () => {
    if (pinStep === "enter") {
      if (pinInput.length !== 4) { setPinError(t("settingsScreen.pinLength")); return; }
      setPinFirst(pinInput);
      setPinInput("");
      setPinStep("confirm");
      setPinError("");
    } else {
      if (pinInput !== pinFirst) {
        setPinError(t("settingsScreen.pinMismatch"));
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
      t("settingsScreen.removePinTitle"),
      t("settingsScreen.removePinMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
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
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("settingsScreen.privacyTitle")}</Text>
      </View>

      {/* Arka plan örtüsü */}
      <ToggleRow
        icon="eye-off"
        label={t("settingsScreen.privacyScreen")}
        sublabel={t("settingsScreen.privacyScreenSub")}
        value={settings.privacyScreenEnabled}
        onToggle={v => updateSettings({ privacyScreenEnabled: v })}
      />

      {/* Hassas veri maskesi */}
      <ToggleRow
        icon="minus-circle"
        label={t("settingsScreen.maskData")}
        sublabel={t("settingsScreen.maskDataSub")}
        value={settings.maskSensitiveData}
        onToggle={v => updateSettings({ maskSensitiveData: v })}
      />

      {/* Biyometrik */}
      <ToggleRow
        icon="activity"
        label={biometricType ? t("settingsScreen.biometricUnlock", { type: biometricType }) : t("settingsScreen.biometricGeneric")}
        sublabel={
          !biometricAvailable && Platform.OS !== "web"
            ? t("settingsScreen.biometricUnavailable")
            : !settings.hasPIN
            ? t("settingsScreen.biometricNeedPin")
            : undefined
        }
        value={settings.biometricEnabled}
        onToggle={v => updateSettings({ biometricEnabled: v })}
        disabled={!biometricAvailable || !settings.hasPIN}
      />

      {/* Connexion biometrique (identifiants stockes dans le trousseau).
          Distinct du reglage ci-dessus, qui ne concerne que le
          deverrouillage de l'app deja connectee. Sans cette ligne il
          n'existait AUCUN moyen de revoquer les identifiants une fois
          enregistres. */}
      <ToggleRow
        icon="log-in"
        label={t("settingsScreen.loginBiometric")}
        sublabel={
          !loginBioCapable
            ? Platform.OS === "web"
              ? t("settingsScreen.loginBioUnavailableWeb")
              : t("settingsScreen.loginBioUnavailableDevice")
            : loginBioEnabled
              ? t("settingsScreen.loginBioEnabledSub")
              : t("settingsScreen.loginBioProposedSub")
        }
        value={loginBioEnabled}
        onToggle={onToggleLoginBiometric}
        disabled={!loginBioCapable || !loginBioEnabled}
      />

      {/* Otomatik kilit süresi */}
      <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
        <Feather name="clock" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t("settingsScreen.autoLockTitle")}</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            {t("settingsScreen.autoLockSub")}
          </Text>
        </View>
      </View>
      <View style={styles.lockOptionsRow}>
        {AUTO_LOCK_OPTIONS.map(opt => (
          <Pressable accessibilityRole="button"
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
              {t(opt.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* PIN Yönetimi */}
      <View style={[styles.pinSection, { borderTopColor: colors.border }]}>
        {!settings.hasPIN ? (
          <Pressable accessibilityRole="button"
            style={[styles.pinActionBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "12" }]}
            onPress={() => { setShowPinSetup(true); setPinStep("enter"); setPinInput(""); setPinError(""); }}
          >
            <Feather name="lock" size={15} color={colors.primary} />
            <Text style={[styles.pinActionText, { color: colors.primary }]}>{t("settingsScreen.definePinBtn")}</Text>
          </Pressable>
        ) : (
          <View style={styles.pinActionsRow}>
            <Pressable accessibilityRole="button"
              style={[styles.pinActionBtn, { flex: 1, borderColor: colors.border }]}
              onPress={() => { setShowPinSetup(true); setPinStep("enter"); setPinInput(""); setPinError(""); }}
            >
              <Feather name="edit-2" size={14} color={colors.mutedForeground} />
              <Text style={[styles.pinActionText, { color: colors.mutedForeground }]}>{t("settingsScreen.changePinBtn")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              style={[styles.pinActionBtn, { flex: 1, borderColor: "#ef444444", backgroundColor: "#ef444408" }]}
              onPress={handleRemovePIN}
            >
              <Feather name="trash-2" size={14} color="#ef4444" />
              <Text style={[styles.pinActionText, { color: "#ef4444" }]}>{t("settingsScreen.removePinBtn")}</Text>
            </Pressable>
          </View>
        )}

        {/* PIN kurulum formu */}
        {showPinSetup && (
          <View style={[styles.pinForm, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.pinFormTitle, { color: colors.foreground }]}>
              {pinStep === "enter" ? t("settingsScreen.newPinTitle") : t("settingsScreen.confirmPinTitle")}
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
              <Pressable accessibilityRole="button"
                style={[styles.pinFormBtn, { borderColor: colors.border }]}
                onPress={() => { setShowPinSetup(false); setPinInput(""); setPinError(""); setPinStep("enter"); }}
              >
                <Text style={[styles.pinFormBtnText, { color: colors.mutedForeground }]}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button"
                style={[styles.pinFormBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={handleSetPIN}
              >
                <Text style={[styles.pinFormBtnText, { color: colors.secondary }]}>
                  {pinStep === "enter" ? t("settingsScreen.next") : t("common.confirm")}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Manuel kilit butonu */}
      <Pressable accessibilityRole="button"
        style={[styles.lockNowBtn, { borderTopColor: colors.border }]}
        onPress={() => { lock(); router.back(); }}
      >
        <Feather name="lock" size={15} color="#ef4444" />
        <Text style={[styles.lockNowText]}>{t("settingsScreen.lockNow")}</Text>
      </Pressable>
    </View>
  );
}

// ── Alertes (haptiques + notifications locales) ───────────────────────────────

const ALERT_CHANNEL_ROWS: ReadonlyArray<{
  key: "message" | "task" | "call" | "rappel" | "security";
  icon: keyof typeof Feather.glyphMap;
  labelKey: string;
  sublabelKey: string;
}> = [
  {
    key: "message",
    icon: "mail",
    labelKey: "settingsScreen.chanMessageLabel",
    sublabelKey: "settingsScreen.chanMessageSub",
  },
  {
    key: "task",
    icon: "check-square",
    labelKey: "settingsScreen.chanTaskLabel",
    sublabelKey: "settingsScreen.chanTaskSub",
  },
  {
    key: "call",
    icon: "phone-missed",
    labelKey: "settingsScreen.chanCallLabel",
    sublabelKey: "settingsScreen.chanCallSub",
  },
  {
    // Tâche #98 : mute des rappels calendrier. Le compteur de la tuile
    // Rappels continue d'incrémenter, seules vibration + notif système
    // sont coupées.
    key: "rappel",
    icon: "bell",
    labelKey: "settingsScreen.chanRappelLabel",
    sublabelKey: "settingsScreen.chanRappelSub",
  },
  {
    // Tâche #146 : mute des alertes de menace documentaire. La suggestion
    // de menace reste visible dans l'app ; seules vibration + notif système
    // sont coupées. Actif par défaut (les menaces sont urgentes).
    key: "security",
    icon: "shield",
    labelKey: "settingsScreen.chanSecurityLabel",
    sublabelKey: "settingsScreen.chanSecuritySub",
  },
];

function AlertsCard() {
  const colors = useColors();
  const { t } = useTranslation();
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
          t("settingsScreen.notifsDeniedTitle"),
          isWeb
            ? t("settingsScreen.notifsDeniedWeb")
            : t("settingsScreen.notifsDeniedNative"),
        );
      }
    },
    [setNotificationsEnabled, isWeb],
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="bell" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("settingsScreen.alertsTitle")}</Text>
      </View>

      <View style={[styles.toggleRow, { borderBottomColor: colors.border, opacity: isWeb ? 0.45 : 1 }]}>
        <Feather name="smartphone" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t("settingsScreen.vibration")}</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            {t("settingsScreen.vibrationSub")}
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
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t("settingsScreen.sysNotifs")}</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            {t("settingsScreen.sysNotifsSub")}
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
        {t("settingsScreen.byAlertType")}
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
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t(row.labelKey)}</Text>
              <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
                {t(row.sublabelKey)}
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
  labelKey: string;
  sublabelKey: string;
}> = [
  { key: "task", icon: "check-square", labelKey: "settingsScreen.waTaskLabel", sublabelKey: "settingsScreen.waTaskSub" },
  { key: "call", icon: "phone-incoming", labelKey: "settingsScreen.waCallLabel", sublabelKey: "settingsScreen.waCallSub" },
  { key: "appointment", icon: "calendar", labelKey: "settingsScreen.waAppointmentLabel", sublabelKey: "settingsScreen.waAppointmentSub" },
  { key: "message", icon: "message-circle", labelKey: "settingsScreen.waMessageLabel", sublabelKey: "settingsScreen.waMessageSub" },
];

const WA_DEFAULTS: Record<WhatsAppFlag, boolean> = {
  task: false,
  call: false,
  appointment: false,
  message: false,
};

function WhatsAppNotificationsCard() {
  const colors = useColors();
  const { t } = useTranslation();
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
        Alert.alert(t("settingsScreen.waSaveErrorTitle"), t("settingsScreen.waSaveError"));
        return;
      }
      setServerFlags(draft);
    } catch {
      Alert.alert(t("settingsScreen.waSaveErrorTitle"), t("settingsScreen.waNetworkError"));
    } finally {
      setSaving(false);
    }
  }, [fetchAuth, isAuthenticated, saving, draft]);

  const rowDisabled = !loaded || !isAuthenticated || saving;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="message-circle" size={18} color="#22c55e" />
        <Text style={[styles.cardTitle, { color: colors.foreground, flex: 1 }]}>{t("settingsScreen.whatsappTitle")}</Text>
        {dirty && (
          <Pressable accessibilityRole="button"
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
              {saving ? "..." : t("common.save")}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
          {t("settingsScreen.whatsappIntro")}
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
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t(row.labelKey)}</Text>
              <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
                {t(row.sublabelKey)}
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
            {t("settingsScreen.waLoginToSync")}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Préférences IA ─────────────────────────────────────────────────────────────

function PreferencesIaCard() {
  const colors = useColors();
  const { t } = useTranslation();
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
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("settingsScreen.iaTitle")}</Text>
      </View>

      <View style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
        <Feather name="zap" size={16} color={colors.mutedForeground} style={styles.infoIcon} />
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t("settingsScreen.iaInlineSuggest")}</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            {t("settingsScreen.iaInlineSuggestSub")}
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
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t("settingsScreen.iaSuggestLang")}</Text>
          <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
            {t("settingsScreen.iaSuggestLangSub")}
          </Text>
        </View>
      </View>
      <View style={[styles.lockOptionsRow, { opacity: enabled && isAuthenticated ? 1 : 0.45 }]}>
        {INLINE_SUGGEST_LANGUAGES.map(opt => {
          const active = language === opt.value;
          const disabled = !enabled || !loaded || !isAuthenticated;
          return (
            <Pressable accessibilityRole="button"
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
        <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t("settingsScreen.iaFieldsTitle")}</Text>
        <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
          {t("settingsScreen.iaFieldsSub")}
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
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{t(opt.labelKey)}</Text>
              <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>{t(opt.descriptionKey)}</Text>
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
            ? t("settingsScreen.iaSyncedAuth")
            : t("settingsScreen.iaSyncedGuest")}
        </Text>
      </View>
    </View>
  );
}

// ── Fermetures exceptionnelles ─────────────────────────────────────────────────

interface OrgClosure {
  id: number;
  organisationId: number;
  dateStart: string;
  dateEnd: string;
  label: string | null;
  createdAt: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime());
}

function formatClosureDate(start: string, end: string): string {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  };
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function ClosuresCard() {
  const colors = useColors();
  const { t } = useTranslation();
  const { fetchAuth, user } = useAuth();

  const isAdmin =
    user?.role === "administrateur" || user?.role === "super_admin";

  const [closures, setClosures] = useState<OrgClosure[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");

  const loadClosures = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/org-closures`);
      if (res && res.ok) {
        const data = await res.json();
        setClosures(Array.isArray(data) ? data : []);
      }
    } catch {
      // silent
    } finally {
      setLoadingList(false);
    }
  }, [fetchAuth]);

  useEffect(() => {
    loadClosures();
  }, [loadClosures]);

  const handleAdd = useCallback(async () => {
    const start = dateStart.trim();
    const end = dateEnd.trim() || start;

    if (!isValidDate(start)) {
      setFormError(t("settingsScreen.closureDateStartInvalid"));
      return;
    }
    if (!isValidDate(end)) {
      setFormError(t("settingsScreen.closureDateEndInvalid"));
      return;
    }
    if (end < start) {
      setFormError(t("settingsScreen.closureDateOrder"));
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const res = await fetchAuth(`${API_BASE}/api/org-closures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateStart: start, dateEnd: end, label: label.trim() || undefined }),
      });
      if (!res || !res.ok) {
        const body = await res?.json().catch(() => ({}));
        setFormError((body as any)?.error ?? t("settingsScreen.closureAddError"));
        return;
      }
      const row: OrgClosure = await res.json();
      setClosures(prev => [...prev, row].sort((a, b) => a.dateStart.localeCompare(b.dateStart)));
      setDateStart("");
      setDateEnd("");
      setLabel("");
      setShowForm(false);
    } catch {
      setFormError(t("settingsScreen.closureNetworkError"));
    } finally {
      setSaving(false);
    }
  }, [fetchAuth, dateStart, dateEnd, label]);

  const handleDelete = useCallback((id: number) => {
    Alert.alert(
      t("settingsScreen.deleteClosureTitle"),
      t("settingsScreen.deleteClosureMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            setDeletingId(id);
            try {
              const res = await fetchAuth(`${API_BASE}/api/org-closures/${id}`, { method: "DELETE" });
              if (res && res.ok) {
                setClosures(prev => prev.filter(c => c.id !== id));
              } else {
                Alert.alert(t("settingsScreen.errorTitle"), t("settingsScreen.deleteClosureError"));
              }
            } catch {
              Alert.alert(t("settingsScreen.errorTitle"), t("settingsScreen.closureNetworkError"));
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }, [fetchAuth]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="x-circle" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground, flex: 1 }]}>
          {t("settingsScreen.closuresTitle")}
        </Text>
        {isAdmin && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.add")}
            accessibilityState={{ expanded: showForm }}
            onPress={() => { setShowForm(v => !v); setFormError(""); }}
            hitSlop={8}
            style={({ pressed }) => ({
              padding: 4,
              borderRadius: 6,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name={showForm ? "minus" : "plus"} size={20} color={colors.primary} />
          </Pressable>
        )}
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <Text style={[styles.toggleSublabel, { color: colors.mutedForeground }]}>
          {t("settingsScreen.closuresIntro")}
        </Text>
      </View>

      {loadingList ? (
        <ActivityIndicator color={colors.primary} style={{ padding: 16 }} />
      ) : closures.length === 0 ? (
        <Text style={[styles.noSub, { color: colors.mutedForeground }]}>
          {t("settingsScreen.closuresEmpty")}
        </Text>
      ) : (
        <View>
          {closures.map((c, idx) => {
            const isLast = idx === closures.length - 1;
            const isDeleting = deletingId === c.id;
            return (
              <View
                key={c.id}
                style={[
                  styles.closureRow,
                  {
                    borderBottomColor: colors.border,
                    borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                    opacity: isDeleting ? 0.4 : 1,
                  },
                ]}
              >
                <View style={styles.closureInfo}>
                  <View style={[styles.closureDateBadge, { backgroundColor: colors.primary + "18" }]}>
                    <Feather name="calendar" size={12} color={colors.primary} />
                    <Text style={[styles.closureDateText, { color: colors.primary }]}>
                      {formatClosureDate(c.dateStart, c.dateEnd)}
                    </Text>
                  </View>
                  {c.label ? (
                    <Text style={[styles.closureLabel, { color: colors.foreground }]} numberOfLines={1}>
                      {c.label}
                    </Text>
                  ) : null}
                </View>
                {isAdmin && (
                  isDeleting ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <Pressable accessibilityRole="button" accessibilityLabel={t("common.delete")}
                      onPress={() => handleDelete(c.id)}
                      hitSlop={10}
                      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
                    >
                      <Feather name="trash-2" size={16} color="#ef4444" />
                    </Pressable>
                  )
                )}
              </View>
            );
          })}
        </View>
      )}

      {isAdmin && showForm && (
        <View style={[styles.closureForm, { backgroundColor: colors.muted, borderTopColor: colors.border }]}>
          <Text style={[styles.closureFormTitle, { color: colors.foreground }]}>
            {t("settingsScreen.newClosure")}
          </Text>

          <View style={styles.closureFormRow}>
            <View style={styles.closureFormField}>
              <Text style={[styles.closureFormLabel, { color: colors.mutedForeground }]}>
                {t("settingsScreen.dateStart")}
              </Text>
              <TextInput
                style={[styles.closureFormInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                value={dateStart}
                onChangeText={v => { setDateStart(v); setFormError(""); }}
                placeholder={t("settingsScreen.datePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={10}
              />
            </View>
            <View style={styles.closureFormField}>
              <Text style={[styles.closureFormLabel, { color: colors.mutedForeground }]}>
                {t("settingsScreen.dateEnd")}
              </Text>
              <TextInput
                style={[styles.closureFormInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
                value={dateEnd}
                onChangeText={v => { setDateEnd(v); setFormError(""); }}
                placeholder={t("settingsScreen.datePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={10}
              />
            </View>
          </View>

          <View style={styles.closureFormFieldFull}>
            <Text style={[styles.closureFormLabel, { color: colors.mutedForeground }]}>
              {t("settingsScreen.closureLabel")}
            </Text>
            <TextInput
              style={[styles.closureFormInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              value={label}
              onChangeText={v => setLabel(v)}
              placeholder={t("settingsScreen.closureLabelPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              maxLength={200}
            />
          </View>

          {formError ? (
            <Text style={styles.closureFormError}>{formError}</Text>
          ) : null}

          <View style={styles.closureFormBtns}>
            <Pressable accessibilityRole="button"
              onPress={() => { setShowForm(false); setDateStart(""); setDateEnd(""); setLabel(""); setFormError(""); }}
              style={[styles.closureFormBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.closureFormBtnText, { color: colors.mutedForeground }]}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              onPress={handleAdd}
              disabled={saving}
              style={({ pressed }) => [
                styles.closureFormBtn,
                { backgroundColor: colors.primary, borderColor: colors.primary, opacity: pressed || saving ? 0.6 : 1 },
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.closureFormBtnText, { color: "#fff" }]}>{t("common.add")}</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
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
  langRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  langBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5 },
  langBtnLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

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

  // Closures
  closureRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  closureInfo: { flex: 1, gap: 2 },
  closureDateBadge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  closureDateText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  closureLabel: { fontSize: 13, fontFamily: "Inter_400Regular", paddingLeft: 2 },
  closureForm: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  closureFormTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  closureFormRow: { flexDirection: "row", gap: 10 },
  closureFormField: { flex: 1, gap: 4 },
  closureFormFieldFull: { gap: 4 },
  closureFormLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  closureFormInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, fontFamily: "Inter_400Regular" },
  closureFormError: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#ef4444" },
  closureFormBtns: { flexDirection: "row", gap: 8 },
  closureFormBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  closureFormBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
