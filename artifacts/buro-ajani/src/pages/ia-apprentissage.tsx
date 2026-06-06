import { useState, useEffect, useCallback } from "react";
import {
  Brain, RefreshCw, Loader2, ThumbsUp, ThumbsDown, Phone, Clock,
  ListChecks, Lightbulb, Inbox, TrendingUp, TrendingDown, XCircle,
  User, Users, PenLine,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceUser } from "@/components/workspace-user";

const LEARNING_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/ai-learning";

interface Preference {
  kind: string;
  key: string;
  upCount: number;
  downCount: number;
  score: number;
  updatedAt: string;
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
  facts: UserFact[];
}
interface LearnableUser {
  id: number;
  nom: string;
  prenom: string;
  role: string;
  factCount: number;
}

const SUGGESTION_LABELS: Record<string, string> = {
  overdue_task: "Tâches en retard",
  missed_call_followup: "Rappels d'appels manqués",
  calendar_conflict: "Conflits d'agenda",
};
const CATEGORY_LABELS: Record<string, string> = {
  calls: "Appels", tasks: "Tâches", finance: "Finance", contacts: "Contacts",
  projets: "Projets", prospects: "Prospects", general: "Général",
};
const PROPOSAL_CATEGORY_LABELS: Record<string, string> = {
  tache: "Tâche", email: "E-mail", sms: "SMS", rappel: "Rappel",
  relance: "Relance", contact: "Contact", autre: "Divers",
};

function prefLabel(p: Preference): string {
  if (p.kind === "suggestion_type") return SUGGESTION_LABELS[p.key] ?? p.key;
  return CATEGORY_LABELS[p.key] ?? p.key;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Dirigeant", administrateur: "Administrateur",
  agent: "Agent", lecture_seule: "Lecture seule",
};
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
  const [profile, setProfile] = useState<Profile>({ preferences: [], patterns: [], corrections: [] });
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${LEARNING_API}/profile`, { credentials: "include" });
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setProfile({ preferences: data.preferences ?? [], patterns: data.patterns ?? [], corrections: data.corrections ?? [] });
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger ce que l'IA a appris.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const recompute = async () => {
    setRecomputing(true);
    try {
      const res = await fetch(`${LEARNING_API}/recompute`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        toast({ title: "Patientez", description: data.error ?? "Réessayez dans un instant." });
      } else if (res.status === 403) {
        toast({ title: "Accès refusé", description: "Réservé aux administrateurs.", variant: "destructive" });
      } else if (!res.ok) {
        throw new Error("recompute");
      } else {
        setProfile({ preferences: data.profile?.preferences ?? [], patterns: data.profile?.patterns ?? [], corrections: data.profile?.corrections ?? [] });
        toast({ title: "Mémoire mise à jour", description: "L'IA a réanalysé vos préférences et habitudes." });
      }
    } catch {
      toast({ title: "Erreur", description: "Le recalcul a échoué.", variant: "destructive" });
    } finally {
      setRecomputing(false);
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
      setUserProfile({ userId: data.userId ?? uid, facts: data.facts ?? [] });
    } catch {
      setUserProfile({ userId: uid, facts: [] });
      toast({ title: "Erreur", description: "Impossible de charger ce profil personnel.", variant: "destructive" });
    } finally {
      setUserLoading(false);
    }
  }, [toast]);

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
        toast({ title: "Patientez", description: data.error ?? "Réessayez dans un instant." });
      } else if (res.status === 403) {
        toast({ title: "Accès refusé", description: data.error ?? "Action non autorisée.", variant: "destructive" });
      } else if (!res.ok) {
        throw new Error("recompute-user");
      } else {
        setUserProfile({ userId: data.profile?.userId ?? selectedUserId, facts: data.profile?.facts ?? [] });
        toast({
          title: "Profil mis à jour",
          description: viewingSelf
            ? "L'IA a réanalysé votre activité."
            : "L'IA a réanalysé l'activité de cet employé.",
        });
      }
    } catch {
      toast({ title: "Erreur", description: "Le recalcul du profil a échoué.", variant: "destructive" });
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
  const disliked = profile.preferences.filter((p) => p.score <= -0.34 && p.upCount + p.downCount >= 1);
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
            Ce que l'IA a appris
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            À partir de vos retours (👍/👎) et de vos habitudes, l'assistant adapte ses réponses à votre organisation.
          </p>
        </div>
        <Button onClick={recompute} disabled={recomputing}>
          {recomputing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Réanalyser
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Inbox className="h-12 w-12 text-muted-foreground/40" />
            <CardTitle className="text-lg">L'IA n'a encore rien appris</CardTitle>
            <CardDescription className="max-w-md">
              Notez les suggestions de l'assistant proactif (👍/👎) et votez sur les analyses : l'IA mémorisera vos
              préférences et habitudes pour personnaliser ses réponses.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-emerald-600" /> Préférences apprises
              </CardTitle>
              <CardDescription>Ce que vous appréciez ou souhaitez éviter.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {liked.length === 0 && disliked.length === 0 && (
                <p className="text-sm text-muted-foreground">Pas encore assez de retours pour dégager une préférence.</p>
              )}
              {liked.map((p) => (
                <div key={`up-${p.kind}-${p.key}`} className="flex items-center justify-between gap-2">
                  <span className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" /> {prefLabel(p)}
                  </span>
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    {p.upCount} 👍
                  </Badge>
                </div>
              ))}
              {disliked.map((p) => (
                <div key={`down-${p.kind}-${p.key}`} className="flex items-center justify-between gap-2">
                  <span className="text-sm flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-red-600 shrink-0" /> {prefLabel(p)}
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
                <Lightbulb className="h-4 w-4 text-amber-500" /> Habitudes détectées
              </CardTitle>
              <CardDescription>Motifs récurrents repérés dans votre activité.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {callers.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Phone className="h-3.5 w-3.5" /> Interlocuteurs fréquents
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
                    <Clock className="h-3.5 w-3.5" /> Heures d'appels les plus chargées
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
                    <ListChecks className="h-3.5 w-3.5" /> Thèmes de tâches récurrents
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {themes.map((t) => (
                      <Badge key={t.value} variant="outline">{t.label} · {t.occurrences}×</Badge>
                    ))}
                  </div>
                </div>
              )}
              {callers.length === 0 && hours.length === 0 && themes.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucune habitude récurrente détectée pour l'instant.</p>
              )}
            </CardContent>
          </Card>

          {corrections.length > 0 && (
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" /> Corrections récentes
                </CardTitle>
                <CardDescription>
                  Propositions que vous avez refusées. L'IA en tient compte pour ne plus les reproduire.
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
                      <Badge variant="outline">{PROPOSAL_CATEGORY_LABELS[c.category] ?? c.category}</Badge>
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
              {viewingSelf ? "Votre profil personnel" : "Profil de l'employé"}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              {isManager
                ? "Ce que l'IA a appris de chaque employé : horaires, domaines, thèmes, interlocuteurs et style d'écriture."
                : "Ce que l'IA a appris de votre activité pour personnaliser ses suggestions et le ton de ses réponses."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={recomputeUser} disabled={userRecomputing || userLoading}>
            {userRecomputing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {viewingSelf ? "Recalculer mon profil" : "Recalculer ce profil"}
          </Button>
        </div>

        {isManager && team.length > 0 && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" /> Choisir un employé
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
                      {ROLE_LABELS[m.role] ?? m.role}
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
                {viewingSelf ? "Rien appris sur vous pour l'instant" : "Rien appris sur cet employé pour l'instant"}
              </CardTitle>
              <CardDescription className="max-w-md">
                L'IA apprend automatiquement à partir de l'activité (appels, tâches, messages). Le profil
                se remplira au fil de l'usage.
              </CardDescription>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {ug.writingStyle && (
              <Card className="md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PenLine className="h-4 w-4 text-violet-500" /> Style d'écriture
                  </CardTitle>
                  <CardDescription>L'IA reproduit ce registre dans les rédactions proposées.</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{ug.writingStyle.label}</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-500" /> Heures &amp; domaines
                </CardTitle>
                <CardDescription>Quand et sur quoi cette personne travaille.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {ug.hours.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                      <Clock className="h-3.5 w-3.5" /> Heures d'activité
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ug.hours.map((h) => <Badge key={h.value} variant="outline">{h.label}</Badge>)}
                    </div>
                  </div>
                )}
                {ug.focus.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                      <ListChecks className="h-3.5 w-3.5" /> Domaines de travail
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ug.focus.map((f) => <Badge key={f.value} variant="outline">{f.label} · {f.occurrences}×</Badge>)}
                    </div>
                  </div>
                )}
                {ug.hours.length === 0 && ug.focus.length === 0 && (
                  <p className="text-sm text-muted-foreground">Pas encore de données.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" /> Thèmes &amp; contacts
                </CardTitle>
                <CardDescription>Sujets récurrents et interlocuteurs habituels.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {ug.themes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                      <ListChecks className="h-3.5 w-3.5" /> Thèmes de tâches
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ug.themes.map((t) => <Badge key={t.value} variant="outline">{t.label} · {t.occurrences}×</Badge>)}
                    </div>
                  </div>
                )}
                {ug.contacts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                      <Phone className="h-3.5 w-3.5" /> Interlocuteurs récurrents
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ug.contacts.map((c) => <Badge key={c.value} variant="outline">{c.label} · {c.occurrences}×</Badge>)}
                    </div>
                  </div>
                )}
                {ug.themes.length === 0 && ug.contacts.length === 0 && (
                  <p className="text-sm text-muted-foreground">Pas encore de données.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
