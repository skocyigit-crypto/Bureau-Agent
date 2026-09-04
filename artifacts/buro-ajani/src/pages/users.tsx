import officeTeamImg from "@/assets/images/office-team.webp";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { Icon3D } from "@/components/icon-3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import {
Dialog,DialogContent,
DialogDescription,DialogFooter,
DialogHeader,DialogTitle
} from "@/components/ui/dialog";
import {
DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import {
Table,TableBody,TableCell,TableHead,TableHeader,TableRow
} from "@/components/ui/table";
import { useWorkspaceUser } from "@/components/workspace-user";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
AlertTriangle,
Ban,
CheckCircle2,
CheckSquare,
Clock,
Crown,
Download,
Edit,
Eye,
Loader2,
Lock,
LockKeyhole,
Mail,
MailPlus,
MoreHorizontal,
Phone,
Printer,
RefreshCw,
RotateCcw,
Search,
Send,
ShieldAlert,
ShieldCheck,
Square,
Trash2,
Unlock,
UserCog,
UserPlus,
Users,
X,
XCircle
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";

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
  const { user: workspaceUser, hasPermission, isSuperAdmin } = useWorkspaceUser();
  const canManageUsers = hasPermission("gererUtilisateurs");
  const { toast } = useToast();
  const { t } = useTranslation();
  const roleLabel = (r: UserRole) => t(`users.roles.${r}`);

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("tous");
  const [showAddUser, setShowAddUser] = useState(false);
  const [showRoleChange, setShowRoleChange] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ApiUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [maxUsers, setMaxUsers] = useState(5);

  const [newUser, setNewUser] = useState({ prenom: "", nom: "", email: "", password: "", role: "agent" as UserRole, departement: "" });
  const [editRole, setEditRole] = useState<UserRole>("agent");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("agent");
  const [invitations, setInvitations] = useState<any[]>([]);
  const [, setLoadingInvites] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [editUserForm, setEditUserForm] = useState({ prenom: "", nom: "", departement: "", telephone: "" });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}api/auth/users`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.loadUsersError"), variant: "destructive" });
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
    } catch (err) {
      console.error("[Users] loadSubscription failed:", err);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    setLoadingInvites(true);
    try {
      const res = await fetch(`${BASE}api/invitations`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setInvitations(data.invitations || []);
      } else {
        toast({ title: t("users.toast.error"), description: t("users.toast.loadInvitesError"), variant: "destructive" });
      }
    } catch { toast({ title: t("users.toast.error"), description: t("users.toast.networkInvitesError"), variant: "destructive" }); }
    finally { setLoadingInvites(false); }
  }, []);

  useEffect(() => { loadUsers(); loadSubscription(); loadInvitations(); }, [loadUsers, loadSubscription, loadInvitations]);

  const handleSendInvite = async () => {
    if (!inviteEmail) {
      toast({ title: t("users.toast.error"), description: t("users.toast.inviteEmailRequired"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: t("users.toast.inviteSent"),
          description: data.emailSent ? t("users.toast.inviteSentDesc", { email: inviteEmail }) : data.message,
        });
        setInviteEmail("");
        setInviteRole("agent");
        setShowInvite(false);
        loadInvitations();
      } else {
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.sendError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleResendInvite = async (id: number) => {
    try {
      const res = await fetch(`${BASE}api/invitations/${id}/resend`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("users.toast.reminderSent"), description: t("users.toast.reminderSentDesc") });
        loadInvitations();
      } else {
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.resendError"), variant: "destructive" });
    }
  };

  const handleCancelInvite = async (id: number) => {
    try {
      const res = await fetch(`${BASE}api/invitations/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: t("users.toast.inviteCancelled") });
        loadInvitations();
      } else {
        toast({ title: t("users.toast.error"), description: t("users.toast.cancelInviteError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.cancelError"), variant: "destructive" });
    }
  };

  const pendingInvitations = invitations.filter(i => i.status === "pending" && !i.expired);

  if (!canManageUsers) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold">{t("users.accessDenied.title")}</h2>
        <p className="text-muted-foreground max-w-md">
          {t("users.accessDenied.desc")}
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
      toast({ title: t("users.toast.error"), description: t("users.toast.allFieldsRequired"), variant: "destructive" });
      return;
    }
    if (newUser.password.length < 8) {
      toast({ title: t("users.toast.error"), description: t("users.toast.passwordMin"), variant: "destructive" });
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
        toast({ title: t("users.toast.userCreated"), description: t("users.toast.userCreatedDesc", { prenom: newUser.prenom, nom: newUser.nom }) });
        setNewUser({ prenom: "", nom: "", email: "", password: "", role: "agent", departement: "" });
        setShowAddUser(false);
        loadUsers();
      } else {
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.createError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (user: ApiUser) => {
    if (user.role === "super_admin" && user.actif) {
      toast({ title: t("users.toast.actionForbidden"), description: t("users.toast.superAdminNoDeactivate"), variant: "destructive" });
      return;
    }
    if (user.actif) {
      if (!(await confirmAction({ title: t("users.toast.confirmDeactivateTitle", { name: `${user.prenom} ${user.nom}` }), description: t("users.toast.confirmDeactivateDesc"), confirmLabel: t("users.toast.confirmDeactivateLabel"), destructive: true }))) return;
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
        toast({ title: user.actif ? t("users.toast.userDeactivated") : t("users.toast.userReactivated"), description: user.actif ? t("users.toast.userDeactivatedDesc", { name: `${user.prenom} ${user.nom}` }) : t("users.toast.userReactivatedDesc", { name: `${user.prenom} ${user.nom}` }) });
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.modifyError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/auth/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editUserForm),
      });
      if (res.ok) {
        toast({ title: t("users.toast.userModified"), description: t("users.toast.userModifiedDesc", { prenom: editUserForm.prenom, nom: editUserForm.nom }) });
        setShowEditUser(false);
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.modifyUserError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async () => {
    if (!selectedUser) return;
    if (editRole === "super_admin" && selectedUser.role !== "super_admin") {
      if (!(await confirmAction({ title: t("users.toast.promoteTitle"), description: t("users.toast.promoteDesc", { name: `${selectedUser.prenom} ${selectedUser.nom}` }), confirmLabel: t("users.toast.promoteLabel"), destructive: true }))) return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/auth/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: editRole }),
      });
      if (res.ok) {
        toast({ title: t("users.toast.roleUpdated"), description: t("users.toast.roleUpdatedDesc", { name: `${selectedUser.prenom} ${selectedUser.nom}`, role: roleLabel(editRole) }) });
        setShowRoleChange(false);
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.roleChangeError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSendCredentials = async (user: ApiUser) => {
    if (!(await confirmAction({ title: t("users.toast.sendCodeTitle"), description: t("users.toast.sendCodeDesc", { name: `${user.prenom} ${user.nom}`, email: user.email }), confirmLabel: t("users.toast.sendCodeLabel") }))) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/auth/users/${user.id}/send-credentials`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("users.toast.tempCodeSent"), description: data.message || t("users.toast.tempCodeSentDesc", { email: user.email }) });
      } else {
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.sendCredsError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAndSend = async () => {
    if (!newUser.prenom || !newUser.nom || !newUser.email) {
      toast({ title: t("users.toast.error"), description: t("users.toast.firstLastEmailRequired"), variant: "destructive" });
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
          title: t("users.toast.userCreated"),
          description: `${t("users.toast.userCreatedName", { prenom: newUser.prenom, nom: newUser.nom })} ${data.emailSent ? t("users.toast.credsSentByEmail") : data.emailNote}`,
        });
        setNewUser({ prenom: "", nom: "", email: "", password: "", role: "agent", departement: "" });
        setShowAddUser(false);
        loadUsers();
      } else {
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.createError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: ApiUser) => {
    if (user.role === "super_admin") {
      toast({ title: t("users.toast.actionForbidden"), description: t("users.toast.superAdminNoDelete"), variant: "destructive" });
      return;
    }
    if (!(await confirmAction({ title: t("users.toast.confirmDeleteTitle", { name: `${user.prenom} ${user.nom}` }), description: t("users.toast.confirmDeleteDesc"), confirmLabel: t("common.delete"), destructive: true }))) return;
    try {
      const res = await fetch(`${BASE}api/auth/users/${user.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: t("users.toast.userDeleted"), description: t("users.toast.userDeletedDesc", { name: `${user.prenom} ${user.nom}` }) });
        loadUsers();
      } else {
        const data = await res.json();
        toast({ title: t("users.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.toast.error"), description: t("users.toast.deleteError"), variant: "destructive" });
    }
  };

  const toggleSelectMode = () => { setSelectMode(v => !v); setSelectedIds(new Set()); };
  const toggleId = (id: number) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    const eligible = filteredUsers.filter(u => u.role !== "super_admin" && u.id !== workspaceUser?.id);
    if (selectedIds.size === eligible.length) { setSelectedIds(new Set()); }
    else { setSelectedIds(new Set(eligible.map(u => u.id))); }
  };

  const handleBulkDeactivate = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirmAction({ title: t("users.toast.confirmBulkDeactivate", { count: selectedIds.size }), confirmLabel: t("users.toast.confirmDeactivateLabel"), destructive: true }))) return;
    const ids = Array.from(selectedIds);
    const res = await fetch(`${BASE}api/auth/users/bulk/deactivate`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
    if (res.ok) {
      toast({ title: t("users.toast.bulkDeactivated", { count: selectedIds.size }) });
      setSelectedIds(new Set()); setSelectMode(false); loadUsers();
    } else {
      const d = await res.json();
      toast({ title: t("users.toast.error"), description: d.error, variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirmAction({ title: t("users.toast.confirmBulkDelete", { count: selectedIds.size }), description: t("users.toast.confirmDeleteDesc"), confirmLabel: t("common.delete"), destructive: true }))) return;
    const ids = Array.from(selectedIds);
    const res = await fetch(`${BASE}api/auth/users/bulk/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
    if (res.ok) {
      toast({ title: t("users.toast.bulkDeleted", { count: selectedIds.size }) });
      setSelectedIds(new Set()); setSelectMode(false); loadUsers();
    } else {
      const d = await res.json();
      toast({ title: t("users.toast.error"), description: d.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Users} variant="teal" size="md" /> {t("users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("users.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectMode && selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 text-amber-600 border-amber-300" onClick={handleBulkDeactivate}>
                <Lock className="w-3.5 h-3.5" /> {t("users.bulkDeactivate", { count: selectedIds.size })}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-300" onClick={handleBulkDelete}>
                <Trash2 className="w-3.5 h-3.5" /> {t("users.bulkDelete", { count: selectedIds.size })}
              </Button>
            </>
          )}
          <Button variant={selectMode ? "default" : "outline"} size="sm" className="gap-2" onClick={toggleSelectMode}>
            {selectMode ? <><X className="w-4 h-4" /> {t("common.cancel")}</> : <><CheckSquare className="w-4 h-4" /> {t("users.select")}</>}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setLoading(true); loadUsers(); }}>
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">{t("users.refresh")}</span>
          </Button>
          <a href={`${BASE}api/auth/users/export/csv`} download="utilisateurs.csv">
            <Button variant="outline" size="sm" title={t("users.exportCsvTitle")}><Download className="w-4 h-4" /></Button>
          </a>
          <Button variant="outline" size="sm" title={t("users.printTitle")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" className="gap-2 border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30" onClick={() => siegesRestants > 0 ? setShowInvite(true) : toast({ title: t("users.limitReached"), description: t("users.limitReachedDesc"), variant: "destructive" })}>
            <MailPlus className="w-4 h-4" />
            {t("users.inviteByEmail")}
          </Button>
          <Button size="sm" className="gap-2" onClick={() => siegesRestants > 0 ? setShowAddUser(true) : toast({ title: t("users.limitReached"), description: t("users.limitReachedDescPlan"), variant: "destructive" })}>
            <UserPlus className="w-4 h-4" />
            {t("users.add")}
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={officeTeamImg} alt={t("users.bannerImgAlt")} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-teal-900/80 via-teal-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">{t("users.bannerTitle")}</h3>
              <p className="text-white/80 text-sm mt-1">{t("users.bannerSubtitle")}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{t("users.stats.users")}</p>
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{activeUsers} <span className="text-sm font-normal text-muted-foreground">/ {maxUsers}</span></p>
            <Progress value={(activeUsers / maxUsers) * 100} className="mt-2 h-1.5" />
            <p className="text-[10px] text-muted-foreground mt-1">{t("users.stats.seatsAvailable", { count: siegesRestants })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{t("users.stats.active")}</p>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold">{activeUsers}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("users.stats.activeAccounts")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{t("users.stats.deactivated")}</p>
              <XCircle className="w-4 h-4 text-red-400" />
            </div>
            <p className="text-2xl font-bold">{users.filter(u => !u.actif).length}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("users.stats.deactivatedAccounts")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{t("users.stats.admins")}</p>
              <ShieldCheck className="w-4 h-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold">{users.filter(u => u.role === "super_admin" || u.role === "administrateur").length}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("users.stats.administrators")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label={t("users.searchPlaceholder")}
            placeholder={t("users.searchPlaceholder")}
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder={t("users.allRoles")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">{t("users.allRoles")}</SelectItem>
            <SelectItem value="super_admin">{t("users.roles.super_admin")}</SelectItem>
            <SelectItem value="administrateur">{t("users.roles.administrateur")}</SelectItem>
            <SelectItem value="agent">{t("users.roles.agent")}</SelectItem>
            <SelectItem value="lecture_seule">{t("users.roles.lecture_seule")}</SelectItem>
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
            {searchQuery || roleFilter !== "tous" ? t("users.emptyFiltered") : t("users.emptyNone")}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="hidden lg:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {selectMode && (
                      <TableHead className="w-10">
                        <button onClick={toggleAll} className="flex items-center" aria-label={t("common.selectAll")}>
                          {selectedIds.size === filteredUsers.filter(u => u.role !== "super_admin" && u.id !== workspaceUser?.id).length && selectedIds.size > 0
                            ? <CheckSquare className="w-4 h-4 text-primary" aria-hidden="true" />
                            : <Square className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
                        </button>
                      </TableHead>
                    )}
                    <TableHead>{t("users.columns.user")}</TableHead>
                    <TableHead>{t("users.columns.role")}</TableHead>
                    <TableHead>{t("users.columns.status")}</TableHead>
                    <TableHead>{t("users.columns.department")}</TableHead>
                    <TableHead>{t("users.columns.lastAccess")}</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const roleConf = ROLE_CONFIG[user.role];
                    const RoleIcon = roleConf.icon;
                    const isSelectable = user.role !== "super_admin" && user.id !== workspaceUser?.id;
                    const isSelected = selectedIds.has(user.id);
                    return (
                      <TableRow key={user.id} className={`${!user.actif ? "opacity-50" : ""} ${selectMode && isSelected ? "bg-primary/5" : ""}`} onClick={selectMode && isSelectable ? () => toggleId(user.id) : undefined} style={selectMode && isSelectable ? { cursor: "pointer" } : undefined}>
                        {selectMode && (
                          <TableCell className="w-10">
                            {isSelectable
                              ? (isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />)
                              : <Square className="w-4 h-4 text-muted-foreground/30" />}
                          </TableCell>
                        )}
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
                            {roleLabel(user.role)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={user.actif ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-[10px]"}>
                            {user.actif ? t("users.status.active") : t("users.status.deactivated")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{user.departement || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {user.dernierAcces ? new Date(user.dernierAcces).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : t("users.lastAccessNever")}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="w-8 h-8" aria-label={t("common.moreActions")}>
                                <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                                setSelectedUser(user);
                                setEditUserForm({ prenom: user.prenom || "", nom: user.nom || "", departement: user.departement || "", telephone: "" });
                                setShowEditUser(true);
                              }}>
                                <Edit className="w-4 h-4" />
                                {t("users.actions.edit")}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                                setSelectedUser(user);
                                setEditRole(user.role);
                                setShowRoleChange(true);
                              }}>
                                <UserCog className="w-4 h-4" />
                                {t("users.actions.changeRole")}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2 cursor-pointer text-blue-600" onClick={() => handleSendCredentials(user)}>
                                <LockKeyhole className="w-4 h-4" />
                                {t("users.actions.sendTempCode")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {user.role !== "super_admin" && (
                                <>
                                  <DropdownMenuItem className={`gap-2 cursor-pointer ${user.actif ? "text-amber-600" : "text-emerald-600"}`} onClick={() => handleToggleActive(user)}>
                                    {user.actif ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                    {user.actif ? t("users.actions.deactivate") : t("users.actions.reactivate")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="gap-2 cursor-pointer text-red-600" onClick={() => handleDelete(user)}>
                                    <Trash2 className="w-4 h-4" />
                                    {t("users.actions.delete")}
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
                          <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" aria-label={t("common.moreActions")}>
                            <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                            setSelectedUser(user);
                            setEditUserForm({ prenom: user.prenom || "", nom: user.nom || "", departement: user.departement || "", telephone: "" });
                            setShowEditUser(true);
                          }}>
                            <Edit className="w-4 h-4" />
                            {t("users.actions.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                            setSelectedUser(user);
                            setEditRole(user.role);
                            setShowRoleChange(true);
                          }}>
                            <UserCog className="w-4 h-4" />
                            {t("users.actions.changeRole")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2 cursor-pointer text-blue-600" onClick={() => handleSendCredentials(user)}>
                            <LockKeyhole className="w-4 h-4" />
                            {t("users.actions.sendTempCode")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {user.role !== "super_admin" && (
                            <>
                              <DropdownMenuItem className={`gap-2 cursor-pointer ${user.actif ? "text-amber-600" : "text-emerald-600"}`} onClick={() => handleToggleActive(user)}>
                                {user.actif ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                {user.actif ? t("users.actions.deactivate") : t("users.actions.reactivate")}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2 cursor-pointer text-red-600" onClick={() => handleDelete(user)}>
                                <Trash2 className="w-4 h-4" />
                                {t("users.actions.delete")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Badge className={roleConf.couleur + " border-0 text-[10px] gap-1"}>
                        <RoleIcon className="w-3 h-3" />
                        {roleLabel(user.role)}
                      </Badge>
                      <Badge className={user.actif ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-[10px]"}>
                        {user.actif ? t("users.status.active") : t("users.status.deactivated")}
                      </Badge>
                      {user.departement && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{user.departement}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {user.dernierAcces ? new Date(user.dernierAcces).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : t("users.neverConnected")}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {user.mfaActif ? (
                          <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {t("users.mfa")}</>
                        ) : (
                          <><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> {t("users.noMfa")}</>
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
                {t("users.seatsWarning", { count: siegesRestants })}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("users.seatsWarningDesc")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <AiSuggestionsCard page="utilisateurs" title={t("users.aiTitle")} compact />

      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              {t("users.addDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("users.addDialog.desc")}
              {siegesRestants > 0 && (
                <span className="block mt-1 text-emerald-600">
                  {t("users.addDialog.seatsAvailable", { count: siegesRestants })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("users.form.firstName")}</Label>
                <Input aria-label={t("users.form.firstName")} placeholder={t("users.form.firstNamePlaceholder")} value={newUser.prenom} onChange={(e) => setNewUser({ ...newUser, prenom: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("users.form.lastName")}</Label>
                <Input aria-label={t("users.form.lastName")} placeholder={t("users.form.lastNamePlaceholder")} value={newUser.nom} onChange={(e) => setNewUser({ ...newUser, nom: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("users.form.email")}</Label>
              <Input aria-label={t("users.form.email")} type="email" placeholder={t("users.form.emailPlaceholder")} value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("users.form.password")}</Label>
              <Input aria-label={t("users.form.password")} type="password" placeholder={t("users.form.passwordPlaceholder")} value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">{t("users.form.passwordHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("users.form.role")}</Label>
                <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as UserRole })}>
                  <SelectTrigger aria-label={t("users.form.role")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">{t("users.roles.agent")}</SelectItem>
                    <SelectItem value="administrateur">{t("users.roles.administrateur")}</SelectItem>
                    <SelectItem value="lecture_seule">{t("users.roles.lecture_seule")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("users.form.department")}</Label>
                <Input aria-label={t("users.form.department")} placeholder={t("users.form.departmentPlaceholder")} value={newUser.departement} onChange={(e) => setNewUser({ ...newUser, departement: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowAddUser(false)}>{t("common.cancel")}</Button>
            {!newUser.password && (
              <Button variant="secondary" onClick={handleCreateAndSend} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {t("users.addDialog.createAndSend")}
              </Button>
            )}
            <Button onClick={handleAddUser} disabled={saving || !newUser.password} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {t("users.addDialog.createUser")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingInvitations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MailPlus className="w-5 h-5 text-amber-500" />
              {t("users.pending.title")}
              <Badge variant="secondary" className="ml-auto">{pendingInvitations.length}</Badge>
            </CardTitle>
            <CardDescription>{t("users.pending.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingInvitations.map((inv) => {
              const hoursLeft = Math.max(0, Math.round((new Date(inv.expiresAt).getTime() - Date.now()) / 3600000));
              return (
                <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/30 dark:border-amber-800/20">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                      <Mail className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{inv.email}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] h-5">{ROLE_CONFIG[inv.role as UserRole] ? roleLabel(inv.role as UserRole) : inv.role}</Badge>
                        <span><Clock className="w-3 h-3 inline mr-0.5" />{t("users.pending.hoursLeft", { count: hoursLeft })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => handleResendInvite(inv.id)}>
                      <RotateCcw className="w-3 h-3" />
                      {t("users.pending.resend")}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20" onClick={() => handleCancelInvite(inv.id)} aria-label={t("common.block")}>
                      <Ban className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MailPlus className="w-5 h-5 text-amber-500" />
              {t("users.inviteDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("users.inviteDialog.desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("users.inviteDialog.emailLabel")}</Label>
              <Input aria-label={t("users.inviteDialog.emailLabel")} type="email" placeholder={t("users.inviteDialog.emailPlaceholder")} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("users.form.role")}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger aria-label={t("users.form.role")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">{t("users.roles.agent")}</SelectItem>
                  <SelectItem value="administrateur">{t("users.roles.administrateur")}</SelectItem>
                  <SelectItem value="lecture_seule">{t("users.roles.lecture_seule")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t("users.inviteDialog.roleHint")}</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30 rounded-lg p-3">
              <p className="text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
                <LockKeyhole className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {t("users.inviteDialog.tokenInfo")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSendInvite} disabled={saving || !inviteEmail} className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {t("users.inviteDialog.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditUser} onOpenChange={setShowEditUser}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5" />
              {t("users.editDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {selectedUser && `${selectedUser.email}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("users.form.firstNamePlaceholder")}</Label>
                <Input aria-label={t("users.form.firstNamePlaceholder")} value={editUserForm.prenom} onChange={(e) => setEditUserForm(f => ({ ...f, prenom: e.target.value }))} />
              </div>
              <div>
                <Label>{t("users.form.lastNamePlaceholder")}</Label>
                <Input aria-label={t("users.form.lastNamePlaceholder")} value={editUserForm.nom} onChange={(e) => setEditUserForm(f => ({ ...f, nom: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>{t("users.form.department")}</Label>
              <Input aria-label={t("users.form.department")} value={editUserForm.departement} onChange={(e) => setEditUserForm(f => ({ ...f, departement: e.target.value }))} placeholder={t("users.editDialog.departmentPlaceholder")} />
            </div>
            <div>
              <Label>{t("users.editDialog.phone")}</Label>
              <Input aria-label={t("users.editDialog.phone")} value={editUserForm.telephone} onChange={(e) => setEditUserForm(f => ({ ...f, telephone: e.target.value }))} placeholder={t("users.editDialog.phonePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditUser(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleEditUser} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRoleChange} onOpenChange={setShowRoleChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              {t("users.roleDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {selectedUser && t("users.roleDialog.currentRole", { name: `${selectedUser.prenom} ${selectedUser.nom}`, role: roleLabel(selectedUser.role) })}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>{t("users.roleDialog.newRole")}</Label>
            <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
              <SelectTrigger aria-label={t("users.roleDialog.newRole")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Le serveur (middleware/tenant-guard.ts: assertRoleAllowed)
                    refuse deja toute promotion vers super_admin par un
                    non-super-admin — cache l'option cote UI plutot que de
                    laisser un administrateur la choisir puis se faire
                    rejeter apres confirmation. */}
                {isSuperAdmin() && <SelectItem value="super_admin">{t("users.roles.super_admin")}</SelectItem>}
                <SelectItem value="administrateur">{t("users.roles.administrateur")}</SelectItem>
                <SelectItem value="agent">{t("users.roles.agent")}</SelectItem>
                <SelectItem value="lecture_seule">{t("users.roles.lecture_seule")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRoleChange(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleRoleChange} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
