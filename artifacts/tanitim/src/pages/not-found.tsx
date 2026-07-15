import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";

export default function NotFound() {
  useDocumentMeta(PAGE_META.notFound);
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">Page introuvable</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            La page que vous cherchez n'existe pas ou a ete deplacee.
          </p>

          <a href="/" className="block mt-6">
            <Button className="w-full">Retour a l'accueil</Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
