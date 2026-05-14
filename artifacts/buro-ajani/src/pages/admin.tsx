import { useEffect } from "react";
import { useLocation } from "wouter";
import { Shield, Target, FileText, Receipt, Package, LayoutDashboard, ArrowRight } from "lucide-react";
import { useWorkspaceUser } from "@/components/workspace-user";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  const [, navigate] = useLocation();

  // Garde cote client. Le vrai garde-fou est cote serveur (requireSuperAdmin
  // sur les routes /api/admin/*). Ici on evite simplement d'afficher la
  // coquille a un utilisateur non-super-admin qui aurait tape l'URL a la main.
  useEffect(() => {
    if (user.role !== "super_admin") {
      navigate("/", { replace: true });
    }
  }, [user.role, navigate]);

  if (user.role !== "super_admin") return null;

  const modules = [
    {
      label: "Tableau de bord SaaS",
      description: "MRR, churn, conversion d'essai (à venir)",
      icon: LayoutDashboard,
      href: "/admin",
      status: "À venir",
      enabled: false,
    },
    {
      label: "Prospects",
      description: "Pipeline commercial — leads issus du site vitrine et du démarchage",
      icon: Target,
      href: "/prospects",
      status: "Actif",
      enabled: true,
    },
    {
      label: "Devis kurumsal",
      description: "Propositions commerciales B2B avec lien Stripe Checkout (à venir)",
      icon: FileText,
      href: "/admin",
      status: "À venir",
      enabled: false,
    },
    {
      label: "Factures B2B",
      description: "Factures Stripe d'abonnement + factures manuelles (à venir)",
      icon: Receipt,
      href: "/admin",
      status: "À venir",
      enabled: false,
    },
    {
      label: "Stock de licences",
      description: "Inventaire des packs de licences vendus / disponibles (à venir)",
      icon: Package,
      href: "/admin",
      status: "À venir",
      enabled: false,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            <h1 className="text-2xl font-semibold">Backoffice SaaS</h1>
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30">
              Super-admin
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Gestion commerciale d'Agent de Bureau — séparée de l'application client.
          </p>
        </div>
      </div>

      <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Refactor en cours
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Les modules <strong>Prospects</strong>, <strong>Devis</strong>, <strong>Stock</strong> et
            <strong> Factures B2B</strong> ont été retirés de l'application client. Ils sont désormais
            accessibles uniquement via ce panneau, à toi (super-admin).
          </p>
          <p>
            <strong>Statut actuel:</strong> seul Prospects est branché ici. Le reste arrivera dans les
            tâches de suivi (dashboard MRR, devis B2B, factures, stock, 2FA forcée, IP whitelist).
          </p>
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
                    Ouvrir <ArrowRight className="w-3 h-3 ml-1" />
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
