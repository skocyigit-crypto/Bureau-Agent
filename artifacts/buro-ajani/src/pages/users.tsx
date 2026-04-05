import { useState } from "react";
import {
  Users, UserPlus, Crown, Shield, ShieldCheck, Eye, Trash2, MoreHorizontal,
  Mail, Building2, Clock, CheckCircle2, XCircle, AlertTriangle, Search,
  CreditCard, TrendingUp, Lock, Unlock, Edit, UserCog, Phone, ChevronDown,
  Download, RefreshCw, Copy, ArrowUpRight, Zap, Star, ShieldAlert
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon3D } from "@/components/icon-3d";
import officeTeamImg from "@/assets/images/office-team.png";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { useWorkspaceUser } from "@/components/workspace-user";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";

type UserRole = "super_admin" | "administrateur" | "agent" | "lecture_seule";
type UserStatus = "actif" | "inactif" | "invite" | "suspendu";

interface TeamUser {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  departement: string;
  dernierAcces: string;
  dateAjout: string;
  appels: number;
  taches: number;
  mfaActif: boolean;
}

interface LicencePlan {
  id: string;
  nom: string;
  prix: number;
  siegesInclus: number;
  prixParSiege: number;
  fonctionnalites: string[];
  populaire?: boolean;
}

const PLANS: LicencePlan[] = [
  {
    id: "essentiel",
    nom: "Essentiel",
    prix: 29,
    siegesInclus: 3,
    prixParSiege: 9,
    fonctionnalites: [
      "3 utilisateurs inclus",
      "Appels et contacts illimites",
      "Rapports de base",
      "Support par e-mail",
      "1 Go de stockage / utilisateur",
    ],
  },
  {
    id: "professionnel",
    nom: "Professionnel",
    prix: 59,
    siegesInclus: 10,
    prixParSiege: 7,
    populaire: true,
    fonctionnalites: [
      "10 utilisateurs inclus",
      "Toutes les fonctionnalites",
      "Intelligence IA complete",
      "Google Workspace (26 apps)",
      "Rapports avances et analyse",
      "Support prioritaire",
      "10 Go de stockage / utilisateur",
    ],
  },
  {
    id: "entreprise",
    nom: "Entreprise",
    prix: 0,
    siegesInclus: 999,
    prixParSiege: 5,
    fonctionnalites: [
      "Utilisateurs illimites",
      "Toutes les fonctionnalites Pro",
      "SSO / SAML",
      "API dedicee",
      "SLA garanti 99.9%",
      "Chef de compte dedie",
      "Stockage illimite",
      "Formation sur site",
    ],
  },
];

const ROLE_CONFIG: Record<UserRole, { label: string; couleur: string; icon: React.ElementType }> = {
  super_admin: { label: "Super Admin", couleur: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: Crown },
  administrateur: { label: "Administrateur", couleur: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: ShieldCheck },
  agent: { label: "Agent", couleur: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: Phone },
  lecture_seule: { label: "Lecture seule", couleur: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400", icon: Eye },
};

const STATUS_CONFIG: Record<UserStatus, { label: string; couleur: string }> = {
  actif: { label: "Actif", couleur: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  inactif: { label: "Inactif", couleur: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  invite: { label: "Invite", couleur: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  suspendu: { label: "Suspendu", couleur: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const INITIAL_USERS: TeamUser[] = [
  {
    id: "u1",
    prenom: "Aurelie",
    nom: "Benoit",
    email: "a.benoit@agentdebureau.fr",
    role: "super_admin",
    status: "actif",
    departement: "Direction",
    dernierAcces: "03/04/2026 14:32",
    dateAjout: "01/01/2025",
    appels: 342,
    taches: 89,
    mfaActif: true,
  },
  {
    id: "u2",
    prenom: "Lucas",
    nom: "Moreau",
    email: "l.moreau@agentdebureau.fr",
    role: "administrateur",
    status: "actif",
    departement: "Commercial",
    dernierAcces: "03/04/2026 11:15",
    dateAjout: "15/03/2025",
    appels: 521,
    taches: 134,
    mfaActif: true,
  },
  {
    id: "u3",
    prenom: "Camille",
    nom: "Durand",
    email: "c.durand@agentdebureau.fr",
    role: "agent",
    status: "actif",
    departement: "Support",
    dernierAcces: "03/04/2026 13:45",
    dateAjout: "01/06/2025",
    appels: 1247,
    taches: 312,
    mfaActif: true,
  },
  {
    id: "u4",
    prenom: "Thomas",
    nom: "Lefevre",
    email: "t.lefevre@agentdebureau.fr",
    role: "agent",
    status: "actif",
    departement: "Commercial",
    dernierAcces: "02/04/2026 17:30",
    dateAjout: "15/08/2025",
    appels: 876,
    taches: 198,
    mfaActif: false,
  },
  {
    id: "u5",
    prenom: "Sophie",
    nom: "Martin",
    email: "s.martin@agentdebureau.fr",
    role: "agent",
    status: "actif",
    departement: "Reception",
    dernierAcces: "03/04/2026 09:20",
    dateAjout: "01/09/2025",
    appels: 2103,
    taches: 456,
    mfaActif: true,
  },
  {
    id: "u6",
    prenom: "Nicolas",
    nom: "Petit",
    email: "n.petit@agentdebureau.fr",
    role: "lecture_seule",
    status: "actif",
    departement: "Comptabilite",
    dernierAcces: "01/04/2026 14:00",
    dateAjout: "01/11/2025",
    appels: 0,
    taches: 12,
    mfaActif: true,
  },
  {
    id: "u7",
    prenom: "Julie",
    nom: "Rousseau",
    email: "j.rousseau@agentdebureau.fr",
    role: "agent",
    status: "invite",
    departement: "Commercial",
    dernierAcces: "-",
    dateAjout: "02/04/2026",
    appels: 0,
    taches: 0,
    mfaActif: false,
  },
];

export default function UsersPage() {
  const { user: workspaceUser, hasPermission } = useWorkspaceUser();
  const canManageUsers = hasPermission("gererUtilisateurs");

  const [activeTab, setActiveTab] = useState("equipe");
  const [users, setUsers] = useState<TeamUser[]>(INITIAL_USERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("tous");
  const [showAddUser, setShowAddUser] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [currentPlanId, setCurrentPlanId] = useState("professionnel");
  const [extraSeats, setExtraSeats] = useState(0);
  const [newUser, setNewUser] = useState({ prenom: "", nom: "", email: "", role: "agent" as UserRole, departement: "" });
  const { toast } = useToast();

  const currentPlan = PLANS.find(p => p.id === currentPlanId) || PLANS[1];

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
  const siegesUtilises = users.filter(u => u.status !== "suspendu").length;
  const siegesMax = currentPlan.siegesInclus + extraSeats;
  const siegesRestants = siegesMax - siegesUtilises;
  const coutMensuel = currentPlan.prix + (extraSeats * currentPlan.prixParSiege);

  const filteredUsers = users
    .filter(u => roleFilter === "tous" || u.role === roleFilter)
    .filter(u => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return u.prenom.toLowerCase().includes(q) || u.nom.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.departement.toLowerCase().includes(q);
    });

  const handleAddUser = () => {
    if (!newUser.prenom || !newUser.nom || !newUser.email) {
      toast({ title: "Erreur", description: "Tous les champs sont obligatoires.", variant: "destructive" });
      return;
    }
    if (siegesRestants <= 0) {
      setShowUpgrade(true);
      setShowAddUser(false);
      return;
    }
    const user: TeamUser = {
      id: `u${Date.now()}`,
      ...newUser,
      status: "invite",
      dernierAcces: "-",
      dateAjout: new Date().toLocaleDateString("fr-FR"),
      appels: 0,
      taches: 0,
      mfaActif: false,
    };
    setUsers([...users, user]);
    setNewUser({ prenom: "", nom: "", email: "", role: "agent", departement: "" });
    setShowAddUser(false);
    toast({
      title: "Invitation envoyee",
      description: `${user.prenom} ${user.nom} recevra un e-mail d'invitation a ${user.email}.`,
    });
  };

  const handleSuspend = (userId: string) => {
    const target = users.find(u => u.id === userId);
    if (target?.role === "super_admin") {
      toast({ title: "Action interdite", description: "Le Super Administrateur ne peut pas etre suspendu.", variant: "destructive" });
      return;
    }
    setUsers(users.map(u => u.id === userId ? { ...u, status: "suspendu" as UserStatus } : u));
    toast({ title: "Utilisateur suspendu", description: "L'acces a ete revoque. Le siege est libere." });
  };

  const handleReactivate = (userId: string) => {
    if (siegesRestants <= 0) {
      setShowUpgrade(true);
      return;
    }
    setUsers(users.map(u => u.id === userId ? { ...u, status: "actif" as UserStatus } : u));
    toast({ title: "Utilisateur reactive", description: "L'acces a ete retabli." });
  };

  const handleRemove = (userId: string) => {
    setUsers(users.filter(u => u.id !== userId));
    toast({ title: "Utilisateur supprime", description: "L'utilisateur a ete retire et le siege est libere." });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Users} variant="teal" size="md" /> Gestion des utilisateurs</h1>
          <p className="text-muted-foreground">Gerez votre equipe, les licences et les permissions d'acces.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2" onClick={() => setShowUpgrade(true)}>
            <ArrowUpRight className="w-4 h-4" />
            Changer de plan
          </Button>
          <Button className="gap-2" onClick={() => siegesRestants > 0 ? setShowAddUser(true) : setShowUpgrade(true)}>
            <UserPlus className="w-4 h-4" />
            Ajouter un utilisateur
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
              <p className="text-white/80 text-sm mt-1">Licences par siege, permissions granulaires et suivi des activites.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Sieges utilises</p>
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{siegesUtilises} <span className="text-sm font-normal text-muted-foreground">/ {siegesMax}</span></p>
            <Progress value={(siegesUtilises / siegesMax) * 100} className="mt-2 h-1.5" />
            <p className="text-[10px] text-muted-foreground mt-1">{siegesRestants} siege(s) disponible(s)</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Plan actuel</p>
              <CreditCard className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{currentPlan.nom}</p>
            <p className="text-xs text-muted-foreground mt-1">{currentPlan.prix} EUR/mois + {currentPlan.prixParSiege} EUR/siege supplementaire</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Cout mensuel</p>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{coutMensuel} EUR</p>
            <p className="text-xs text-muted-foreground mt-1">Prochaine facture le 01/05/2026</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">Utilisateurs actifs</p>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold">{users.filter(u => u.status === "actif").length}</p>
            <p className="text-xs text-muted-foreground mt-1">Connectes cette semaine</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="equipe" className="gap-2">
            <Users className="w-4 h-4" />
            Equipe ({users.length})
          </TabsTrigger>
          <TabsTrigger value="licences" className="gap-2">
            <CreditCard className="w-4 h-4" />
            Licences et tarifs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="equipe" className="space-y-4 mt-4">
          <div className="flex items-center gap-4">
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
              <SelectTrigger className="w-48">
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

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[280px]">Utilisateur</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Departement</TableHead>
                    <TableHead className="text-right">Appels</TableHead>
                    <TableHead className="text-right">Taches</TableHead>
                    <TableHead>MFA</TableHead>
                    <TableHead>Dernier acces</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const roleConf = ROLE_CONFIG[user.role];
                    const statusConf = STATUS_CONFIG[user.status];
                    const RoleIcon = roleConf.icon;
                    return (
                      <TableRow key={user.id} className={user.status === "suspendu" ? "opacity-50" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">
                              {user.prenom[0]}{user.nom[0]}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{user.prenom} {user.nom}</p>
                              <p className="text-[11px] text-muted-foreground">{user.email}</p>
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
                          <Badge className={statusConf.couleur + " border-0 text-[10px]"}>
                            {statusConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{user.departement}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{user.appels.toLocaleString("fr-FR")}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{user.taches}</TableCell>
                        <TableCell>
                          {user.mfaActif ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{user.dernierAcces}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="w-8 h-8">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem className="gap-2 cursor-pointer">
                                <Edit className="w-4 h-4" />
                                Modifier
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2 cursor-pointer">
                                <UserCog className="w-4 h-4" />
                                Changer le role
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2 cursor-pointer">
                                <Mail className="w-4 h-4" />
                                Envoyer un e-mail
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {user.status === "suspendu" ? (
                                <DropdownMenuItem className="gap-2 cursor-pointer text-emerald-600" onClick={() => handleReactivate(user.id)}>
                                  <Unlock className="w-4 h-4" />
                                  Reactiver
                                </DropdownMenuItem>
                              ) : user.role !== "super_admin" ? (
                                <DropdownMenuItem className="gap-2 cursor-pointer text-amber-600" onClick={() => handleSuspend(user.id)}>
                                  <Lock className="w-4 h-4" />
                                  Suspendre
                                </DropdownMenuItem>
                              ) : null}
                              {user.role !== "super_admin" && (
                                <DropdownMenuItem className="gap-2 cursor-pointer text-red-600" onClick={() => handleRemove(user.id)}>
                                  <Trash2 className="w-4 h-4" />
                                  Supprimer
                                </DropdownMenuItem>
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

          {siegesRestants <= 2 && siegesRestants > 0 && (
            <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/10">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Il ne reste que {siegesRestants} siege(s) disponible(s) sur votre plan
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Passez au plan superieur pour ajouter plus d'utilisateurs
                    </p>
                  </div>
                </div>
                <Button size="sm" className="gap-2" onClick={() => setShowUpgrade(true)}>
                  <ArrowUpRight className="w-4 h-4" />
                  Augmenter
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="licences" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map((plan) => (
              <Card key={plan.id} className={`relative ${plan.populaire ? "border-primary shadow-lg" : ""} ${plan.id === currentPlan.id ? "ring-2 ring-primary" : ""}`}>
                {plan.populaire && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground gap-1">
                      <Star className="w-3 h-3" />
                      Le plus populaire
                    </Badge>
                  </div>
                )}
                {plan.id === currentPlan.id && (
                  <div className="absolute -top-3 right-4">
                    <Badge className="bg-emerald-100 text-emerald-700 border-0 gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Plan actuel
                    </Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-lg">{plan.nom}</CardTitle>
                  <div className="mt-2">
                    {plan.prix > 0 ? (
                      <>
                        <span className="text-3xl font-bold">{plan.prix} EUR</span>
                        <span className="text-muted-foreground text-sm"> / mois</span>
                      </>
                    ) : (
                      <span className="text-3xl font-bold">Sur devis</span>
                    )}
                  </div>
                  <CardDescription className="mt-1">
                    {plan.siegesInclus < 999 ? `${plan.siegesInclus} utilisateurs inclus` : "Utilisateurs illimites"}
                    {plan.prix > 0 && <span> puis {plan.prixParSiege} EUR/siege</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 mb-6">
                    {plan.fonctionnalites.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                  {plan.id === currentPlan.id ? (
                    <Button variant="outline" className="w-full" disabled>
                      Plan actuel
                    </Button>
                  ) : plan.prix === 0 ? (
                    <Button variant="outline" className="w-full gap-2" onClick={() => toast({ title: "Demande envoyee", description: "Un commercial vous contactera sous 24h pour un devis personnalise." })}>
                      <Mail className="w-4 h-4" />
                      Contacter les ventes
                    </Button>
                  ) : (
                    <Button className="w-full gap-2" onClick={() => {
                      setCurrentPlanId(plan.id);
                      setExtraSeats(0);
                      toast({ title: "Plan mis a jour", description: `Vous etes maintenant sur le plan ${plan.nom}.` });
                    }}>
                      <ArrowUpRight className="w-4 h-4" />
                      {plan.prix < currentPlan.prix ? "Reduire" : "Passer a ce plan"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Calculateur de cout
              </CardTitle>
              <CardDescription>Estimez le cout mensuel selon le nombre d'utilisateurs souhaite.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {PLANS.filter(p => p.prix > 0).map((plan) => {
                  const extraSeats = Math.max(0, siegesUtilises - plan.siegesInclus);
                  const total = plan.prix + extraSeats * plan.prixParSiege;
                  return (
                    <div key={plan.id} className={`border rounded-lg p-4 ${plan.id === currentPlan.id ? "border-primary bg-primary/5" : ""}`}>
                      <h4 className="font-semibold text-sm mb-3">{plan.nom}</h4>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Abonnement de base</span>
                          <span className="font-medium text-foreground">{plan.prix} EUR</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Sieges inclus</span>
                          <span>{plan.siegesInclus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Sieges utilises</span>
                          <span>{siegesUtilises}</span>
                        </div>
                        {extraSeats > 0 && (
                          <div className="flex justify-between text-amber-600">
                            <span>Sieges supplementaires ({extraSeats} x {plan.prixParSiege} EUR)</span>
                            <span className="font-medium">{extraSeats * plan.prixParSiege} EUR</span>
                          </div>
                        )}
                        <Separator className="my-2" />
                        <div className="flex justify-between text-sm font-bold text-foreground">
                          <span>Total mensuel</span>
                          <span>{total} EUR</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span>Cout par utilisateur</span>
                          <span>{(total / Math.max(1, siegesUtilises)).toFixed(2)} EUR</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historique de facturation</CardTitle>
              <CardDescription>Vos 3 dernieres factures.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Utilisateurs</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { date: "01/04/2026", desc: "Abonnement Professionnel - Avril 2026", users: 7, montant: 59, statut: "paye" },
                    { date: "01/03/2026", desc: "Abonnement Professionnel - Mars 2026", users: 6, montant: 59, statut: "paye" },
                    { date: "01/02/2026", desc: "Abonnement Professionnel - Fevrier 2026", users: 5, montant: 59, statut: "paye" },
                  ].map((f, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{f.date}</TableCell>
                      <TableCell className="text-sm">{f.desc}</TableCell>
                      <TableCell className="text-sm">{f.users} sieges</TableCell>
                      <TableCell className="text-right text-sm font-medium">{f.montant} EUR</TableCell>
                      <TableCell>
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px]">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Paye
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="gap-1 text-xs">
                          <Download className="w-3 h-3" />
                          PDF
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AiSuggestionsCard page="utilisateurs" title="Recommandations IA - Equipe" compact />

      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Ajouter un utilisateur
            </DialogTitle>
            <DialogDescription>
              Invitez un nouveau membre a votre equipe. Il recevra un e-mail d'invitation.
              {siegesRestants > 0 && (
                <span className="block mt-1 text-emerald-600">
                  {siegesRestants} siege(s) disponible(s) sur votre plan.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prenom</Label>
                <Input placeholder="Prenom" value={newUser.prenom} onChange={(e) => setNewUser({ ...newUser, prenom: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input placeholder="Nom" value={newUser.nom} onChange={(e) => setNewUser({ ...newUser, nom: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Adresse e-mail</Label>
              <Input type="email" placeholder="utilisateur@entreprise.fr" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddUser(false)}>Annuler</Button>
            <Button onClick={handleAddUser} className="gap-2">
              <Mail className="w-4 h-4" />
              Envoyer l'invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showUpgrade} onOpenChange={setShowUpgrade}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              Augmenter votre capacite
            </DialogTitle>
            <DialogDescription>
              Votre plan actuel ({currentPlan.nom}) inclut {currentPlan.siegesInclus} sieges.
              Vous utilisez actuellement {siegesUtilises} siege(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="border rounded-lg p-4">
              <h4 className="font-semibold text-sm mb-2">Option 1 : Ajouter des sieges supplementaires</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Chaque siege supplementaire coute {currentPlan.prixParSiege} EUR/mois sur votre plan actuel.
              </p>
              <Button variant="outline" className="w-full gap-2" onClick={() => {
                setExtraSeats(prev => prev + 1);
                setShowUpgrade(false);
                toast({ title: "Siege ajoute", description: `Un siege supplementaire a ete ajoute (+${currentPlan.prixParSiege} EUR/mois). Total: ${siegesMax + 1} sieges.` });
              }}>
                <UserPlus className="w-4 h-4" />
                Ajouter 1 siege ({currentPlan.prixParSiege} EUR/mois)
              </Button>
            </div>

            <div className="border rounded-lg p-4 border-primary bg-primary/5">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="font-semibold text-sm">Option 2 : Passer au plan Entreprise</h4>
                <Badge className="bg-primary/10 text-primary border-0 text-[10px]">Recommande</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Utilisateurs illimites, SSO, API dedicee et support premium. Tarif sur devis.
              </p>
              <Button className="w-full gap-2" onClick={() => {
                setShowUpgrade(false);
                toast({ title: "Demande envoyee", description: "Un commercial vous contactera sous 24h." });
              }}>
                <Mail className="w-4 h-4" />
                Demander un devis Entreprise
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
