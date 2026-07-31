import orgBanner from "@/assets/images/security-server.webp";
import { AccessDenied } from "@/components/access-denied";
import { Icon3D } from "@/components/icon-3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceUser } from "@/components/workspace-user";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
Activity,
AlertCircle,
AlertTriangle,
ArrowUpDown,
BarChart3,
BookOpen,
Brain,
Building2,
Check,
CheckCircle2,
Clock,
Copy,
Crown,
DollarSign,
Download,
Edit,
Eye,FileCheck,
FileText,
Key,
Loader2,
Lock,
Mail,
Package,
Pause,
Percent,
Phone,
Play,
Plus,
Printer,
Receipt,
RefreshCw,
Scale,
Search,
Send,
Shield,
ShieldCheck,
Target,
Trash2,
TrendingUp,
Upload,
UserPlus,
Users,
XCircle,
Zap
} from "lucide-react";
import { useCallback,useEffect,useRef,useState } from "react";

const BASE = import.meta.env.BASE_URL || "/";

const PLAN_COLORS: Record<string, string> = {
  essai: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  starter: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  professionnel: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  entreprise: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

const INVOICE_STATUS_COLORS: Record<string, string> = {
  en_attente: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  payee: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  partiel: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  retard: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  annulee: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

interface Organisation {
  id: number;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  maxUsers: number;
  actif: boolean;
  createdAt: string;
  subscription: {
    plan: string;
    status: string;
    licenseKey: string | null;
    maxContacts: number;
    maxCallsPerMonth: number;
    aiEnabled: boolean;
    stockEnabled: boolean;
    automationEnabled: boolean;
    price: string;
    trialEndsAt: string | null;
    isTrialExpired: boolean;
    planDetails: { name: string } | null;
  } | null;
  userCount: number;
  contactCount: number;
  callCount: number;
}

interface Invoice {
  id: number;
  organisationId: number;
  periodLabel: string;
  plan: string;
  baseAmount: string;
  overageAmount: string;
  totalAmount: string;
  status: string;
  usageSnapshot: {
    users: { current: number; max: number; overage: number };
    contacts: { current: number; max: number; overage: number };
    calls: { current: number; max: number; overage: number };
    overageDetails: {
      extraUsers: number; extraUsersAmount: number;
      extraContacts: number; extraContactsAmount: number;
      extraCalls: number; extraCallsAmount: number;
    };
  } | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface BillingSummary {
  totalDue: string;
  totalDueCount: number;
  totalPaid: string;
  totalPaidCount: number;
  overdue: string;
  overdueCount: number;
  pendingPayments: number;
}

interface OrgBilling {
  invoices: Invoice[];
  totalDue: string;
  totalPaid: string;
  lastInvoice: Invoice | null;
}

interface LegalDocument {
  code: string;
  title: string;
  description: string;
  version: string;
  mandatory: boolean;
  category: string;
  status: "accepted" | "pending";
  agreement: {
    id: number;
    acceptedAt: string;
    acceptedBy: string;
    acceptedIp: string;
    documentVersion: string;
    expiresAt: string | null;
    notes: string | null;
  } | null;
}

interface LegalCompliance {
  id: number;
  name: string;
  actif: boolean;
  agreements: { id: number; documentType: string; acceptedAt: string; acceptedBy: string }[];
  missingDocuments: string[];
  acceptedCount: number;
  totalDocuments: number;
  mandatoryTotal: number;
  isCompliant: boolean;
  compliancePercent: number;
}

interface LegalSummary {
  totalOrgs: number;
  compliantOrgs: number;
  nonCompliantOrgs: number;
  complianceRate: number;
  mandatoryDocuments: number;
  totalDocuments: number;
}

export default function OrganisationsPage() {
  const { isSuperAdmin } = useWorkspaceUser();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organisation | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<number | null>(null);

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formSiret, setFormSiret] = useState("");
  const [formPlan, setFormPlan] = useState("essai");
  const [formActif, setFormActif] = useState(true);
  const [formAdminPrenom, setFormAdminPrenom] = useState("");
  const [formAdminNom, setFormAdminNom] = useState("");
  const [formAdminEmail, setFormAdminEmail] = useState("");

  // Auto-completion "Nom de l'organisation" -> recherche-entreprises.api.gouv.fr
  // (proxifiee cote serveur, voir GET /organisations/search-entreprise).
  // Debounce 350ms pour ne pas spammer l'API a chaque frappe. Selectionner un
  // resultat remplit nom/adresse/SIRET — l'utilisateur peut toujours saisir
  // manuellement si l'entreprise n'apparait pas (pas de blocage).
  const [companyResults, setCompanyResults] = useState<{ nom: string; siret: string; adresse: string; ville?: string; dirigeant?: string }[]>([]);
  const [companySearchOpen, setCompanySearchOpen] = useState(false);
  const [companySearching, setCompanySearching] = useState(false);
  const companySearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companySearchIgnore = useRef(false);

  const handleFormNameChange = (value: string) => {
    setFormName(value);
    if (companySearchIgnore.current) { companySearchIgnore.current = false; return; }
    if (companySearchTimer.current) clearTimeout(companySearchTimer.current);
    if (value.trim().length < 2) { setCompanyResults([]); setCompanySearchOpen(false); return; }
    companySearchTimer.current = setTimeout(async () => {
      setCompanySearching(true);
      try {
        const res = await fetch(`${BASE}api/organisations/search-entreprise?q=${encodeURIComponent(value.trim())}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setCompanyResults(data.results || []);
          setCompanySearchOpen((data.results || []).length > 0);
        }
      } catch { /* recherche best-effort, la saisie manuelle reste possible */ }
      finally { setCompanySearching(false); }
    }, 350);
  };

  const selectCompanyResult = (c: { nom: string; siret: string; adresse: string; ville?: string; dirigeant?: string }) => {
    companySearchIgnore.current = true;
    setFormName(c.nom);
    if (c.adresse) setFormAddress(c.adresse);
    if (c.siret) setFormSiret(c.siret);
    setCompanySearchOpen(false);
    setCompanyResults([]);
  };

  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [showBilling, setShowBilling] = useState(false);
  const [billingOrg, setBillingOrg] = useState<Organisation | null>(null);
  const [orgBilling, setOrgBilling] = useState<OrgBilling | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [bankLines, setBankLines] = useState("");
  const [uploading, setUploading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [activeTab, setActiveTab] = useState("organisations");

  const [legalCompliance, setLegalCompliance] = useState<LegalCompliance[]>([]);
  const [legalSummary, setLegalSummary] = useState<LegalSummary | null>(null);
  const [legalLoading, setLegalLoading] = useState(false);
  const [showLegalDetail, setShowLegalDetail] = useState(false);
  const [legalDetailOrg, setLegalDetailOrg] = useState<LegalCompliance | null>(null);
  const [legalDetailDocs, setLegalDetailDocs] = useState<LegalDocument[]>([]);
  const [legalDetailLoading, setLegalDetailLoading] = useState(false);
  const [acceptingLegal, setAcceptingLegal] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  const [saasMetrics, setSaasMetrics] = useState<any>(null);
  const [attention, setAttention] = useState<any>(null);
  const [saasLoading, setSaasLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [licenseDialog, setLicenseDialog] = useState<{ org: Organisation; action: "extend-trial" | "suspend" | "reactivate" | "regenerate-key" } | null>(null);
  const [confirmOrgName, setConfirmOrgName] = useState("");
  const [trialDays, setTrialDays] = useState("14");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [invoiceDrafts, setInvoiceDrafts] = useState<any[]>([]);
  const [validatingDrafts, setValidatingDrafts] = useState(false);

  const loadOrganisations = async () => {
    try {
      const res = await fetch(`${BASE}api/organisations`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setOrganisations(data.organisations || []);
      } else if (res.status === 403) {
        toast({ title: t("organisationsPage.toast.accessRefused"), description: t("organisationsPage.toast.accessRefusedDesc"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.loadOrgsError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadBillingSummary = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}api/billing/summary`, { credentials: "include" });
      if (res.ok) {
        setBillingSummary(await res.json());
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.loadBillingSummaryError"), variant: "destructive" });
      }
    } catch (err) {
      console.error("[Organisations] loadBillingSummary failed:", err);
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.billingNetworkError"), variant: "destructive" });
    }
  }, [t]);

  const loadLegalCompliance = useCallback(async () => {
    setLegalLoading(true);
    try {
      const res = await fetch(`${BASE}api/legal/compliance`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLegalCompliance(data.compliance || []);
        setLegalSummary(data.summary || null);
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.loadLegalError"), variant: "destructive" });
      }
    } catch (err) {
      console.error("[Organisations] loadLegalCompliance failed:", err);
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.legalNetworkError"), variant: "destructive" });
    } finally {
      setLegalLoading(false);
    }
  }, [t]);

  const openLegalDetail = async (org: LegalCompliance) => {
    setLegalDetailOrg(org);
    setShowLegalDetail(true);
    setLegalDetailLoading(true);
    try {
      const res = await fetch(`${BASE}api/legal/org/${org.id}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLegalDetailDocs(data.documents || []);
      }
    } catch (err) { console.error("[Organisations] openLegalDetail failed:", err); } finally {
      setLegalDetailLoading(false);
    }
  };

  const handleAcceptDocument = async (orgId: number, documentType: string) => {
    setAcceptingLegal(documentType);
    try {
      const res = await fetch(`${BASE}api/legal/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organisationId: orgId, documentType }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.docAccepted"), description: data.message });
        loadLegalCompliance().then(() => {
          if (legalDetailOrg) openLegalDetail({ ...legalDetailOrg, id: legalDetailOrg.id });
        });
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.acceptError"), variant: "destructive" });
    } finally {
      setAcceptingLegal(null);
    }
  };

  const handleAcceptAll = async (orgId: number) => {
    setAcceptingAll(true);
    try {
      const res = await fetch(`${BASE}api/legal/accept-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organisationId: orgId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.allDocsAccepted"), description: data.message });
        loadLegalCompliance().then(() => {
          if (legalDetailOrg) openLegalDetail({ ...legalDetailOrg, id: legalDetailOrg.id });
        });
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.genericError"), variant: "destructive" });
    } finally {
      setAcceptingAll(false);
    }
  };

  const handleRevokeLegal = async (agreementId: number, docTitle: string) => {
    if (!(await confirmAction({ title: t("organisationsPage.confirm.revokeTitle", { title: docTitle }), description: t("organisationsPage.confirm.revokeDesc"), confirmLabel: t("organisationsPage.confirm.revokeLabel"), destructive: true }))) return;
    try {
      const res = await fetch(`${BASE}api/legal/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agreementId, reason: "Revocation manuelle par l'administrateur" }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.agreementRevoked"), description: data.message });
        loadLegalCompliance().then(() => {
          if (legalDetailOrg) openLegalDetail({ ...legalDetailOrg, id: legalDetailOrg.id });
        });
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.genericError"), variant: "destructive" });
    }
  };

  const loadSaasMetrics = useCallback(async () => {
    setSaasLoading(true);
    try {
      const res = await fetch(`${BASE}api/billing/saas-metrics`, { credentials: "include" });
      if (res.ok) setSaasMetrics(await res.json());
      // Vue "ce qui demande une action" — chargee en parallele, tolerante a
      // l'echec (l'un ne doit pas faire disparaitre l'autre).
      fetch(`${BASE}api/admin/saas-attention`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setAttention(d); })
        .catch(() => {});
    } catch (err) { console.error("[Organisations] loadSaasMetrics failed:", err); }
    finally { setSaasLoading(false); }
  }, []);

  /**
   * Actions d'abonnement reservees au super-admin.
   *
   * Elles existaient cote serveur (prolongation d'essai, suspension et
   * reactivation de l'abonnement, regeneration de cle de licence, export des
   * donnees de l'organisation) avec journalisation d'audit et confirmation par
   * saisie du nom exact — mais aucune page ne les appelait. Le seul bouton
   * disponible ici, « Suspendre », agit sur le drapeau `actif` de
   * l'organisation, ce qui n'est PAS la meme chose que suspendre l'abonnement
   * (statut, motif, date de suspension, invalidation du cache de licence).
   */
  const runLicenseAction = async (
    org: Organisation,
    action: "extend-trial" | "suspend" | "reactivate" | "regenerate-key",
    body: Record<string, unknown> = {},
  ) => {
    setLicenseBusy(true);
    try {
      const res = await fetch(`${BASE}api/license-management/orgs/${org.id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("organisationsPage.toast.actionRefused"), description: data.error, variant: "destructive" });
        return;
      }
      const messages: Record<string, string> = {
        "extend-trial": t("organisationsPage.toast.trialExtended", { date: data.trialEndsAt ? new Date(data.trialEndsAt).toLocaleDateString("fr-FR") : "-" }),
        suspend: t("organisationsPage.toast.subSuspended"),
        reactivate: t("organisationsPage.toast.subReactivated"),
        "regenerate-key": t("organisationsPage.toast.newKey", { key: data.licenseKey ?? t("organisationsPage.toast.newKeyGenerated") }),
      };
      toast({ title: messages[action] });
      setLicenseDialog(null);
      setConfirmOrgName("");
      loadOrganisations();
      loadSaasMetrics();
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.actionFailed"), variant: "destructive" });
    } finally {
      setLicenseBusy(false);
    }
  };

  const handleToggleStatus = async (org: Organisation) => {
    if (org.id === 1) return;
    if (org.actif) {
      if (!(await confirmAction({ title: t("organisationsPage.confirm.suspendOrgTitle", { name: org.name }), description: t("organisationsPage.confirm.suspendOrgDesc"), confirmLabel: t("organisationsPage.confirm.suspendLabel"), destructive: true }))) return;
    }
    setTogglingId(org.id);
    try {
      const res = await fetch(`${BASE}api/organisations/${org.id}/toggle-status`, {
        method: "PATCH",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: org.actif ? t("organisationsPage.toast.orgSuspended") : t("organisationsPage.toast.orgActivated"), description: data.message });
        loadOrganisations();
        loadSaasMetrics();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.statusChangeError"), variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

  useEffect(() => { loadOrganisations(); loadBillingSummary(); loadLegalCompliance(); loadSaasMetrics(); }, [loadBillingSummary, loadLegalCompliance, loadSaasMetrics]);

  const resetForm = () => {
    setFormName(""); setFormEmail(""); setFormPhone(""); setFormAddress(""); setFormSiret(""); setFormPlan("essai"); setFormActif(true);
    setFormAdminPrenom(""); setFormAdminNom(""); setFormAdminEmail("");
    setCompanyResults([]); setCompanySearchOpen(false);
  };

  const openCreate = () => { resetForm(); setShowCreate(true); };

  const openEdit = (org: Organisation) => {
    setSelectedOrg(org);
    setFormName(org.name);
    setFormEmail(org.email || "");
    setFormPhone(org.phone || "");
    setFormAddress(org.address || "");
    setFormActif(org.actif);
    setShowEdit(true);
  };

  const openPlanChange = (org: Organisation) => {
    setSelectedOrg(org);
    setFormPlan(org.subscription?.plan || "essai");
    setShowPlan(true);
  };

  const openBilling = async (org: Organisation) => {
    setBillingOrg(org);
    setShowBilling(true);
    setBillingLoading(true);
    try {
      const res = await fetch(`${BASE}api/billing/invoices/${org.id}`, { credentials: "include" });
      if (res.ok) {
        setOrgBilling(await res.json());
      }
    } catch (err) { console.error("[Organisations] openBilling failed:", err); } finally {
      setBillingLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formName.trim()) { toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.nameRequired"), variant: "destructive" }); return; }
    if (formAdminPrenom || formAdminNom || formAdminEmail) {
      if (!formAdminPrenom || !formAdminNom || !formAdminEmail) {
        toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.adminFieldsRequired"), variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: formName, email: formEmail, phone: formPhone, address: formAddress, siret: formSiret || undefined, plan: formPlan,
          adminPrenom: formAdminPrenom || undefined,
          adminNom: formAdminNom || undefined,
          adminEmail: formAdminEmail || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // L'organisation est creee meme si l'e-mail echoue: on ferme donc la
        // boite de dialogue (re-soumettre creerait un doublon), mais on ne
        // pretend PAS que la licence est partie. Avant, ce message affichait
        // "Identifiants envoyes" sans jamais regarder data.emailSent — un envoi
        // en echec ressemblait a un succes et la fenetre se fermait toute seule.
        if (data.emailSent) {
          const adminMsg = data.adminUser ? t("organisationsPage.toast.orgCreatedAdminMsg", { email: data.adminUser.email }) : "";
          toast({ title: t("organisationsPage.toast.orgCreated"), description: t("organisationsPage.toast.orgCreatedDesc", { name: formName, plan: data.subscription?.plan || formPlan, adminMsg }) });
        } else {
          toast({
            title: t("organisationsPage.toast.orgCreatedNoEmail"),
            description: t("organisationsPage.toast.orgCreatedNoEmailDesc", { note: data.emailNote || t("organisationsPage.toast.emailSendFailed"), name: formName }),
            variant: "destructive",
            duration: 15000,
          });
        }
        setShowCreate(false);
        loadOrganisations();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.createError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedOrg) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations/${selectedOrg.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: formName, email: formEmail, phone: formPhone, address: formAddress, actif: formActif }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.updated"), description: data.message });
        setShowEdit(false);
        loadOrganisations();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.updateError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handlePlanChange = async () => {
    if (!selectedOrg) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations/${selectedOrg.id}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: formPlan }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.planUpdated"), description: data.message });
        setShowPlan(false);
        loadOrganisations();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.planChangeError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedOrg) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations/${selectedOrg.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.deleted"), description: data.message });
        setShowDelete(false);
        loadOrganisations();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.deleteError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const copyLicenseKey = (key: string, orgId: number) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(orgId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const [sendingEmail, setSendingEmail] = useState<number | null>(null);

  const resendLicense = async (org: Organisation, resetPassword = false) => {
    if (!org.email) {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.noEmailForOrg"), variant: "destructive" });
      return;
    }
    if (resetPassword && !(await confirmAction({ title: t("organisationsPage.confirm.resetPasswordTitle"), description: t("organisationsPage.confirm.resetPasswordDesc", { name: org.name }), confirmLabel: t("organisationsPage.confirm.resetPasswordLabel"), destructive: true }))) return;
    setSendingEmail(org.id);
    try {
      const res = await fetch(`${BASE}api/organisations/${org.id}/resend-license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resetPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.emailSent"), description: data.message || t("organisationsPage.toast.licenseSentTo", { email: org.email }) });
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.sendError"), variant: "destructive" });
    } finally {
      setSendingEmail(null);
    }
  };

  /**
   * Brouillons de factures SaaS.
   *
   * La generation produit des factures au statut `brouillon`; elles ne
   * deviennent exigibles qu'une fois validees. Les deux routes existaient
   * (liste + validation, reservees au super-admin) mais n'etaient appelees par
   * aucune page: les brouillons s'accumulaient sans qu'on puisse ni les voir ni
   * les valider depuis l'application.
   */
  const loadInvoiceDrafts = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}api/organisations/invoice-drafts`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setInvoiceDrafts(data.drafts || []);
      }
    } catch {
      /* la section reste vide, sans message trompeur */
    }
  }, []);

  useEffect(() => { loadInvoiceDrafts(); }, [loadInvoiceDrafts]);

  const validateInvoiceDrafts = async (ids?: number[]) => {
    setValidatingDrafts(true);
    try {
      const res = await fetch(`${BASE}api/organisations/invoice-drafts/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(ids ? { ids } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
        return;
      }
      toast({ title: t("organisationsPage.toast.draftsValidated", { count: data.validated }), description: t("organisationsPage.toast.draftsValidatedDesc") });
      loadInvoiceDrafts();
      loadBillingSummary();
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.validationError"), variant: "destructive" });
    } finally {
      setValidatingDrafts(false);
    }
  };

  const handleGenerateInvoices = async () => {
    setGenerating(true);
    try {
      const now = new Date();
      const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
      const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const res = await fetch(`${BASE}api/billing/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ year: prevYear, month: prevMonth }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.invoicesGenerated"), description: data.message });
        loadBillingSummary();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.generationError"), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleUploadBank = async () => {
    if (!bankLines.trim()) return;
    setUploading(true);
    try {
      const lines = bankLines.trim().split("\n").map(line => {
        const parts = line.split(/[;\t,]/).map(p => p.trim());
        return {
          date: parts[0] || null,
          payerName: parts[1] || null,
          ref: parts[2] || null,
          amount: parseFloat(parts[3] || "0") || 0,
          iban: parts[4] || null,
        };
      }).filter(l => l.amount > 0);

      if (lines.length === 0) {
        toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.noValidLines"), variant: "destructive" });
        setUploading(false);
        return;
      }

      const res = await fetch(`${BASE}api/billing/upload-bank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lines }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.importSuccess"), description: data.message });
        setBankLines("");
        setShowUpload(false);
        loadBillingSummary();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.importError"), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleMatchPayments = async () => {
    setMatching(true);
    try {
      const res = await fetch(`${BASE}api/billing/match-payments`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.reconciliation"), description: data.message });
        loadBillingSummary();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.reconciliationError"), variant: "destructive" });
    } finally {
      setMatching(false);
    }
  };

  const updateInvoiceStatus = async (invoiceId: number, status: string) => {
    const labels: Record<string, string> = { payee: t("organisationsPage.confirm.invoicePayee"), retard: t("organisationsPage.confirm.invoiceRetard"), annulee: t("organisationsPage.confirm.invoiceAnnulee") };
    if (!(await confirmAction({ title: t("organisationsPage.confirm.statusChangeTitle"), description: t("organisationsPage.confirm.statusChangeDesc", { action: labels[status] || t("organisationsPage.confirm.invoiceDefault") }), confirmLabel: t("organisationsPage.confirm.statusChangeLabel"), destructive: status === "annulee" }))) return;
    try {
      const res = await fetch(`${BASE}api/billing/invoices/${invoiceId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("organisationsPage.toast.statusUpdated"), description: data.message });
        if (billingOrg) openBilling(billingOrg);
        loadBillingSummary();
      } else {
        toast({ title: t("organisationsPage.toast.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("organisationsPage.toast.error"), description: t("organisationsPage.toast.genericError"), variant: "destructive" });
    }
  };

  const filtered = organisations.filter(o =>
    o.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: organisations.length,
    active: organisations.filter(o => o.actif).length,
    trial: organisations.filter(o => o.subscription?.plan === "essai").length,
    paid: organisations.filter(o => o.subscription && o.subscription.plan !== "essai").length,
  };

  function UsageBar({ label, current, max, icon }: { label: string; current: number; max: number; icon: React.ReactNode }) {
    const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
    const isOver = current > max;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">{icon}{label}</span>
          <span className={isOver ? "text-red-600 font-semibold" : "text-muted-foreground"}>
            {current.toLocaleString()} / {max.toLocaleString()}
            {isOver && <span className="ml-1">(+{(current - max).toLocaleString()})</span>}
          </span>
        </div>
        <Progress value={pct} className={`h-1.5 ${isOver ? "[&>div]:bg-red-500" : pct > 80 ? "[&>div]:bg-amber-500" : ""}`} />
      </div>
    );
  }

  if (!isSuperAdmin()) return <AccessDenied message={t("organisationsPage.accessDenied")} />;

  return (
    <div className="space-y-6 p-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0f1729] via-[#1a2744] to-[#0f1729] p-8">
        <img src={orgBanner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10" />
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Icon3D icon={Building2} variant="amber" size="lg" />
            <div>
              <h1 className="text-2xl font-bold text-white">{t("organisationsPage.header.title")}</h1>
              <p className="text-white/60 mt-1">{t("organisationsPage.header.subtitle")}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => { loadOrganisations(); loadBillingSummary(); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t("organisationsPage.header.refresh")}
            </Button>
            <Button variant="outline" size="icon" className="border-white/20 text-white hover:bg-white/10" title={t("organisationsPage.header.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-black" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              {t("organisationsPage.header.newOrg")}
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v === "saas") loadSaasMetrics(); }}>
        <TabsList>
          <TabsTrigger value="saas" className="gap-2"><Activity className="w-4 h-4" />{t("organisationsPage.tabs.saas")}</TabsTrigger>
          <TabsTrigger value="organisations" className="gap-2"><Building2 className="w-4 h-4" />{t("organisationsPage.tabs.licences")}</TabsTrigger>
          <TabsTrigger value="facturation" className="gap-2"><Receipt className="w-4 h-4" />{t("organisationsPage.tabs.facturation")}</TabsTrigger>
          <TabsTrigger value="juridique" className="gap-2"><Scale className="w-4 h-4" />{t("organisationsPage.tabs.juridique")}</TabsTrigger>
        </TabsList>

        <TabsContent value="saas" className="space-y-6 mt-4">
          {/* Ce qui demande une action, toutes organisations confondues.
              Lecture seule (phase 1): la liste priorisee des situations a
              trancher. L'agent autonome (phase 2) proposera les actions
              correspondantes dans la file d'approbation. */}
          {attention && attention.total > 0 && (
            <Card className="border-amber-200 dark:border-amber-900/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  {t("organisationsPage.attention.title", { total: attention.total })}
                </CardTitle>
                <CardDescription>
                  {attention.bySeverity.critique > 0 && t("organisationsPage.attention.critique", { count: attention.bySeverity.critique })}
                  {attention.bySeverity.haute > 0 && t("organisationsPage.attention.haute", { count: attention.bySeverity.haute })}
                  {t("organisationsPage.attention.desc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {attention.items.slice(0, 20).map((it: any, i: number) => {
                  const sev: Record<string, string> = {
                    critique: "text-red-700 border-red-200 bg-red-50 dark:bg-red-950/30",
                    haute: "text-amber-700 border-amber-200 bg-amber-50 dark:bg-amber-950/30",
                    moyenne: "text-blue-700 border-blue-200 bg-blue-50 dark:bg-blue-950/30",
                    basse: "text-muted-foreground",
                  };
                  const catLabel: Record<string, string> = {
                    trial_expiring: t("organisationsPage.attention.cat.trial_expiring"),
                    trial_expired: t("organisationsPage.attention.cat.trial_expired"),
                    payment_failed: t("organisationsPage.attention.cat.payment_failed"),
                    subscription_past_due: t("organisationsPage.attention.cat.subscription_past_due"),
                    quota_breach: t("organisationsPage.attention.cat.quota_breach"),
                    overdue_saas_invoice: t("organisationsPage.attention.cat.overdue_saas_invoice"),
                    suspended: t("organisationsPage.attention.cat.suspended"),
                  };
                  return (
                    <div key={i} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-[10px] ${sev[it.severity] ?? ""}`}>
                            {catLabel[it.category] ?? it.category}
                          </Badge>
                          <span className="text-sm font-medium truncate">{it.organisationName}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{it.detail} — <span className="italic">{it.suggestedAction}</span></p>
                      </div>
                      <Button variant="ghost" size="sm" className="shrink-0" onClick={() => { const org = organisations.find(o => o.id === it.organisationId); if (org) openEdit(org); }}>
                        {t("organisationsPage.attention.open")}
                      </Button>
                    </div>
                  );
                })}
                {attention.total > 20 && (
                  <p className="text-xs text-muted-foreground pt-1">{t("organisationsPage.attention.more", { count: attention.total - 20 })}</p>
                )}
              </CardContent>
            </Card>
          )}
          {saasLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : saasMetrics ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-emerald-600 font-medium">{t("organisationsPage.saas.mrr")}</p>
                      <DollarSign className="w-4 h-4 text-emerald-600" />
                    </div>
                    <p className="text-2xl font-bold text-emerald-700">{saasMetrics.mrr.toFixed(0)} EUR</p>
                    <p className="text-[11px] text-emerald-600/70 mt-0.5">{t("organisationsPage.saas.arr", { value: saasMetrics.arr.toFixed(0) })}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-muted-foreground font-medium">{t("organisationsPage.saas.paidCustomers")}</p>
                      <Crown className="w-4 h-4 text-amber-500" />
                    </div>
                    <p className="text-2xl font-bold">{saasMetrics.paidCustomers}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t("organisationsPage.saas.ofCustomers", { total: saasMetrics.totalCustomers })}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-muted-foreground font-medium">{t("organisationsPage.saas.inTrial")}</p>
                      <Clock className="w-4 h-4 text-blue-500" />
                    </div>
                    <p className="text-2xl font-bold">{saasMetrics.trialCustomers}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t("organisationsPage.saas.trialExpiring", { count: saasMetrics.trialExpiringSoon?.length || 0 })}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-muted-foreground font-medium">{t("organisationsPage.saas.conversionRate")}</p>
                      <Percent className="w-4 h-4 text-purple-500" />
                    </div>
                    <p className="text-2xl font-bold">{saasMetrics.conversionRate}%</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t("organisationsPage.saas.suspendedCount", { count: saasMetrics.suspendedCustomers })}</p>
                  </CardContent>
                </Card>
              </div>

              {saasMetrics.trialExpiringSoon?.length > 0 && (
                <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-950/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                      {t("organisationsPage.saas.trialsExpiringTitle", { count: saasMetrics.trialExpiringSoon.length })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {saasMetrics.trialExpiringSoon.map((trial: any) => (
                      <div key={trial.id} className="flex items-center justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-amber-200 dark:bg-amber-900 flex items-center justify-center text-amber-800 font-bold text-xs">
                            {trial.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{trial.name}</p>
                            <p className="text-xs text-muted-foreground">{trial.email || t("organisationsPage.saas.noEmail")}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                            {t("organisationsPage.saas.daysLeft", { days: trial.daysLeft })}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-amber-700"
                            onClick={() => { const org = organisations.find(o => o.id === trial.id); if (org) openPlanChange(org); }}
                          >
                            <Crown className="w-3.5 h-3.5 mr-1" />
                            {t("organisationsPage.saas.convert")}
                          </Button>
                          {trial.email && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { const org = organisations.find(o => o.id === trial.id); if (org) resendLicense(org); }}
                              disabled={sendingEmail === trial.id}
                            >
                              {sendingEmail === trial.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                              {t("organisationsPage.saas.remind")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2"><Target className="w-4 h-4" />{t("organisationsPage.saas.plansDistribution")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { key: "essai", label: "Essai Gratuit", color: "bg-gray-400", price: 0 },
                      { key: "starter", label: "Starter", color: "bg-blue-500", price: 29 },
                      { key: "professionnel", label: "Professionnel", color: "bg-purple-500", price: 79 },
                      { key: "entreprise", label: "Entreprise", color: "bg-amber-500", price: 199 },
                    ].map(plan => {
                      const count = saasMetrics.planDistribution?.[plan.key] || 0;
                      const total = Object.values(saasMetrics.planDistribution || {}).reduce((a: number, b: any) => a + b, 0) as number;
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={plan.key} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div className={`w-2.5 h-2.5 rounded-full ${plan.color}`} />
                              <span>{t("organisationsPage.plans." + plan.key)}</span>
                              {plan.price > 0 && <span className="text-xs text-muted-foreground">{t("organisationsPage.saas.perMonth", { price: plan.price })}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{count}</span>
                              <span className="text-xs text-muted-foreground">({pct}%)</span>
                            </div>
                          </div>
                          <Progress value={pct} className={`h-1.5 ${plan.key === "entreprise" ? "[&>div]:bg-amber-500" : plan.key === "professionnel" ? "[&>div]:bg-purple-500" : plan.key === "starter" ? "[&>div]:bg-blue-500" : "[&>div]:bg-gray-400"}`} />
                        </div>
                      );
                    })}
                    <Separator />
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span>{t("organisationsPage.saas.pendingRevenue")}</span>
                      <span className={saasMetrics.pendingRevenue?.total > 0 ? "text-amber-600" : "text-emerald-600"}>
                        {t("organisationsPage.saas.pendingRevenueValue", { amount: saasMetrics.pendingRevenue?.total?.toFixed(2) || "0.00", count: saasMetrics.pendingRevenue?.count || 0 })}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2"><UserPlus className="w-4 h-4" />{t("organisationsPage.saas.newCustomers")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {saasMetrics.recentSignups?.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">{t("organisationsPage.saas.noNewCustomers")}</p>
                    ) : (
                      <div className="space-y-2">
                        {saasMetrics.recentSignups?.slice(0, 6).map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between py-1.5">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#1a2744] to-[#0f1729] flex items-center justify-center text-white font-bold text-[10px]">
                                {s.name.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-medium">{s.name}</p>
                                <p className="text-[11px] text-muted-foreground">{new Date(s.createdAt).toLocaleDateString("fr-FR")}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge className={`text-[10px] ${PLAN_COLORS[s.plan] || ""}`}>{s.plan}</Badge>
                              {!s.actif && <Badge variant="secondary" className="text-[10px]">{t("organisationsPage.saas.suspendedBadge")}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {saasMetrics.revenueTrend?.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" />{t("organisationsPage.saas.revenueCollected")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2 h-32">
                      {(() => {
                        const trend = saasMetrics.revenueTrend as { month: string; revenue: number; invoices: number }[];
                        const max = Math.max(...trend.map(m => m.revenue), 1);
                        return trend.map(m => (
                          <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-[10px] text-muted-foreground font-medium">{m.revenue > 0 ? `${m.revenue.toFixed(0)}€` : ""}</span>
                            <div
                              className="w-full rounded-t bg-emerald-500 dark:bg-emerald-600 min-h-[4px] transition-all"
                              style={{ height: `${Math.max(4, (m.revenue / max) * 96)}px` }}
                            />
                            <span className="text-[10px] text-muted-foreground">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </CardContent>
                </Card>
              )}

              {saasMetrics.suspendedOrgs?.length > 0 && (
                <Card className="border-red-200 dark:border-red-900 bg-red-50/20 dark:bg-red-950/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-red-600 dark:text-red-400">
                      <Pause className="w-4 h-4" />
                      {t("organisationsPage.saas.suspendedOrgs", { count: saasMetrics.suspendedOrgs.length })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {saasMetrics.suspendedOrgs.map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-red-200 dark:border-red-900">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-700 font-bold text-xs">
                            {s.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{s.name}</p>
                            <p className="text-xs text-muted-foreground">{t("organisationsPage.saas.planEmail", { email: s.email || t("organisationsPage.saas.noEmail"), plan: s.plan })}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-emerald-600 hover:text-emerald-700"
                          onClick={() => { const org = organisations.find(o => o.id === s.id); if (org) handleToggleStatus(org); }}
                          disabled={togglingId === s.id}
                        >
                          {togglingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                          {t("organisationsPage.saas.reactivate")}
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-center">
                <Button variant="outline" onClick={loadSaasMetrics} disabled={saasLoading}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${saasLoading ? "animate-spin" : ""}`} />
                  {t("organisationsPage.saas.refreshMetrics")}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <Activity className="w-12 h-12 opacity-30" />
              <Button variant="outline" onClick={loadSaasMetrics}>{t("organisationsPage.saas.loadMetrics")}</Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="organisations" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30"><Building2 className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.stats.total")}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle2 className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{stats.active}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.stats.active")}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800"><AlertTriangle className="w-5 h-5 text-gray-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{stats.trial}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.stats.trial")}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30"><Crown className="w-5 h-5 text-amber-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{stats.paid}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.stats.paid")}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t("organisationsPage.licences.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Badge variant="outline">{t("organisationsPage.licences.orgCount", { count: filtered.length })}</Badge>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Building2 className="w-16 h-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-semibold mb-2">{searchTerm ? t("organisationsPage.licences.emptyResultTitle") : t("organisationsPage.licences.emptyTitle")}</h3>
                <p className="text-muted-foreground mb-4">{searchTerm ? t("organisationsPage.licences.emptyResultDesc") : t("organisationsPage.licences.emptyDesc")}</p>
                {!searchTerm && (
                  <Button onClick={openCreate}>
                    <Plus className="w-4 h-4 mr-2" />
                    {t("organisationsPage.licences.createOrg")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filtered.map((org) => (
                <Card key={org.id} className={`transition-all hover:shadow-md ${!org.actif ? "opacity-60" : ""}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#1a2744] to-[#0f1729] flex items-center justify-center text-white font-bold text-sm">
                          {org.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            {org.name}
                            {org.id === 1 && <Crown className="w-4 h-4 text-amber-500" />}
                          </CardTitle>
                          <CardDescription className="text-xs font-mono">{org.slug}</CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={org.actif ? "default" : "secondary"}>
                          {org.actif ? t("organisationsPage.licences.active") : t("organisationsPage.licences.inactive")}
                        </Badge>
                        {org.subscription && (
                          <Badge className={PLAN_COLORS[org.subscription.plan] || ""}>
                            {org.subscription.planDetails?.name || org.subscription.plan}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {org.email && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="w-3.5 h-3.5" />
                          <span className="truncate">{org.email}</span>
                        </div>
                      )}
                      {org.phone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="w-3.5 h-3.5" />
                          {org.phone}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="w-3.5 h-3.5" />
                        {t("organisationsPage.licences.usersCount", { count: org.userCount, max: org.maxUsers })}
                      </div>
                      {org.subscription && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Package className="w-3.5 h-3.5" />
                          {Number(org.subscription.price) > 0 ? t("organisationsPage.saas.perMonth", { price: org.subscription.price }) : t("organisationsPage.licences.free")}
                        </div>
                      )}
                    </div>

                    {org.subscription && org.subscription.plan !== "essai" && (
                      <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" />{t("organisationsPage.licences.usageTitle")}</span>
                        </div>
                        <UsageBar label={t("organisationsPage.licences.usageUsers")} current={org.userCount} max={org.maxUsers} icon={<Users className="w-3 h-3" />} />
                        <UsageBar label={t("organisationsPage.licences.usageContacts")} current={org.contactCount} max={org.subscription.maxContacts} icon={<Phone className="w-3 h-3" />} />
                        <UsageBar label={t("organisationsPage.licences.usageCalls")} current={org.callCount} max={org.subscription.maxCallsPerMonth} icon={<Phone className="w-3 h-3" />} />
                      </div>
                    )}

                    {org.subscription?.licenseKey && (
                      <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                        <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <code className="text-xs font-mono flex-1 truncate">{org.subscription.licenseKey}</code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => copyLicenseKey(org.subscription!.licenseKey!, org.id)}
                        >
                          {copiedKey === org.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    )}

                    {org.subscription?.isTrialExpired && (
                      <div className="flex items-center gap-2 p-2 rounded bg-red-50 dark:bg-red-950/20 text-red-600 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t("organisationsPage.licences.trialExpired")}
                      </div>
                    )}

                    <div className="flex items-center gap-1 flex-wrap">
                      {org.subscription?.aiEnabled && (
                        <Badge variant="outline" className="text-xs"><Brain className="w-3 h-3 mr-1" />{t("organisationsPage.licences.aiBadge")}</Badge>
                      )}
                      {org.subscription?.automationEnabled && (
                        <Badge variant="outline" className="text-xs"><Zap className="w-3 h-3 mr-1" />{t("organisationsPage.licences.autoBadge")}</Badge>
                      )}
                    </div>

                    <Separator />

                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      {org.subscription && org.subscription.plan !== "essai" && (
                        <Button variant="outline" size="sm" onClick={() => openBilling(org)} className="text-emerald-600 hover:text-emerald-700">
                          <Receipt className="w-3.5 h-3.5 mr-1" />
                          {t("organisationsPage.licences.billing")}
                        </Button>
                      )}
                      {org.email && org.subscription?.licenseKey && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resendLicense(org)}
                            disabled={sendingEmail === org.id}
                            className="text-amber-600 hover:text-amber-700"
                          >
                            {sendingEmail === org.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                            {t("organisationsPage.licences.sendLicense")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resendLicense(org, true)}
                            disabled={sendingEmail === org.id}
                            className="text-blue-600 hover:text-blue-700"
                          >
                            {sendingEmail === org.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Key className="w-3.5 h-3.5 mr-1" />}
                            {t("organisationsPage.licences.resetPassword")}
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" onClick={() => openPlanChange(org)}>
                        <Shield className="w-3.5 h-3.5 mr-1" />
                        {t("organisationsPage.licences.changePlan")}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(org)}>
                        <Edit className="w-3.5 h-3.5 mr-1" />
                        {t("organisationsPage.licences.edit")}
                      </Button>
                      {org.id !== 1 && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setLicenseDialog({ org, action: "extend-trial" }); setTrialDays("14"); }}
                            title={t("organisationsPage.licences.extendTrialTitle")}
                          >
                            <Clock className="w-3.5 h-3.5 mr-1" />
                            {t("organisationsPage.licences.extendTrial")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setLicenseDialog({ org, action: "suspend" }); setConfirmOrgName(""); }}
                            className="text-amber-600 hover:text-amber-700"
                            title={t("organisationsPage.licences.suspendSubTitle")}
                          >
                            <Pause className="w-3.5 h-3.5 mr-1" />
                            {t("organisationsPage.licences.suspendSub")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLicenseDialog({ org, action: "reactivate" })}
                            className="text-emerald-600 hover:text-emerald-700"
                            title={t("organisationsPage.licences.reactivateTitle")}
                          >
                            <Play className="w-3.5 h-3.5 mr-1" />
                            {t("organisationsPage.licences.reactivate")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setLicenseDialog({ org, action: "regenerate-key" }); setConfirmOrgName(""); }}
                            title={t("organisationsPage.licences.newKeyTitle")}
                          >
                            <Key className="w-3.5 h-3.5 mr-1" />
                            {t("organisationsPage.licences.newKey")}
                          </Button>
                          {/* Export complet des donnees de l'organisation
                              (portabilite RGPD). Route GET: un simple lien
                              suffit, le navigateur telecharge le fichier. */}
                          <Button variant="outline" size="sm" asChild title={t("organisationsPage.licences.exportTitle")}>
                            <a href={`${BASE}api/license-management/orgs/${org.id}/export`}>
                              <Download className="w-3.5 h-3.5 mr-1" />
                              {t("organisationsPage.licences.export")}
                            </a>
                          </Button>
                        </>
                      )}
                      {org.id !== 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className={org.actif ? "text-amber-600 hover:text-amber-700" : "text-emerald-600 hover:text-emerald-700"}
                          onClick={() => handleToggleStatus(org)}
                          disabled={togglingId === org.id}
                          title={org.actif ? t("organisationsPage.licences.suspendAccessTitle") : t("organisationsPage.licences.reactivateAccessTitle")}
                        >
                          {togglingId === org.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : org.actif ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </Button>
                      )}
                      {org.id !== 1 && (
                        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => { setSelectedOrg(org); setShowDelete(true); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="facturation" className="space-y-4 mt-4">
          {invoiceDrafts.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-900/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-4 h-4 text-amber-600" />
                      {t("organisationsPage.facturation.draftsTitle", { count: invoiceDrafts.length })}
                    </CardTitle>
                    <CardDescription>
                      {t("organisationsPage.facturation.draftsDesc")}
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={() => validateInvoiceDrafts()} disabled={validatingDrafts}>
                    {validatingDrafts && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                    {t("organisationsPage.facturation.validateAll")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {invoiceDrafts.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.organisationName ?? t("organisationsPage.facturation.orgFallback", { id: d.organisationId })}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("organisationsPage.facturation.draftLine", { period: d.periodLabel, plan: d.plan, amount: Number(d.totalAmount).toFixed(2), currency: d.currency ?? "EUR" })}
                        {Number(d.overageAmount) > 0 && t("organisationsPage.facturation.draftOverage", { amount: Number(d.overageAmount).toFixed(2) })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => validateInvoiceDrafts([d.id])}
                      disabled={validatingDrafts}
                    >
                      {t("organisationsPage.facturation.validate")}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30"><Clock className="w-5 h-5 text-yellow-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{billingSummary ? `${Number(billingSummary.totalDue).toFixed(0)} EUR` : "..."}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.facturation.pendingInvoices", { count: billingSummary?.totalDueCount || 0 })}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle2 className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{billingSummary ? `${Number(billingSummary.totalPaid).toFixed(0)} EUR` : "..."}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.facturation.paidCount", { count: billingSummary?.totalPaidCount || 0 })}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30"><AlertCircle className="w-5 h-5 text-red-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{billingSummary ? `${Number(billingSummary.overdue).toFixed(0)} EUR` : "..."}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.facturation.overdueCount", { count: billingSummary?.overdueCount || 0 })}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30"><ArrowUpDown className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{billingSummary?.pendingPayments || 0}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.facturation.paymentsToReconcile")}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleGenerateInvoices} disabled={generating} className="bg-emerald-600 hover:bg-emerald-700">
              {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Receipt className="w-4 h-4 mr-2" />}
              {t("organisationsPage.facturation.generateMonth")}
            </Button>
            <Button variant="outline" onClick={() => setShowUpload(true)}>
              <Upload className="w-4 h-4 mr-2" />
              {t("organisationsPage.facturation.importBank")}
            </Button>
            <Button variant="outline" onClick={handleMatchPayments} disabled={matching}>
              {matching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowUpDown className="w-4 h-4 mr-2" />}
              {t("organisationsPage.facturation.autoReconcile")}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><FileText className="w-5 h-5" />{t("organisationsPage.facturation.invoicesByOrg")}</CardTitle>
              <CardDescription>{t("organisationsPage.facturation.invoicesByOrgDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {organisations.filter(o => o.subscription && o.subscription.plan !== "essai").map(org => (
                  <div key={org.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[#1a2744] to-[#0f1729] flex items-center justify-center text-white font-bold text-xs">
                        {org.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{t("organisationsPage.facturation.planPerMonth", { plan: org.subscription?.planDetails?.name ?? "", price: org.subscription?.price ?? "" })}</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openBilling(org)}>
                      <Receipt className="w-3.5 h-3.5 mr-1" />
                      {t("organisationsPage.facturation.viewInvoices")}
                    </Button>
                  </div>
                ))}
                {organisations.filter(o => o.subscription && o.subscription.plan !== "essai").length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">{t("organisationsPage.facturation.noPaidOrg")}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="juridique" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><ShieldCheck className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{legalSummary?.compliantOrgs ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.juridique.compliant")}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{legalSummary?.nonCompliantOrgs ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.juridique.nonCompliant")}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30"><Scale className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{legalSummary?.complianceRate ?? 0}%</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.juridique.complianceRate")}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30"><FileCheck className="w-5 h-5 text-purple-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{legalSummary?.mandatoryDocuments ?? 0}/{legalSummary?.totalDocuments ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{t("organisationsPage.juridique.mandatoryDocs")}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {legalSummary && legalSummary.nonCompliantOrgs > 0 && (
            <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/10">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                      {t("organisationsPage.juridique.nonCompliantAlert", { count: legalSummary.nonCompliantOrgs })}
                    </p>
                    <p className="text-xs text-red-600/80 dark:text-red-400/60 mt-0.5">
                      {t("organisationsPage.juridique.nonCompliantAlertDesc")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="w-5 h-5" />
                {t("organisationsPage.juridique.complianceByOrg")}
              </CardTitle>
              <CardDescription>
                {t("organisationsPage.juridique.complianceByOrgDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {legalLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {legalCompliance.map(org => (
                    <div
                      key={org.id}
                      className={`border rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow ${
                        org.isCompliant
                          ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10"
                          : "border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10"
                      }`}
                      onClick={() => openLegalDetail(org)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full ${org.isCompliant ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                            {org.isCompliant
                              ? <ShieldCheck className="w-5 h-5 text-emerald-600" />
                              : <AlertTriangle className="w-5 h-5 text-red-600" />
                            }
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{org.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {t("organisationsPage.juridique.docsAccepted", { accepted: org.acceptedCount, total: org.totalDocuments })}
                              {org.missingDocuments.length > 0 && (
                                <span className="text-red-600 ml-2">
                                  {t("organisationsPage.juridique.missingMandatory", { count: org.missingDocuments.length })}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <Badge className={org.isCompliant
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }>
                              {org.isCompliant ? t("organisationsPage.juridique.compliantBadge") : t("organisationsPage.juridique.nonCompliantBadge")}
                            </Badge>
                          </div>
                          <div className="w-16">
                            <Progress value={org.compliancePercent} className={`h-2 ${org.isCompliant ? "" : "[&>div]:bg-red-500"}`} />
                            <p className="text-[10px] text-center text-muted-foreground mt-0.5">{org.compliancePercent}%</p>
                          </div>
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  ))}
                  {legalCompliance.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">{t("organisationsPage.juridique.noOrgFound")}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="w-5 h-5" />
                {t("organisationsPage.juridique.requiredDocs")}
              </CardTitle>
              <CardDescription>
                {t("organisationsPage.juridique.requiredDocsDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { code: "cgu", title: "CGU", desc: "Conditions Generales d'Utilisation", icon: FileText, cat: "Usage", mandatory: true },
                  { code: "cgv", title: "CGV", desc: "Conditions Generales de Vente", icon: Receipt, cat: "Commercial", mandatory: true },
                  { code: "rgpd", title: "RGPD", desc: "Politique de Confidentialite", icon: Lock, cat: "Confidentialite", mandatory: true },
                  { code: "dpa", title: "DPA", desc: "Accord de Traitement des Donnees", icon: Shield, cat: "Confidentialite", mandatory: true },
                  { code: "sla", title: "SLA", desc: "Contrat de Niveau de Service", icon: Clock, cat: "Service", mandatory: false },
                  { code: "propriete", title: "Propriete Intellectuelle", desc: "Licence de Propriete Intellectuelle", icon: Key, cat: "Legal", mandatory: true },
                  { code: "securite", title: "Securite", desc: "Politique de Securite des Donnees", icon: ShieldCheck, cat: "Securite", mandatory: false },
                ].map(doc => (
                  <div key={doc.code} className="border rounded-lg p-3 flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 shrink-0">
                      <doc.icon className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{doc.code === "propriete" ? t("organisationsPage.juridique.docs.proprieteTitle") : doc.code === "securite" ? t("organisationsPage.juridique.docs.securiteTitle") : doc.title}</p>
                        {doc.mandatory ? (
                          <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">{t("organisationsPage.juridique.mandatory")}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">{t("organisationsPage.juridique.optional")}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{t("organisationsPage.juridique.docs." + doc.code)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{t("organisationsPage.juridique.categoryVersion", { category: t("organisationsPage.juridique.cat." + doc.cat.toLowerCase()) })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Legal Detail Dialog */}
      <Dialog open={showLegalDetail} onOpenChange={setShowLegalDetail}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5" />
              {t("organisationsPage.legalDetail.title", { name: legalDetailOrg?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {legalDetailOrg?.isCompliant
                ? t("organisationsPage.legalDetail.compliantDesc")
                : t("organisationsPage.legalDetail.missingDesc", { count: legalDetailOrg?.missingDocuments.length ?? 0 })
              }
            </DialogDescription>
          </DialogHeader>

          {legalDetailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  {legalDetailOrg?.isCompliant
                    ? <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    : <AlertTriangle className="w-5 h-5 text-red-600" />
                  }
                  <span className="text-sm font-semibold">
                    {t("organisationsPage.legalDetail.docsAccepted", { accepted: legalDetailDocs.filter(d => d.status === "accepted").length, total: legalDetailDocs.length })}
                  </span>
                </div>
                {!legalDetailOrg?.isCompliant && legalDetailOrg && (
                  <Button size="sm" onClick={() => handleAcceptAll(legalDetailOrg.id)} disabled={acceptingAll}>
                    {acceptingAll ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileCheck className="w-3.5 h-3.5 mr-1" />}
                    {t("organisationsPage.legalDetail.acceptAll")}
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                {legalDetailDocs.map(doc => (
                  <div key={doc.code} className={`border rounded-lg p-4 ${
                    doc.status === "accepted"
                      ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10"
                      : doc.mandatory
                        ? "border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10"
                        : "border-gray-200 dark:border-gray-800"
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{doc.title}</p>
                          {doc.mandatory && (
                            <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">{t("organisationsPage.legalDetail.mandatory")}</Badge>
                          )}
                          <Badge className={doc.status === "accepted"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }>
                            {doc.status === "accepted" ? t("organisationsPage.legalDetail.accepted") : t("organisationsPage.legalDetail.pending")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{doc.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{t("organisationsPage.legalDetail.versionCategory", { version: doc.version, category: doc.category })}</p>

                        {doc.agreement && (
                          <div className="mt-2 p-2 rounded bg-emerald-50 dark:bg-emerald-950/20 text-xs space-y-0.5">
                            <p className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> {t("organisationsPage.legalDetail.acceptedByLabel")} <strong>{doc.agreement.acceptedBy}</strong></p>
                            <p>{t("organisationsPage.legalDetail.dateLabel", { date: new Date(doc.agreement.acceptedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) })}</p>
                            <p>{t("organisationsPage.legalDetail.ipLabel", { ip: doc.agreement.acceptedIp })}</p>
                            {doc.agreement.notes && <p>{t("organisationsPage.legalDetail.notesLabel", { notes: doc.agreement.notes })}</p>}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0">
                        {doc.status === "accepted" ? (
                          <Button size="sm" variant="outline" className="text-red-600 text-xs" onClick={() => doc.agreement && handleRevokeLegal(doc.agreement.id, doc.title)}>
                            <XCircle className="w-3.5 h-3.5 mr-1" />
                            {t("organisationsPage.legalDetail.revoke")}
                          </Button>
                        ) : legalDetailOrg && (
                          <Button size="sm" className="text-xs" onClick={() => handleAcceptDocument(legalDetailOrg.id, doc.code)} disabled={acceptingLegal === doc.code}>
                            {acceptingLegal === doc.code ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                            {t("organisationsPage.legalDetail.accept")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Billing Detail Dialog */}
      <Dialog open={showBilling} onOpenChange={setShowBilling}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              {t("organisationsPage.billingDialog.title", { name: billingOrg?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {t("organisationsPage.billingDialog.subtitle", { plan: billingOrg?.subscription?.planDetails?.name ?? "", price: billingOrg?.subscription?.price ?? "" })}
            </DialogDescription>
          </DialogHeader>

          {billingLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : orgBilling ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900">
                  <p className="text-xs text-yellow-600">{t("organisationsPage.billingDialog.totalDue")}</p>
                  <p className="text-xl font-bold text-yellow-700">{orgBilling.totalDue} EUR</p>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
                  <p className="text-xs text-emerald-600">{t("organisationsPage.billingDialog.totalPaid")}</p>
                  <p className="text-xl font-bold text-emerald-700">{orgBilling.totalPaid} EUR</p>
                </div>
              </div>

              {orgBilling.invoices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>{t("organisationsPage.billingDialog.noInvoices")}</p>
                  <p className="text-xs mt-1">{t("organisationsPage.billingDialog.noInvoicesHint")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orgBilling.invoices.map(inv => (
                    <div key={inv.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">{t("organisationsPage.billingDialog.period", { period: inv.periodLabel })}</p>
                          <p className="text-xs text-muted-foreground">{t("organisationsPage.billingDialog.plan", { plan: inv.plan })}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={INVOICE_STATUS_COLORS[inv.status] || ""}>
                            {["en_attente", "payee", "partiel", "retard", "annulee"].includes(inv.status) ? t("organisationsPage.invoiceStatus." + inv.status) : inv.status}
                          </Badge>
                          <p className="font-bold text-lg">{Number(inv.totalAmount).toFixed(2)} EUR</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="p-2 rounded bg-muted/50">
                          <p className="text-muted-foreground">{t("organisationsPage.billingDialog.forfait")}</p>
                          <p className="font-semibold">{Number(inv.baseAmount).toFixed(2)} EUR</p>
                        </div>
                        <div className="p-2 rounded bg-muted/50">
                          <p className="text-muted-foreground">{t("organisationsPage.billingDialog.overage")}</p>
                          <p className={`font-semibold ${Number(inv.overageAmount) > 0 ? "text-red-600" : ""}`}>
                            {Number(inv.overageAmount).toFixed(2)} EUR
                          </p>
                        </div>
                        <div className="p-2 rounded bg-muted/50">
                          <p className="text-muted-foreground">{t("organisationsPage.billingDialog.total")}</p>
                          <p className="font-bold">{Number(inv.totalAmount).toFixed(2)} EUR</p>
                        </div>
                      </div>

                      {inv.usageSnapshot && (
                        <div className="space-y-1.5 p-2 rounded bg-muted/30">
                          <p className="text-xs font-semibold text-muted-foreground">{t("organisationsPage.billingDialog.usageTitle")}</p>
                          <UsageBar label={t("organisationsPage.billingDialog.usageUsers")} current={inv.usageSnapshot.users.current} max={inv.usageSnapshot.users.max} icon={<Users className="w-3 h-3" />} />
                          <UsageBar label={t("organisationsPage.billingDialog.usageContacts")} current={inv.usageSnapshot.contacts.current} max={inv.usageSnapshot.contacts.max} icon={<Phone className="w-3 h-3" />} />
                          <UsageBar label={t("organisationsPage.billingDialog.usageCalls")} current={inv.usageSnapshot.calls.current} max={inv.usageSnapshot.calls.max} icon={<Phone className="w-3 h-3" />} />
                          {inv.usageSnapshot.overageDetails && (Number(inv.overageAmount) > 0) && (
                            <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-950/20 text-xs text-red-600 space-y-0.5">
                              <p className="font-semibold">{t("organisationsPage.billingDialog.overageDetail")}</p>
                              {inv.usageSnapshot.overageDetails.extraUsers > 0 && (
                                <p>{t("organisationsPage.billingDialog.extraUsers", { count: inv.usageSnapshot.overageDetails.extraUsers, amount: inv.usageSnapshot.overageDetails.extraUsersAmount })}</p>
                              )}
                              {inv.usageSnapshot.overageDetails.extraContacts > 0 && (
                                <p>{t("organisationsPage.billingDialog.extraContacts", { count: inv.usageSnapshot.overageDetails.extraContacts, amount: inv.usageSnapshot.overageDetails.extraContactsAmount })}</p>
                              )}
                              {inv.usageSnapshot.overageDetails.extraCalls > 0 && (
                                <p>{t("organisationsPage.billingDialog.extraCalls", { count: inv.usageSnapshot.overageDetails.extraCalls, amount: inv.usageSnapshot.overageDetails.extraCallsAmount })}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {inv.status !== "payee" && inv.status !== "annulee" && (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => updateInvoiceStatus(inv.id, "payee")}>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />{t("organisationsPage.billingDialog.markPaid")}
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateInvoiceStatus(inv.id, "retard")}>
                            <AlertCircle className="w-3.5 h-3.5 mr-1" />{t("organisationsPage.billingDialog.markOverdue")}
                          </Button>
                          <Button size="sm" variant="outline" className="text-gray-500" onClick={() => updateInvoiceStatus(inv.id, "annulee")}>
                            <XCircle className="w-3.5 h-3.5 mr-1" />{t("organisationsPage.billingDialog.cancel")}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">{t("organisationsPage.billingDialog.noData")}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Bank Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              {t("organisationsPage.uploadDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("organisationsPage.uploadDialog.desc")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={bankLines}
            onChange={(e) => setBankLines(e.target.value)}
            placeholder={t("organisationsPage.uploadDialog.placeholder")}
            rows={8}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            {t("organisationsPage.uploadDialog.hint")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>{t("organisationsPage.uploadDialog.cancel")}</Button>
            <Button onClick={handleUploadBank} disabled={uploading || !bankLines.trim()}>
              {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {t("organisationsPage.uploadDialog.import")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              {t("organisationsPage.createDialog.title")}
            </DialogTitle>
            <DialogDescription>{t("organisationsPage.createDialog.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground"><Building2 className="w-4 h-4" /> {t("organisationsPage.createDialog.sectionOrg")}</h4>
              <div className="relative">
                <Label>{t("organisationsPage.createDialog.orgName")}</Label>
                <div className="relative">
                  <Input
                    value={formName}
                    onChange={(e) => handleFormNameChange(e.target.value)}
                    onFocus={() => { if (companyResults.length > 0) setCompanySearchOpen(true); }}
                    onBlur={() => setTimeout(() => setCompanySearchOpen(false), 150)}
                    placeholder={t("organisationsPage.createDialog.orgNamePlaceholder")}
                    autoComplete="off"
                  />
                  {companySearching && (
                    <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  )}
                </div>
                {companySearchOpen && companyResults.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                    {companyResults.map((c, i) => (
                      <button
                        key={`${c.siret}-${i}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectCompanyResult(c)}
                        className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex flex-col gap-0.5 border-b last:border-b-0"
                      >
                        <span className="font-medium">{c.nom}</span>
                        {c.adresse && <span className="text-xs text-muted-foreground">{c.adresse}</span>}
                        {c.dirigeant && <span className="text-[11px] text-muted-foreground/80">{t("organisationsPage.createDialog.director", { name: c.dirigeant })}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">{t("organisationsPage.createDialog.orgNameHint")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("organisationsPage.createDialog.phone")}</Label>
                  <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder={t("organisationsPage.createDialog.phonePlaceholder")} />
                </div>
                <div>
                  <Label>{t("organisationsPage.createDialog.contactEmail")}</Label>
                  <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder={t("organisationsPage.createDialog.contactEmailPlaceholder")} />
                </div>
              </div>
              <div>
                <Label>{t("organisationsPage.createDialog.address")}</Label>
                <Input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} placeholder={t("organisationsPage.createDialog.addressPlaceholder")} />
              </div>
              <div>
                <Label>{t("organisationsPage.createDialog.siret")}</Label>
                <Input value={formSiret} onChange={(e) => setFormSiret(e.target.value)} placeholder={t("organisationsPage.createDialog.siretPlaceholder")} />
              </div>
              <div>
                <Label>{t("organisationsPage.createDialog.licensePlan")}</Label>
                <Select value={formPlan} onValueChange={setFormPlan}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="essai">{t("organisationsPage.createDialog.planEssai")}</SelectItem>
                    <SelectItem value="starter">{t("organisationsPage.createDialog.planStarter")}</SelectItem>
                    <SelectItem value="professionnel">{t("organisationsPage.createDialog.planPro")}</SelectItem>
                    <SelectItem value="entreprise">{t("organisationsPage.createDialog.planEnterprise")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground"><Crown className="w-4 h-4" /> {t("organisationsPage.createDialog.sectionAdmin")}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("organisationsPage.createDialog.firstName")}</Label>
                  <Input value={formAdminPrenom} onChange={(e) => setFormAdminPrenom(e.target.value)} placeholder={t("organisationsPage.createDialog.firstNamePlaceholder")} />
                </div>
                <div>
                  <Label>{t("organisationsPage.createDialog.lastName")}</Label>
                  <Input value={formAdminNom} onChange={(e) => setFormAdminNom(e.target.value)} placeholder={t("organisationsPage.createDialog.lastNamePlaceholder")} />
                </div>
              </div>
              <div>
                <Label>{t("organisationsPage.createDialog.loginEmail")}</Label>
                <Input type="email" value={formAdminEmail} onChange={(e) => setFormAdminEmail(e.target.value)} placeholder={t("organisationsPage.createDialog.loginEmailPlaceholder")} />
              </div>
              <p className="text-[11px] text-muted-foreground">{t("organisationsPage.createDialog.adminHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("organisationsPage.createDialog.cancel")}</Button>
            <Button onClick={handleCreate} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {t("organisationsPage.createDialog.createSend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5" />
              {t("organisationsPage.editDialog.title", { name: selectedOrg?.name ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("organisationsPage.editDialog.name")}</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div>
              <Label>{t("organisationsPage.editDialog.email")}</Label>
              <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
            </div>
            <div>
              <Label>{t("organisationsPage.editDialog.phone")}</Label>
              <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
            </div>
            <div>
              <Label>{t("organisationsPage.editDialog.address")}</Label>
              <Input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <Label>{t("organisationsPage.editDialog.orgActive")}</Label>
              <Switch checked={formActif} onCheckedChange={setFormActif} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>{t("organisationsPage.editDialog.cancel")}</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t("organisationsPage.editDialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPlan} onOpenChange={setShowPlan}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              {t("organisationsPage.planDialog.title", { name: selectedOrg?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("organisationsPage.planDialog.current", { plan: selectedOrg?.subscription?.planDetails?.name || selectedOrg?.subscription?.plan || "" })}</DialogDescription>
          </DialogHeader>
          <div>
            <Label>{t("organisationsPage.planDialog.newPlan")}</Label>
            <Select value={formPlan} onValueChange={setFormPlan}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="essai">{t("organisationsPage.planDialog.planEssai")}</SelectItem>
                <SelectItem value="starter">{t("organisationsPage.planDialog.planStarter")}</SelectItem>
                <SelectItem value="professionnel">{t("organisationsPage.planDialog.planPro")}</SelectItem>
                <SelectItem value="entreprise">{t("organisationsPage.planDialog.planEnterprise")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPlan(false)}>{t("organisationsPage.planDialog.cancel")}</Button>
            <Button onClick={handlePlanChange} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t("organisationsPage.planDialog.change")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspension et regeneration de cle exigent la saisie exacte du nom de
          l'organisation: c'est le contrat impose par le serveur
          (`confirmOrgName`), et il protege d'une action sur la mauvaise ligne. */}
      <Dialog open={!!licenseDialog} onOpenChange={(o) => { if (!o) { setLicenseDialog(null); setConfirmOrgName(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {licenseDialog?.action === "extend-trial" && t("organisationsPage.licenseDialog.extendTitle")}
              {licenseDialog?.action === "suspend" && t("organisationsPage.licenseDialog.suspendTitle")}
              {licenseDialog?.action === "reactivate" && t("organisationsPage.licenseDialog.reactivateTitle")}
              {licenseDialog?.action === "regenerate-key" && t("organisationsPage.licenseDialog.regenerateTitle")}
            </DialogTitle>
            <DialogDescription>{licenseDialog?.org.name}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {licenseDialog?.action === "extend-trial" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("organisationsPage.licenseDialog.daysLabel")}</Label>
                <Input
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  className="w-32"
                />
              </div>
            )}

            {licenseDialog?.action === "suspend" && (
              <p className="text-xs text-muted-foreground">
                {t("organisationsPage.licenseDialog.suspendInfo")}
              </p>
            )}

            {licenseDialog?.action === "regenerate-key" && (
              <p className="text-xs text-amber-700">
                {t("organisationsPage.licenseDialog.regenerateInfo")}
              </p>
            )}

            {(licenseDialog?.action === "suspend" || licenseDialog?.action === "regenerate-key") && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t("organisationsPage.licenseDialog.confirmName1")} <strong>{licenseDialog.org.name}</strong> {t("organisationsPage.licenseDialog.confirmName2")}
                </Label>
                <Input value={confirmOrgName} onChange={(e) => setConfirmOrgName(e.target.value)} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setLicenseDialog(null); setConfirmOrgName(""); }}>
              {t("organisationsPage.licenseDialog.cancel")}
            </Button>
            <Button
              disabled={
                licenseBusy ||
                (licenseDialog?.action === "extend-trial" && !(Number(trialDays) >= 1 && Number(trialDays) <= 365)) ||
                ((licenseDialog?.action === "suspend" || licenseDialog?.action === "regenerate-key") &&
                  confirmOrgName.trim().toLowerCase() !== (licenseDialog?.org.name ?? "").toLowerCase())
              }
              onClick={() => {
                if (!licenseDialog) return;
                const body =
                  licenseDialog.action === "extend-trial"
                    ? { days: Number(trialDays) }
                    : licenseDialog.action === "suspend" || licenseDialog.action === "regenerate-key"
                      ? { confirmOrgName: confirmOrgName.trim() }
                      : {};
                runLicenseAction(licenseDialog.org, licenseDialog.action, body);
              }}
            >
              {licenseBusy && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t("organisationsPage.licenseDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              {t("organisationsPage.deleteDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("organisationsPage.deleteDialog.descBefore")} <strong>{selectedOrg?.name}</strong> {t("organisationsPage.deleteDialog.descAfter")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>{t("organisationsPage.deleteDialog.cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t("organisationsPage.deleteDialog.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
