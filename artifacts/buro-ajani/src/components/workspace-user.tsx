import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  Shield, ShieldCheck, User, UserCog, Eye, LogOut, ChevronDown, Clock,
  Building2, Mail, Globe, Fingerprint, KeyRound, CheckCircle2, AlertTriangle,
  Lock, Settings, Activity
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export type UserRole = "super_admin" | "administrateur" | "agent" | "lecture_seule";

export interface WorkspaceUser {
  id: number;
  email: string;
  nom: string;
  prenom: string;
  avatar: string;
  role: UserRole;
  departement: string;
  organisation: string;
  domaine: string;
  dernierAcces: string;
  mfaActif: boolean;
  sessionExpire: string;
  permissions: UserPermissions;
  securiteScore: number;
  googleConnected: boolean;
  locale: string;
  fuseau: string;
}

export interface UserPermissions {
  telechargerFichiers: boolean;
  supprimerDonnees: boolean;
  exporterDonnees: boolean;
  gererUtilisateurs: boolean;
  modifierSecurite: boolean;
  accesAudit: boolean;
  accesAdmin: boolean;
  creerContacts: boolean;
  creerTaches: boolean;
  gererAppels: boolean;
  voirRapports: boolean;
  utiliserIA: boolean;
  gererIntegrations: boolean;
}

const ROLE_CONFIG: Record<UserRole, {
  label: string;
  niveau: number;
  couleur: string;
  badgeClass: string;
  permissions: UserPermissions;
}> = {
  super_admin: {
    label: "Super Administrateur",
    niveau: 4,
    couleur: "red",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0",
    permissions: {
      telechargerFichiers: true,
      supprimerDonnees: true,
      exporterDonnees: true,
      gererUtilisateurs: true,
      modifierSecurite: true,
      accesAudit: true,
      accesAdmin: true,
      creerContacts: true,
      creerTaches: true,
      gererAppels: true,
      voirRapports: true,
      utiliserIA: true,
      gererIntegrations: true,
    },
  },
  administrateur: {
    label: "Administrateur",
    niveau: 3,
    couleur: "amber",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0",
    permissions: {
      telechargerFichiers: false,
      supprimerDonnees: true,
      exporterDonnees: true,
      gererUtilisateurs: true,
      modifierSecurite: false,
      accesAudit: true,
      accesAdmin: true,
      creerContacts: true,
      creerTaches: true,
      gererAppels: true,
      voirRapports: true,
      utiliserIA: true,
      gererIntegrations: true,
    },
  },
  agent: {
    label: "Agent",
    niveau: 2,
    couleur: "blue",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0",
    permissions: {
      telechargerFichiers: false,
      supprimerDonnees: false,
      exporterDonnees: false,
      gererUtilisateurs: false,
      modifierSecurite: false,
      accesAudit: false,
      accesAdmin: false,
      creerContacts: true,
      creerTaches: true,
      gererAppels: true,
      voirRapports: true,
      utiliserIA: true,
      gererIntegrations: false,
    },
  },
  lecture_seule: {
    label: "Lecture seule",
    niveau: 1,
    couleur: "gray",
    badgeClass: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border-0",
    permissions: {
      telechargerFichiers: false,
      supprimerDonnees: false,
      exporterDonnees: false,
      gererUtilisateurs: false,
      modifierSecurite: false,
      accesAudit: false,
      accesAdmin: false,
      creerContacts: false,
      creerTaches: false,
      gererAppels: false,
      voirRapports: true,
      utiliserIA: false,
      gererIntegrations: false,
    },
  },
};

function buildWorkspaceUser(apiUser: any): WorkspaceUser {
  const role = apiUser.role as UserRole;
  const now = new Date();
  const sessionExpire = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    id: apiUser.id,
    email: apiUser.email,
    nom: apiUser.nom,
    prenom: apiUser.prenom,
    avatar: apiUser.avatar || `${apiUser.prenom[0]}${apiUser.nom[0]}`.toUpperCase(),
    role,
    departement: apiUser.departement || "General",
    organisation: apiUser.organisation || "Agent de Bureau SAS",
    domaine: apiUser.email.split("@")[1] || "agentdebureau.fr",
    dernierAcces: now.toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    }),
    mfaActif: apiUser.mfaActif || false,
    sessionExpire: sessionExpire.toLocaleString("fr-FR", {
      hour: "2-digit", minute: "2-digit"
    }),
    permissions: ROLE_CONFIG[role].permissions,
    securiteScore: role === "super_admin" ? 96 : role === "administrateur" ? 85 : 70,
    googleConnected: false,
    locale: "fr-FR",
    fuseau: "Europe/Paris",
  };
}

interface WorkspaceUserContextType {
  user: WorkspaceUser;
  roleConfig: typeof ROLE_CONFIG[UserRole];
  hasPermission: (perm: keyof UserPermissions) => boolean;
  isSuperAdmin: () => boolean;
  isAtLeast: (role: UserRole) => boolean;
  logout: () => void;
}

const WorkspaceUserContext = createContext<WorkspaceUserContextType | null>(null);

export function useWorkspaceUser() {
  const ctx = useContext(WorkspaceUserContext);
  if (!ctx) throw new Error("useWorkspaceUser must be used within WorkspaceUserProvider");
  return ctx;
}

interface WorkspaceUserProviderProps {
  children: ReactNode;
  apiUser: any;
  onLogout: () => void;
}

export function WorkspaceUserProvider({ children, apiUser, onLogout }: WorkspaceUserProviderProps) {
  const [user] = useState<WorkspaceUser>(() => buildWorkspaceUser(apiUser));
  const roleConfig = ROLE_CONFIG[user.role];

  const hasPermission = (perm: keyof UserPermissions) => user.permissions[perm];
  const isSuperAdmin = () => user.role === "super_admin";
  const isAtLeast = (role: UserRole) => ROLE_CONFIG[user.role].niveau >= ROLE_CONFIG[role].niveau;

  const logout = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (err) { console.error("[WorkspaceUser] logout request failed:", err); }
    onLogout();
  }, [onLogout]);

  return (
    <WorkspaceUserContext.Provider value={{ user, roleConfig, hasPermission, isSuperAdmin, isAtLeast, logout }}>
      {children}
    </WorkspaceUserContext.Provider>
  );
}

export function UserProfileButton() {
  const { user, roleConfig, logout } = useWorkspaceUser();
  const [showProfile, setShowProfile] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 p-1 pr-2 rounded-full hover:bg-muted transition-colors outline-none border border-transparent hover:border-border">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-medium border border-primary/30">
              {user.avatar}
            </div>
            <div className="hidden lg:flex flex-col items-start">
              <span className="text-xs font-medium leading-none">{user.prenom} {user.nom}</span>
              <span className="text-[10px] text-muted-foreground leading-none mt-0.5">{roleConfig.label}</span>
            </div>
            <ChevronDown className="w-3 h-3 text-muted-foreground hidden lg:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="p-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold border border-primary/30">
                {user.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{user.prenom} {user.nom}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge className={roleConfig.badgeClass + " text-[10px]"}>
                <Shield className="w-3 h-3 mr-1" />
                {roleConfig.label}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                Niveau {roleConfig.niveau}
              </Badge>
            </div>
          </div>
          <DropdownMenuSeparator />
          <div className="px-3 py-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Building2 className="w-3 h-3" />
              <span>{user.organisation}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Mail className="w-3 h-3" />
              <span>{user.domaine}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Clock className="w-3 h-3" />
              <span>Session expire a {user.sessionExpire}</span>
            </div>
          </div>
          <DropdownMenuSeparator />
          <div className="px-3 py-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <Fingerprint className="w-3 h-3 text-emerald-500" />
                <span>MFA</span>
              </div>
              <Badge className={user.mfaActif ? "bg-emerald-100 text-emerald-700 border-0 text-[10px]" : "bg-gray-100 text-gray-500 border-0 text-[10px]"}>
                {user.mfaActif ? "Actif" : "Inactif"}
              </Badge>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <div className="flex items-center gap-2 text-xs">
                <ShieldCheck className="w-3 h-3 text-emerald-500" />
                <span>Score de securite</span>
              </div>
              <span className="text-xs font-bold text-emerald-600">{user.securiteScore}/100</span>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowProfile(true)} className="gap-2 cursor-pointer">
            <User className="w-4 h-4" />
            Mon profil complet
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 cursor-pointer">
            <Settings className="w-4 h-4" />
            Preferences
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 cursor-pointer">
            <Activity className="w-4 h-4" />
            Mon activite
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-red-600 focus:text-red-600 cursor-pointer"
            onClick={() => logout()}
          >
            <LogOut className="w-4 h-4" />
            Se deconnecter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showProfile} onOpenChange={setShowProfile}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              Profil utilisateur
            </DialogTitle>
            <DialogDescription>
              Informations de votre compte
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="w-14 h-14 rounded-full bg-primary/20 text-primary flex items-center justify-center text-lg font-bold border-2 border-primary/30">
                {user.avatar}
              </div>
              <div>
                <h3 className="font-semibold text-lg">{user.prenom} {user.nom}</h3>
                <p className="text-sm text-muted-foreground">{user.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={roleConfig.badgeClass + " text-xs"}>
                    <Shield className="w-3 h-3 mr-1" />
                    {roleConfig.label}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 border rounded-lg">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Organisation</p>
                <p className="text-sm font-medium mt-0.5">{user.organisation}</p>
              </div>
              <div className="p-3 border rounded-lg">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Departement</p>
                <p className="text-sm font-medium mt-0.5">{user.departement}</p>
              </div>
              <div className="p-3 border rounded-lg">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Domaine</p>
                <p className="text-sm font-medium mt-0.5">{user.domaine}</p>
              </div>
              <div className="p-3 border rounded-lg">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Fuseau horaire</p>
                <p className="text-sm font-medium mt-0.5">{user.fuseau}</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2 flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                Permissions actives
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.entries(user.permissions) as [keyof UserPermissions, boolean][]).map(([key, val]) => {
                  const labels: Record<keyof UserPermissions, string> = {
                    telechargerFichiers: "Telecharger des fichiers",
                    supprimerDonnees: "Supprimer des données",
                    exporterDonnees: "Exporter des données",
                    gererUtilisateurs: "Gerer les utilisateurs",
                    modifierSecurite: "Modifier la securite",
                    accesAudit: "Acces aux audits",
                    accesAdmin: "Acces administration",
                    creerContacts: "Creer des contacts",
                    creerTaches: "Creer des taches",
                    gererAppels: "Gerer les appels",
                    voirRapports: "Voir les rapports",
                    utiliserIA: "Utiliser l'IA",
                    gererIntegrations: "Gerer les integrations",
                  };
                  return (
                    <div key={key} className="flex items-center gap-1.5 text-xs">
                      {val ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      )}
                      <span className={val ? "" : "text-muted-foreground"}>{labels[key]}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3" />
                <span>Dernier acces : {user.dernierAcces}</span>
              </div>
              <div className="flex items-center gap-2">
                <Fingerprint className="w-3 h-3 text-emerald-500" />
                <span>MFA {user.mfaActif ? "actif" : "inactif"}</span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkspaceUserSidebarInfo() {
  const { user, roleConfig } = useWorkspaceUser();

  return (
    <div className="px-4 py-3 border-t border-sidebar-border">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-primary/20 text-primary-foreground flex items-center justify-center text-xs font-medium border border-primary/30 bg-sidebar-accent">
          {user.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sidebar-foreground text-xs font-medium truncate">{user.prenom} {user.nom}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${
              user.role === "super_admin" ? "bg-red-400" :
              user.role === "administrateur" ? "bg-amber-400" :
              user.role === "agent" ? "bg-blue-400" : "bg-gray-400"
            }`} />
            <span className="text-sidebar-foreground/60 text-[10px]">{roleConfig.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { ROLE_CONFIG };
