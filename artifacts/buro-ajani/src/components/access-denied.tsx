import { Lock, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/i18n";

/**
 * Vue "Acces refuse" — affichee pour un utilisateur authentifie qui tente
 * d'acceder a une route reservee (ex: backoffice SaaS super-admin) sans le
 * role requis. Equivalent visuel d'un 403 cote serveur (qui reste la
 * defense definitive). Reutilisable pour tout futur module reserve.
 */
export function AccessDenied({
  title,
  message,
}: {
  title?: string;
  message?: string;
}) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("accessDenied.title");
  const resolvedMessage = message ?? t("accessDenied.message");
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
            <Lock className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{resolvedTitle}</h2>
            <p className="text-sm text-muted-foreground mt-2">{resolvedMessage}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/" className="inline-flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> {t("accessDenied.back")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
