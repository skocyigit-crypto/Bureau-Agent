import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useTranslation } from "@/i18n";
import { ArrowRight,ClipboardList,FileText,LayoutDashboard,Package,Receipt,Shield,Target } from "lucide-react";
import { useLocation } from "wouter";

/**
 * Backoffice SaaS — racine du panneau /admin.
 *
 * Reservé au super-admin (proprietaire SaaS). Centralise la gestion
 * commerciale du SaaS: prospects (leads marketing), devis kurumsal, factures
 * B2B, stock de licences, dashboard MRR/churn.
 *
 * Etat actuel: shell + dashboard placeholder + raccourcis vers les modules
 * existants (Prospects). Les modules Devis / Factures B2B / Stock /
 * Dashboard MRR seront branches dans les taches de suivi.
 */
export default function AdminBackofficePage() {
  const { user } = useWorkspaceUser();
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  // Garde cote client. Verrou definitif cote serveur (requireSuperAdmin sur
  // les routers prospects/devis/factures-client). Vue 403 si l'utilisateur
  // tape l'URL sans le bon role.
  if (user.role !== "super_admin") return <AccessDenied />;

  const statusActif = t("adminBackoffice.status.actif");
  const modules = [
    {
      label: t("adminBackoffice.modules.dashboard.label"),
      description: t("adminBackoffice.modules.dashboard.description"),
      icon: LayoutDashboard,
      href: "/admin/dashboard",
      status: statusActif,
      enabled: true,
    },
    {
      label: t("adminBackoffice.modules.prospects.label"),
      description: t("adminBackoffice.modules.prospects.description"),
      icon: Target,
      href: "/admin/prospects",
      status: statusActif,
      enabled: true,
    },
    {
      label: t("adminBackoffice.modules.devis.label"),
      description: t("adminBackoffice.modules.devis.description"),
      icon: FileText,
      href: "/admin/devis",
      status: statusActif,
      enabled: true,
    },
    {
      label: t("adminBackoffice.modules.facturesB2b.label"),
      description: t("adminBackoffice.modules.facturesB2b.description"),
      icon: Receipt,
      href: "/admin/factures-b2b",
      status: statusActif,
      enabled: true,
    },
    {
      label: t("adminBackoffice.modules.facturesClient.label"),
      description: t("adminBackoffice.modules.facturesClient.description"),
      icon: Receipt,
      href: "/admin/factures-client",
      status: statusActif,
      enabled: true,
    },
    {
      label: t("adminBackoffice.modules.audit.label"),
      description: t("adminBackoffice.modules.audit.description"),
      icon: ClipboardList,
      href: "/admin/audit",
      status: statusActif,
      enabled: true,
    },
    {
      label: t("adminBackoffice.modules.stock.label"),
      description: t("adminBackoffice.modules.stock.description"),
      icon: Package,
      href: "/admin",
      status: t("adminBackoffice.status.aVenir"),
      enabled: false,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            <h1 className="text-2xl font-semibold">{t("adminBackoffice.title")}</h1>
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30">
              {t("adminBackoffice.superAdmin")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t("adminBackoffice.subtitle")}
          </p>
        </div>
      </div>

      <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            {t("adminBackoffice.refactorTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>{t("adminBackoffice.refactorP1")}</p>
          <p>{t("adminBackoffice.refactorP2")}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <Card
              key={m.label}
              className={`transition-shadow ${m.enabled ? "hover:shadow-md cursor-pointer" : "opacity-60"}`}
              onClick={() => m.enabled && navigate(m.href)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <Icon className="w-8 h-8 text-primary" />
                  <Badge variant={m.enabled ? "default" : "secondary"}>{m.status}</Badge>
                </div>
                <CardTitle className="text-base mt-3">{m.label}</CardTitle>
                <CardDescription className="text-xs">{m.description}</CardDescription>
              </CardHeader>
              {m.enabled && (
                <CardContent className="pt-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(m.href);
                    }}
                  >
                    {t("adminBackoffice.open")} <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
