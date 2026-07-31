import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";
import { useTranslation,type TFunction } from "@/i18n";
import {
Bell,
BellOff,
Brain,
Clock,
Inbox,
Lightbulb,
ListChecks,
Loader2,
PenLine,
Phone,
RefreshCw,
ThumbsDown,
ThumbsUp,
TrendingDown,
TrendingUp,
User,Users,
XCircle,
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const LEARNING_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/ai-learning";

interface Preference {
  kind: string;
  key: string;
  upCount: number;
  downCount: number;
  score: number;
  updatedAt: string;
  suppressed?: boolean;
  suppressionOverridden?: boolean;
}
interface Pattern {
  patternType: string;
  label: string;
  value: string;
  occurrences: number;
  lastSeenAt: string | null;
}
interface Correction {
  title: string;
  category: string;
  note: string | null;
  decidedAt: string | null;
}
interface Profile {
  preferences: Preference[];
  patterns: Pattern[];
  corrections: Correction[];
}
interface UserFact {
  factType: string;
  label: string;
  value: string;
  occurrences: number;
  lastSeenAt: string | null;
}
interface UserProfile {
  userId: number;
  computedAt: string | null;
  facts: UserFact[];
}
interface LearnableUser {
  id: number;
  nom: string;
  prenom: string;
  role: string;
  factCount: number;
}

const SUGGESTION_KEYS = new Set(["overdue_task", "missed_call_followup", "calendar_conflict"]);
const CATEGORY_KEYS = new Set(["calls", "tasks", "finance", "contacts", "projets", "prospects", "general"]);
const PROPOSAL_CATEGORY_KEYS = new Set(["tache", "email", "sms", "rappel", "relance", "contact", "autre"]);
const ROLE_KEYS = new Set(["super_admin", "administrateur", "agent", "lecture_seule"]);

function prefLabel(p: Preference, t: TFunction): string {
  if (p.kind === "suggestion_type") return SUGGESTION_KEYS.has(p.key) ? t(`iaApprentissage.suggestionLabels.${p.key}`) : p.key;
  return CATEGORY_KEYS.has(p.key) ? t(`iaApprentissage.categoryLabels.${p.key}`) : p.key;
}

// "il y a 2 h", "il y a 5 min", "à l'instant"… à partir d'une date ISO.
function relativeTime(iso: string | null, t: TFunction): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return t("iaApprentissage.time.now");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("iaApprentissage.time.minAgo", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("iaApprentissage.time.hAgo", { n: h });
  const j = Math.floor(h / 24);
  if (j < 30) return t("iaApprentissage.time.dAgo", { n: j });
  const mois = Math.floor(j / 30);
  return t("iaApprentissage.time.moAgo", { n: mois });
}

const MANAGER_ROLES = new Set(["super_admin", "administrateur"]);

// Regroupe les faits personnels par catégorie pour l'affichage.
function groupUserFacts(facts: UserFact[]) {
  const byType = (t: string) => facts.filter((f) => f.factType === t);
  return {
    hours: byType("busy_hour"),
    focus: byType("work_focus"),
    themes: byType("task_theme"),
    contacts: byType("frequent_contact"),
    writingStyle: facts.find((f) => f.factType === "writing_style") ?? null,
  };
}

export default function IaApprentissagePage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<Profile>({ preferences: [], patterns: [], corrections: [] });
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [reactivating, setReactivating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${LEARNING_API}/profile`, { credentials: "include" });
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setProfile({ preferences: data.preferences ?? [], patterns: data.patterns ?? [], corrections: data.corrections ?? [] });
    } catch {
      toast({ title: t("iaApprentissage.toast.error"), description: t("iaApprentissage.toast.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => { void load(); }, [load]);

  const recompute = async () => {
    setRecomputing(true);
    try {
      const res = await fetch(`${LEARNING_API}/recompute`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        toast({ title: t("iaApprentissage.toast.wait"), description: data.error ?? t("iaApprentissage.toast.retrySoon") });
      } else if (res.status === 403) {
        toast({ title: t("iaApprentissage.toast.accessDenied"), description: t("iaApprentissage.toast.adminOnly"), variant: "destructive" });
      } else if (!res.ok) {
        throw new Error("recompute");
      } else {
        setProfile({ preferences: data.profile?.preferences ?? [], patterns: data.profile?.patterns ?? [], corrections: data.profile?.corrections ?? [] });
        toast({ title: t("iaApprentissage.toast.memoryUpdated"), description: t("iaApprentissage.toast.memoryUpdatedDesc") });
      }
    } catch {
      toast({ title: t("iaApprentissage.toast.error"), description: t("iaApprentissage.toast.recomputeFailed"), variant: "destructive" });
    } finally {
      setRecomputing(false);
    }
  };

  const reactivate = async (type: string) => {
    setReactivating(type);
    try {
      const res = await fetch(`${LEARNING_API}/reactivate-suggestion-type`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        toast({ title: t("iaApprentissage.toast.accessDenied"), description: t("iaApprentissage.toast.managerOnly"), variant: "destructive" });
      } else if (!res.ok) {
        throw new Error("reactivate");
      } else {
        setProfile({
          preferences: data.profile?.preferences ?? [],
          patterns: data.profile?.patterns ?? [],
          corrections: data.profile?.corrections ?? [],
        });
        toast({ title: t("iaApprentissage.toast.suggestionsReactivated"), description: t("iaApprentissage.toast.suggestionsReactivatedDesc") });
      }
    } catch {
      toast({ title: t("iaApprentissage.toast.error"), description: t("iaApprentissage.toast.reactivateFailed"), variant: "destructive" });
    } finally {
      setReactivating(null);
    }
  };

  // --- Profil PERSONNEL (par employé) -------------------------------------
  const { user } = useWorkspaceUser();
  const isManager = MANAGER_ROLES.has(user.role);
  const [selectedUserId, setSelectedUserId] = useState<number>(user.id);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [userRecomputing, setUserRecomputing] = useState(false);
  const [team, setTeam] = useState<LearnableUser[]>([]);

  const loadUserProfile = useCallback(async (uid: number) => {
    setUserLoading(true);
    try {
      const res = await fetch(`${LEARNING_API}/user-profile?userId=${uid}`, { credentials: "include" });
      if (!res.ok) throw new Error("user-profile");
      const data = await res.json();
      setUserProfile({ userId: data.userId ?? uid, computedAt: data.computedAt ?? null, facts: data.facts ?? [] });
    } catch {
      setUserProfile({ userId: uid, computedAt: null, facts: [] });
      toast({ title: t("iaApprentissage.toast.error"), description: t("iaApprentissage.toast.profileLoadError"), variant: "destructive" });
    } finally {
      setUserLoading(false);
    }
  }, [toast, t]);

  useEffect(() => { void loadUserProfile(selectedUserId); }, [selectedUserId, loadUserProfile]);

  const recomputeUser = async () => {
    setUserRecomputing(true);
    try {
      const res = await fetch(`${LEARNING_API}/recompute-user`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        toast({ title: t("iaApprentissage.toast.wait"), description: data.error ?? t("iaApprentissage.toast.retrySoon") });
      } else if (res.status === 403) {
        toast({ title: t("iaApprentissage.toast.accessDenied"), description: data.error ?? t("iaApprentissage.toast.notAuthorized"), variant: "destructive" });
      } else if (!res.ok) {
        throw new Error("recompute-user");
      } else {
        setUserProfile({ userId: data.profile?.userId ?? selectedUserId, computedAt: data.profile?.computedAt ?? null, facts: data.profile?.facts ?? [] });
        toast({
          title: t("iaApprentissage.toast.profileUpdated"),
          description: viewingSelf
            ? t("iaApprentissage.toast.profileUpdatedSelf")
            : t("iaApprentissage.toast.profileUpdatedOther"),
        });
      }
    } catch {
      toast({ title: t("iaApprentissage.toast.error"), description: t("iaApprentissage.toast.profileRecomputeFailed"), variant: "destructive" });
    } finally {
      setUserRecomputing(false);
    }
  };

  useEffect(() => {
    if (!isManager) return;
    void (async () => {
      try {
        const res = await fetch(`${LEARNING_API}/users`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        setTeam(data.users ?? []);
      } catch { /* fail-soft: pas de sélecteur d'équipe */ }
    })();
  }, [isManager]);

  const ug = groupUserFacts(userProfile?.facts ?? []);
  const userEmpty = !userLoading && (userProfile?.facts.length ?? 0) === 0;
  const viewingSelf = selectedUserId === user.id;

  const liked = profile.preferences.filter((p) => p.score >= 0.34 && p.upCount + p.downCount >= 1);
  // Types actuellement mis en sourdine (le moteur n'en produit plus) — affichés
  // à part avec une action « Réafficher ». On les exclut de la liste « moins
  // appréciées » pour éviter le doublon.
  const muted = profile.preferences.filter((p) => p.suppressed);
  const disliked = profile.preferences.filter(
    (p) => p.score <= -0.34 && p.upCount + p.downCount >= 1 && !p.suppressed,
  );
  const callers = profile.patterns.filter((p) => p.patternType === "frequent_caller");
  const hours = profile.patterns.filter((p) => p.patternType === "busy_hour");
  const themes = profile.patterns.filter((p) => p.patternType === "task_theme");

  const corrections = profile.corrections ?? [];
  const isEmpty =
    !loading && profile.preferences.length === 0 && profile.patterns.length === 0 && corrections.length === 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-violet-500" />
            {t("iaApprentissage.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("iaApprentissage.subtitle")}
          </p>
        </div>
        <Button onClick={recompute} disabled={recomputing}>
          {recomputing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {t("iaApprentissage.reanalyze")}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Inbox className="h-12 w-12 text-muted-foreground/40" />
            <CardTitle className="text-lg">{t("iaApprentissage.emptyTitle")}</CardTitle>
            <CardDescription className="max-w-md">
              {t("iaApprentissage.emptyDesc")}
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-emerald-600" /> {t("iaApprentissage.learnedPrefs")}
              </CardTitle>
              <CardDescription>{t("iaApprentissage.learnedPrefsDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {liked.length === 0 && disliked.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("iaApprentissage.notEnoughFeedback")}</p>
              )}
              {liked.map((p) => (
                <div key={`up-${p.kind}-${p.key}`} className="flex items-center justify-between gap-2">
                  <span className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" /> {prefLabel(p, t)}
                  </span>
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    {p.upCount} 👍
                  </Badge>
                </div>
              ))}
              {disliked.map((p) => (
                <div key={`down-${p.kind}-${p.key}`} className="flex items-center justify-between gap-2">
                  <span className="text-sm flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-red-600 shrink-0" /> {prefLabel(p, t)}
                  </span>
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                    {p.downCount} 👎
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" /> {t("iaApprentissage.detectedHabits")}
              </CardTitle>
              <CardDescription>{t("iaApprentissage.detectedHabitsDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {callers.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Phone className="h-3.5 w-3.5" /> {t("iaApprentissage.frequentCallers")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {callers.slice(0, 6).map((c) => (
                      <Badge key={c.value} variant="outline">{c.label} · {c.occurrences}×</Badge>
                    ))}
                  </div>
                </div>
              )}
              {hours.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Clock className="h-3.5 w-3.5" /> {t("iaApprentissage.busiestCallHours")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {hours.map((h) => (
                      <Badge key={h.value} variant="outline">{h.label}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {themes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <ListChecks className="h-3.5 w-3.5" /> {t("iaApprentissage.recurringTaskThemes")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {themes.map((th) => (
                      <Badge key={th.value} variant="outline">{th.label} · {th.occurrences}×</Badge>
                    ))}
                  </div>
                </div>
              )}
              {callers.length === 0 && hours.length === 0 && themes.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("iaApprentissage.noHabits")}</p>
              )}
            </CardContent>
          </Card>

          {muted.length > 0 && (
            <Card className="md:col-span-2 border-amber-200 dark:border-amber-900/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BellOff className="h-4 w-4 text-amber-600" /> {t("iaApprentissage.mutedTitle")}
                </CardTitle>
                <CardDescription>
                  {t("iaApprentissage.mutedDescBase")}
                  {isManager
                    ? t("iaApprentissage.mutedDescManager")
                    : t("iaApprentissage.mutedDescUser")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {muted.map((p) => (
                  <div
                    key={`muted-${p.kind}-${p.key}`}
                    className="flex items-center justify-between gap-3 border-b last:border-0 pb-3 last:pb-0"
                  >
                    <span className="text-sm flex items-center gap-2 min-w-0">
                      <BellOff className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="truncate">{prefLabel(p, t)}</span>
                      <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 shrink-0">
                        {p.downCount} 👎
                      </Badge>
                    </span>
                    {isManager && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => reactivate(p.key)}
                        disabled={reactivating === p.key}
                      >
                        {reactivating === p.key ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Bell className="h-4 w-4 mr-2" />
                        )}
                        {t("iaApprentissage.reshow")}
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {corrections.length > 0 && (
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" /> {t("iaApprentissage.recentCorrections")}
                </CardTitle>
                <CardDescription>
                  {t("iaApprentissage.recentCorrectionsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {corrections.map((c, i) => (
                  <div key={`corr-${i}`} className="flex items-start justify-between gap-3 border-b last:border-0 pb-3 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate flex items-center gap-2">
                        <ThumbsDown className="h-3.5 w-3.5 text-red-600 shrink-0" /> {c.title}
                      </p>
                      {c.note && (
                        <p className="text-xs text-muted-foreground mt-1">« {c.note} »</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline">{PROPOSAL_CATEGORY_KEYS.has(c.category) ? t(`iaApprentissage.proposalCategoryLabels.${c.category}`) : c.category}</Badge>
                      {c.decidedAt && (
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(c.decidedAt).toLocaleDateString("fr-FR")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* --- Profil PERSONNEL (par employé) --- */}
      <div className="pt-2">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <User className="h-5 w-5 text-violet-500" />
              {viewingSelf ? t("iaApprentissage.yourPersonalProfile") : t("iaApprentissage.employeeProfile")}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              {isManager
                ? t("iaApprentissage.personalProfileDescManager")
                : t("iaApprentissage.personalProfileDescUser")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Button variant="outline" size="sm" onClick={recomputeUser} disabled={userRecomputing || userLoading}>
              {userRecomputing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {viewingSelf ? t("iaApprentissage.recomputeMyProfile") : t("iaApprentissage.recomputeThisProfile")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {userRecomputing
                ? t("iaApprentissage.analyzing")
                : relativeTime(userProfile?.computedAt ?? null, t)
                  ? t("iaApprentissage.lastAnalysis", { time: relativeTime(userProfile?.computedAt ?? null, t) ?? "" })
                  : t("iaApprentissage.neverAnalyzed")}
            </span>
          </div>
        </div>

        {isManager && team.length > 0 && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" /> {t("iaApprentissage.chooseEmployee")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {team.map((m) => (
                  <Button
                    key={m.id}
                    size="sm"
                    variant={m.id === selectedUserId ? "default" : "outline"}
                    onClick={() => setSelectedUserId(m.id)}
                  >
                    {m.prenom} {m.nom}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {ROLE_KEYS.has(m.role) ? t(`iaApprentissage.roleLabels.${m.role}`) : m.role}
                    </Badge>
                    {m.factCount > 0 && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">· {m.factCount}</span>
                    )}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {userLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
        ) : userEmpty ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Inbox className="h-10 w-10 text-muted-foreground/40" />
              <CardTitle className="text-base">
                {viewingSelf ? t("iaApprentissage.nothingSelf") : t("iaApprentissage.nothingEmployee")}
              </CardTitle>
              <CardDescription className="max-w-md">
                {t("iaApprentissage.personalEmptyDesc")}
              </CardDescription>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {ug.writingStyle && (
              <Card className="md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PenLine className="h-4 w-4 text-violet-500" /> {t("iaApprentissage.writingStyle")}
                  </CardTitle>
                  <CardDescription>{t("iaApprentissage.writingStyleDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{ug.writingStyle.label}</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-500" /> {t("iaApprentissage.hoursAndDomains")}
                </CardTitle>
                <CardDescription>{t("iaApprentissage.hoursAndDomainsDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {ug.hours.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                      <Clock className="h-3.5 w-3.5" /> {t("iaApprentissage.activityHours")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ug.hours.map((h) => <Badge key={h.value} variant="outline">{h.label}</Badge>)}
                    </div>
                  </div>
                )}
                {ug.focus.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                      <ListChecks className="h-3.5 w-3.5" /> {t("iaApprentissage.workDomains")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ug.focus.map((f) => <Badge key={f.value} variant="outline">{f.label} · {f.occurrences}×</Badge>)}
                    </div>
                  </div>
                )}
                {ug.hours.length === 0 && ug.focus.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("iaApprentissage.noData")}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" /> {t("iaApprentissage.themesAndContacts")}
                </CardTitle>
                <CardDescription>{t("iaApprentissage.themesAndContactsDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {ug.themes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                      <ListChecks className="h-3.5 w-3.5" /> {t("iaApprentissage.taskThemes")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ug.themes.map((th) => <Badge key={th.value} variant="outline">{th.label} · {th.occurrences}×</Badge>)}
                    </div>
                  </div>
                )}
                {ug.contacts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                      <Phone className="h-3.5 w-3.5" /> {t("iaApprentissage.recurringContacts")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ug.contacts.map((c) => <Badge key={c.value} variant="outline">{c.label} · {c.occurrences}×</Badge>)}
                    </div>
                  </div>
                )}
                {ug.themes.length === 0 && ug.contacts.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("iaApprentissage.noData")}</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
