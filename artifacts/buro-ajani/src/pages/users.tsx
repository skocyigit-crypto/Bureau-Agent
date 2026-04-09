import { useState, useEffect, useCallback } from "react";
import {
  Users, UserPlus, Crown, ShieldCheck, Eye, Trash2, MoreHorizontal,
  Mail, Clock, CheckCircle2, XCircle, AlertTriangle, Search,
  Lock, Unlock, Edit, UserCog, Phone,
  Loader2, ShieldAlert, RefreshCw, Send, LockKeyhole
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon3D } from "@/components/icon-3d";
import officeTeamImg from "@/assets/images/office-team.png";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { useWorkspaceUser } from "@/components/workspace-user";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";

type UserRole = "super_admin" | "administrateur" | "agent" | "lecture_seule";

interface ApiUser {
  id: number;
  email: string;
  nom: string;
  prenom: string;
  role: UserRole;
  departement: string | null;
  organisation: string | null;
  organisationId: number | null;
  actif: boolean;
  mfaActif: boolean;
  dernierAcces: string | null;
  createdAt: string;
}

const BASE = import.meta.env.BASE_URL || "/";

const ROLE_CONFIG: Record<UserRole, { label: string; couleur: string; icon: React.ElementType }> = {
  super_admin: { label: "Super Admin", couleur: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: Crown },
  administrateur: { label: "Administrateur", couleur: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: ShieldCheck },
  agent: { label: "Agent", couleur: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: Phone },
  lecture_seule: { label: "Lecture seule", couleur: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400", icon: Eye },
};

export default function UsersPage() {
  const { user: workspaceUser, hasPermission } = useWorkspaceUser();
  const canManageUsers = hasPermission("gererUtilisateurs");
  const { toast } = useToast();

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("tous");
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [showRoleChange, setShowRoleChange] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ApiUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [maxUsers, setMaxUsers] = useState(5);

  const [newUser, setNewUser] = useState({ prenom: "", nom: "", email: "", password: "", role: "agent" as UserRole, departement: "" });
  const [editRole, setEditRole] = useState<UserRole>("agent");

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}api/auth/users`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les utilisateurs.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSubscription = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}api/subscription/usage`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMaxUsers(data.users?.max || 5);
      }
    } catch {}
  }, []);

  useEffect(() => { loadUsers(); loadSubscription(); }, [loadUsers, loadSubscription]);

  if (!canManageUsers) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold">Acces restreint</h2>
        <p className="text-muted-foreground max-w-md">
          Vous n'avez pas les permissions necessaires pour gerer les utilisateurs. Contactez votre administrateur pour obtenir l'acces.
        </p>
      </div>
    );
  }

  const activeUsers = users.filter(u => u.actif).length;
  const siegesRestants = maxUsers - activeUsers;

  const filteredUsers = users
    .filter(u => roleFilter === "tous" || u.role === roleFilter)
    .filter(u => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return u.prenom.toLowerCase().includes(q) || u.nom.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.departement || "").toLowerCase().includes(q);
    });

  const handleAddUser = async () => {
    if (!newUser.prenom || !newUser.nom || !newUser.email || !newUser.password) {
      toast({ title: "Erreur", description: "Tous les champs sont obligatoires (prenom, nom, email, mot de passe).", variant: "destructive" });
      return;
    }
    if (newUser.password.length < 8) {
      toast({ title: "Erreur", description: "Le mot de passe doit contenir au moins 8 caracteres.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/auth/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Utilisateur cree", description: `${newUser.prenom} ${newUser.nom} a ete ajoute avec succes.` });
        setNewUser({ prenom: "", nom: "", email: "", password: "", role: "agent", departement: "" });
        setShowAddUser(false);
        loadUsers();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la creation.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (user: ApiUser) => {
    if (user.role === "super_admin" && user.actif) {
      toast({ title: "Action interdite", description: "Le Super Administrateur ne peut pas etre desactive.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/auth/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ actif: !user.actif }),
      });
      if (res.ok) {
        toast({ title: user.actif ? "Utilisateur desactive" : "Utilisateur reactive", description: `${user.prenom} ${user.nom} a ete ${user.actif ? "desactive" : "reactive"}.` });
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la modification.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/auth/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: editRole }),
      });
      if (res.ok) {
        toast({ title: "Role mis a jour", description: `${selectedUser.prenom} ${selectedUser.nom} est maintenant ${ROLE_CONFIG[editRole].label}.` });
        setShowRoleChange(false);
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors du changement de role.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSendCredentials = async (user: ApiUser) => {
    if (!confirm(`Generer un nouveau mot de passe et l'envoyer par email a ${user.prenom} ${user.nom} (${user.email}) ?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/auth/users/${user.id}/send-credentials`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Identifiants envoyes", description: data.message || `Mot de passe envoye a ${user.email}.` });
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de l'envoi des identifiants.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAndSend = async () => {
    if (!newUser.prenom || !newUser.nom || !newUser.email) {
      toast({ title: "Erreur", description: "Prenom, nom et email sont obligatoires.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/auth/users/create-and-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: newUser.email,
          nom: newUser.nom,
          prenom: newUser.prenom,
          role: newUser.role,
          departement: newUser.departement,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Utilisateur cree",
          description: `${newUser.prenom} ${newUser.nom} a ete cree. ${data.emailSent ? "Identifiants envoyes par email." : data.emailNote}`,
        });
        setNewUser({ prenom: "", nom: "", email: "", password: "", role: "agent", departement: "" });
        setShowAddUser(false);
        loadUsers();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la creation.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: ApiUser) => {
    if (user.role === "super_admin") {
      toast({ title: "Action interdite", description: "Le Super Administrateur ne peut pas etre supprime.", variant: "destructive" });
      return;
    }
    if (!confirm(`Supprimer ${user.prenom} ${user.nom} ? Cette action est irreversible.`)) return;
    try {
      const res = await fetch(`${BASE}api/auth/users/${user.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "Utilisateur supprime", description: `${user.prenom} ${user.nom} a ete supprime.` });
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la suppression.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Users} variant="teal" size="md" /> Gestion des utilisateurs</h1>
          <p className="text-sm text-muted-foreground">Gerez votre equipe et les permissions d'acces.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setLoading(true); loadUsers(); }}>
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Actualiser</span>
          </Button>
          <Button size="sm" className="gap-2" onClick={() => siegesRestants > 0 ? setShowAddUser(true) : toast({ title: "Limite atteinte", description: "Nombre maximum d'utilisateurs atteint. Mettez a jour votre plan dans les parametres.", variant: "destructive" })}>
            <UserPlus className="w-4 h-4" />
            Ajouter
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={officeTeamImg} alt="Equipe du bureau" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-teal-900/80 via-teal-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">Gestion de l'equipe</h3>
              <p className="text-white/80 text-sm mt-1">Permissions granulaires et suivi des activites.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Utilisateurs</p>
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{activeUsers} <span className="text-sm font-normal text-muted-foreground">/ {maxUsers}</span></p>
            <Progress value={(activeUsers / maxUsers) * 100} className="mt-2 h-1.5" />
            <p className="text-[10px] text-muted-foreground mt-1">{siegesRestants} place(s) disponible(s)</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Actifs</p>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold">{activeUsers}</p>
            <p className="text-xs text-muted-foreground mt-1">Comptes actifs</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Desactives</p>
              <XCircle className="w-4 h-4 text-red-400" />
            </div>
            <p className="text-2xl font-bold">{users.filter(u => !u.actif).length}</p>
            <p className="text-xs text-muted-foreground mt-1">Comptes desactives</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Admins</p>
              <ShieldCheck className="w-4 h-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold">{users.filter(u => u.role === "super_admin" || u.role === "administrateur").length}</p>
            <p className="text-xs text-muted-foreground mt-1">Administrateurs</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un utilisateur..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Tous les roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">Tous les roles</SelectItem>
            <SelectItem value="super_admin">Super Admin</SelectItem>
            <SelectItem value="administrateur">Administrateur</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="lecture_seule">Lecture seule</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {searchQuery || roleFilter !== "tous" ? "Aucun utilisateur correspond aux criteres." : "Aucun utilisateur. Ajoutez votre premier membre."}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="hidden lg:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Departement</TableHead>
                    <TableHead>Dernier acces</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const roleConf = ROLE_CONFIG[user.role];
                    const RoleIcon = roleConf.icon;
                    return (
                      <TableRow key={user.id} className={!user.actif ? "opacity-50" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0">
                              {user.prenom?.[0]}{user.nom?.[0]}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{user.prenom} {user.nom}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={roleConf.couleur + " border-0 text-[10px] gap-1"}>
                            <RoleIcon className="w-3 h-3" />
                            {roleConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={user.actif ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-[10px]"}>
                            {user.actif ? "Actif" : "Desactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{user.departement || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {user.dernierAcces ? new Date(user.dernierAcces).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Jamais"}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="w-8 h-8">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                                setSelectedUser(user);
                                setEditRole(user.role);
                                setShowRoleChange(true);
                              }}>
                                <UserCog className="w-4 h-4" />
                                Changer le role
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2 cursor-pointer text-blue-600" onClick={() => handleSendCredentials(user)}>
                                <LockKeyhole className="w-4 h-4" />
                                Envoyer mot de passe
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {user.role !== "super_admin" && (
                                <>
                                  <DropdownMenuItem className={`gap-2 cursor-pointer ${user.actif ? "text-amber-600" : "text-emerald-600"}`} onClick={() => handleToggleActive(user)}>
                                    {user.actif ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                    {user.actif ? "Desactiver" : "Reactiver"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="gap-2 cursor-pointer text-red-600" onClick={() => handleDelete(user)}>
                                    <Trash2 className="w-4 h-4" />
                                    Supprimer
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="lg:hidden space-y-3">
            {filteredUsers.map((user) => {
              const roleConf = ROLE_CONFIG[user.role];
              const RoleIcon = roleConf.icon;
              return (
                <Card key={user.id} className={!user.actif ? "opacity-50" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium shrink-0">
                          {user.prenom?.[0]}{user.nom?.[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{user.prenom} {user.nom}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                            setSelectedUser(user);
                            setEditRole(user.role);
                            setShowRoleChange(true);
                          }}>
                            <UserCog className="w-4 h-4" />
                            Changer le role
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2 cursor-pointer text-blue-600" onClick={() => handleSendCredentials(user)}>
                            <LockKeyhole className="w-4 h-4" />
                            Envoyer mot de passe
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {user.role !== "super_admin" && (
                            <>
                              <DropdownMenuItem className={`gap-2 cursor-pointer ${user.actif ? "text-amber-600" : "text-emerald-600"}`} onClick={() => handleToggleActive(user)}>
                                {user.actif ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                {user.actif ? "Desactiver" : "Reactiver"}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2 cursor-pointer text-red-600" onClick={() => handleDelete(user)}>
                                <Trash2 className="w-4 h-4" />
                                Supprimer
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Badge className={roleConf.couleur + " border-0 text-[10px] gap-1"}>
                        <RoleIcon className="w-3 h-3" />
                        {roleConf.label}
                      </Badge>
                      <Badge className={user.actif ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-[10px]"}>
                        {user.actif ? "Actif" : "Desactive"}
                      </Badge>
                      {user.departement && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{user.departement}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {user.dernierAcces ? new Date(user.dernierAcces).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Jamais connecte"}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {user.mfaActif ? (
                          <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> MFA</>
                        ) : (
                          <><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Pas de MFA</>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {siegesRestants <= 2 && siegesRestants > 0 && (
        <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/10">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Il ne reste que {siegesRestants} place(s) disponible(s) sur votre plan
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Mettez a jour votre abonnement dans les parametres pour ajouter plus d'utilisateurs.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <AiSuggestionsCard page="utilisateurs" title="Recommandations IA - Equipe" compact />

      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Ajouter un utilisateur
            </DialogTitle>
            <DialogDescription>
              Creez un nouveau compte utilisateur pour votre equipe.
              {siegesRestants > 0 && (
                <span className="block mt-1 text-emerald-600">
                  {siegesRestants} place(s) disponible(s) sur votre plan.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prenom *</Label>
                <Input placeholder="Prenom" value={newUser.prenom} onChange={(e) => setNewUser({ ...newUser, prenom: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Nom *</Label>
                <Input placeholder="Nom" value={newUser.nom} onChange={(e) => setNewUser({ ...newUser, nom: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Adresse e-mail *</Label>
              <Input type="email" placeholder="utilisateur@entreprise.fr" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Mot de passe (min 8 caracteres)</Label>
              <Input type="password" placeholder="Laisser vide pour generer automatiquement" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">Laissez vide pour generer un mot de passe securise automatiquement et l'envoyer par email.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as UserRole })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="administrateur">Administrateur</SelectItem>
                    <SelectItem value="lecture_seule">Lecture seule</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Departement</Label>
                <Input placeholder="ex: Commercial" value={newUser.departement} onChange={(e) => setNewUser({ ...newUser, departement: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowAddUser(false)}>Annuler</Button>
            {!newUser.password && (
              <Button variant="secondary" onClick={handleCreateAndSend} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Creer et envoyer par email
              </Button>
            )}
            <Button onClick={handleAddUser} disabled={saving || !newUser.password} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Creer l'utilisateur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRoleChange} onOpenChange={setShowRoleChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              Changer le role
            </DialogTitle>
            <DialogDescription>
              {selectedUser && `${selectedUser.prenom} ${selectedUser.nom} — role actuel : ${ROLE_CONFIG[selectedUser.role].label}`}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Nouveau role</Label>
            <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="super_admin">Super Admin</SelectItem>
                <SelectItem value="administrateur">Administrateur</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="lecture_seule">Lecture seule</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRoleChange(false)}>Annuler</Button>
            <Button onClick={handleRoleChange} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
