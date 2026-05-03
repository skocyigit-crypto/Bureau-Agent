import { useState, useEffect, useCallback } from "react";
import { Users, UserPlus, Mail, Loader2, Trash2, RefreshCw, Crown, Shield, Eye, User, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceUser } from "@/components/workspace-user";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const ROLE_CONFIG: Record<string, { label: string; icon: typeof User; className: string }> = {
  super_admin: { label: "Super Admin", icon: Crown, className: "bg-purple-100 text-purple-700 border-0" },
  administrateur: { label: "Admin", icon: Shield, className: "bg-blue-100 text-blue-700 border-0" },
  agent: { label: "Agent", icon: User, className: "bg-slate-100 text-slate-600 border-0" },
  lecture_seule: { label: "Lecture seule", icon: Eye, className: "bg-amber-100 text-amber-700 border-0" },
};

const INV_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "En attente", className: "bg-amber-100 text-amber-700 border-0" },
  accepted: { label: "Acceptée", className: "bg-emerald-100 text-emerald-700 border-0" },
  expired: { label: "Expirée", className: "bg-red-100 text-red-700 border-0" },
  cancelled: { label: "Annulée", className: "bg-slate-100 text-slate-600 border-0" },
};

interface TeamMember {
  id: number;
  email: string;
  nom: string;
  prenom: string;
  role: string;
  actif: boolean;
  dernierAcces: string | null;
}

interface Invitation {
  id: number;
  email: string;
  role: string;
  status: string;
  expired: boolean;
  expiresAt: string;
  createdAt: string;
}

export function TabEquipe() {
  const { user } = useWorkspaceUser();
  const { toast } = useToast();
  const isAdmin = user?.role === "super_admin" || user?.role === "administrateur";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("agent");
  const [inviting, setInviting] = useState(false);
  const [resending, setResending] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, invitationsRes] = await Promise.all([
        fetch(`${BASE}/api/auth/users`, { credentials: "include" }),
        fetch(`${BASE}/api/invitations`, { credentials: "include" }),
      ]);
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.users || []);
      }
      if (invitationsRes.ok) {
        const data = await invitationsRes.json();
        setInvitations((data.invitations || []).filter((i: Invitation) => i.status === "pending" && !i.expired));
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger l'equipe.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch(`${BASE}/api/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Invitation envoyee", description: `Un email a ete envoye a ${inviteEmail}.` });
        setInviteEmail("");
        load();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible d'envoyer l'invitation.", variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const handleResend = async (id: number) => {
    setResending(id);
    try {
      const res = await fetch(`${BASE}/api/invitations/${id}/resend`, { method: "POST", credentials: "include" });
      if (res.ok) {
        toast({ title: "Email renvoyé", description: "L'invitation a ete renvoyee." });
        load();
      } else {
        const d = await res.json();
        toast({ title: "Erreur", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de renvoyer l'invitation.", variant: "destructive" });
    } finally {
      setResending(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      const res = await fetch(`${BASE}/api/invitations/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: "Invitation annulee" });
        load();
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible d'annuler l'invitation.", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="w-4 h-4 text-primary" />
              Inviter un membre
            </CardTitle>
            <CardDescription>Un email d'invitation sera envoyé avec un lien d'accès sécurisé (valide 72h).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="inviteEmail" className="text-xs">Adresse email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="inviteEmail"
                    type="email"
                    placeholder="colleague@exemple.fr"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    className="pl-9"
                    required
                  />
                </div>
              </div>
              <div className="w-full sm:w-44 space-y-1">
                <Label className="text-xs">Rôle</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="administrateur">Admin</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="lecture_seule">Lecture seule</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={inviting} className="w-full sm:w-auto">
                  {inviting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                  Inviter
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-amber-500" />
              Invitations en attente
              <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">{invitations.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {invitations.map(inv => (
                <div key={inv.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Expire le {new Date(inv.expiresAt).toLocaleDateString("fr-FR")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={ROLE_CONFIG[inv.role]?.className || "bg-slate-100 text-slate-600 border-0"}>
                      {ROLE_CONFIG[inv.role]?.label || inv.role}
                    </Badge>
                    {isAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          disabled={resending === inv.id}
                          onClick={() => handleResend(inv.id)}
                          title="Renvoyer"
                        >
                          {resending === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                          disabled={deleting === inv.id}
                          onClick={() => handleDelete(inv.id)}
                          title="Annuler"
                        >
                          {deleting === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4 text-primary" />
              Membres de l'équipe
              <Badge variant="secondary" className="text-xs">{members.length}</Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={load} className="text-xs text-muted-foreground">
              <RefreshCw className="w-3 h-3 mr-1" />
              Actualiser
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {members.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Users className="w-10 h-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Aucun membre trouvé.</p>
            </div>
          ) : (
            <div className="divide-y">
              {members.map(m => {
                const rc = ROLE_CONFIG[m.role] || ROLE_CONFIG.agent;
                const RoleIcon = rc.icon;
                return (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                        {(m.prenom?.[0] || "").toUpperCase()}{(m.nom?.[0] || "").toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{m.prenom} {m.nom}</p>
                          {!m.actif && <Badge className="bg-red-100 text-red-700 border-0 text-[10px]">Inactif</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {m.dernierAcces && (
                        <p className="text-[10px] text-muted-foreground hidden md:block">
                          {new Date(m.dernierAcces).toLocaleDateString("fr-FR")}
                        </p>
                      )}
                      <Badge className={rc.className}>
                        <RoleIcon className="w-3 h-3 mr-1" />
                        {rc.label}
                      </Badge>
                      <div className={`w-2 h-2 rounded-full ${m.actif ? "bg-emerald-500" : "bg-slate-300"}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
