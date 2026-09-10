/**
 * Diagnostic du poste de travail.
 *
 * L'ecran suit exactement la forme de l'outil: on telecharge un script, on le
 * lance soi-meme, on relit le rapport si on veut, puis on le depose ici.
 *
 * Le fichier est lu DANS LE NAVIGATEUR et envoye a l'analyse; il n'est stocke
 * nulle part. Le journal d'audit ne garde que les codes des constats — le
 * detail du poste appartient a celui qui l'a envoye.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Download, FileUp, Hand, HelpCircle, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { useRef, useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type Gravite = "critique" | "elevee" | "moyenne" | "info";

interface Constat {
  code: string;
  gravite: Gravite;
  constat: string;
  pourquoi: string;
  remede: string;
}

interface EtapeRemise { code: string; explication: string; commande: string | null; administrateur: boolean }
interface Remise {
  etapes: EtapeRemise[];
  aLaMain: Array<{ code: string; consigne: string }>;
  script: string | null;
  administrateurRequis: boolean;
}

interface Diagnostic {
  constats: Constat[];
  nonMesure: string[];
  score: number;
  remise: Remise;
}

const COULEUR: Record<Gravite, string> = {
  critique: "border-red-500 bg-red-50 dark:bg-red-950/30",
  elevee: "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
  moyenne: "border-sky-500 bg-sky-50 dark:bg-sky-950/30",
  info: "border-border bg-muted/40",
};

export default function DiagnosticPostePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champFichier = useRef<HTMLInputElement>(null);

  const envoyer = async (fichier: File) => {
    setEnCours(true);
    try {
      const texte = await fichier.text();
      let rapport: unknown;
      try {
        rapport = JSON.parse(texte);
      } catch {
        // Le fichier a pu etre ouvert et reenregistre par un editeur, ou ce
        // n'est pas le bon fichier. Le dire precisement evite de chercher un
        // probleme de poste la ou il y a un probleme de fichier.
        toast({
          title: t("diagnosticPoste.toast.fichierIllisible"),
          description: t("diagnosticPoste.toast.fichierIllisibleDesc"),
          variant: "destructive",
        });
        return;
      }

      const res = await fetch(`${BASE}/api/diagnostic-poste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(rapport),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: t("diagnosticPoste.toast.echec"), description: d.error, variant: "destructive" });
        return;
      }
      setDiagnostic(await res.json());
    } catch {
      toast({ title: t("diagnosticPoste.toast.echec"), variant: "destructive" });
    } finally {
      setEnCours(false);
      if (champFichier.current) champFichier.current.value = "";
    }
  };

  const rienASignaler = diagnostic && diagnostic.constats.length === 0;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">{t("diagnosticPoste.titre")}</h1>
        <p className="text-muted-foreground mt-1">{t("diagnosticPoste.sousTitre")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {t("diagnosticPoste.commentTitre")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="space-y-2 list-decimal list-inside text-muted-foreground">
            <li>{t("diagnosticPoste.etape1")}</li>
            <li>{t("diagnosticPoste.etape2")}</li>
            <li>{t("diagnosticPoste.etape3")}</li>
          </ol>

          {/*
            Dit avant, pas apres. Quelqu'un a qui l'on demande de lancer un
            script sur son poste a le droit de savoir ce qu'il fait, sans avoir
            a lire le script — meme s'il peut aussi le lire, et c'est pour cela
            qu'on le lui donne en clair.
          */}
          <p className="text-xs border-l-2 pl-4 text-muted-foreground">
            {t("diagnosticPoste.garantie")}
          </p>

          <div className="flex flex-wrap gap-3">
            <a href={`${BASE}/outils/diagnostic-poste.ps1`} download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                {t("diagnosticPoste.telecharger")}
              </Button>
            </a>
            <Button size="sm" onClick={() => champFichier.current?.click()} disabled={enCours}>
              {enCours ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileUp className="h-4 w-4 mr-2" />}
              {t("diagnosticPoste.deposer")}
            </Button>
            <input
              ref={champFichier}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label={t("diagnosticPoste.deposer")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) envoyer(f);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {diagnostic && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{t("diagnosticPoste.note")}</p>
                <p className="text-4xl font-bold tabular-nums">{diagnostic.score}<span className="text-lg text-muted-foreground">/100</span></p>
              </div>
              {rienASignaler ? (
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              ) : (
                <AlertTriangle className="h-10 w-10 text-amber-500" />
              )}
            </CardContent>
          </Card>

          {rienASignaler && (
            <Card className="border-emerald-500">
              <CardContent className="pt-6 text-sm">{t("diagnosticPoste.rienASignaler")}</CardContent>
            </Card>
          )}

          {diagnostic.constats.map((c) => (
            <Card key={c.code} className={`border-l-4 ${COULEUR[c.gravite]}`}>
              <CardContent className="pt-6 space-y-2">
                <p className="font-semibold">{c.constat}</p>
                <p className="text-sm text-muted-foreground">{c.pourquoi}</p>
                <p className="text-sm font-medium">
                  {t("diagnosticPoste.aFaire")} {c.remede}
                </p>
              </CardContent>
            </Card>
          ))}

          {/*
            La remise en etat. Le script est MONTRE, en entier, avant d'etre
            telecharge — c'est la seule facon honnete de demander a quelqu'un
            de lancer quelque chose sur sa machine. Rien ici ne s'execute: le
            produit n'a aucun moyen d'atteindre le poste.
          */}
          {diagnostic.remise?.script && (
            <Card className="border-emerald-500 border-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  {t("diagnosticPoste.remiseTitre", { n: diagnostic.remise.etapes.length })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{t("diagnosticPoste.remiseDesc")}</p>
                {diagnostic.remise.administrateurRequis && (
                  <p className="text-xs border-l-2 border-amber-500 pl-3">
                    {t("diagnosticPoste.remiseAdmin")}
                  </p>
                )}
                <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto max-h-80 whitespace-pre">
                  {diagnostic.remise.script}
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(diagnostic.remise.script!);
                    toast({ title: t("diagnosticPoste.remiseCopie") });
                  }}
                >
                  <ClipboardCopy className="h-4 w-4 mr-2" />
                  {t("diagnosticPoste.remiseCopier")}
                </Button>
              </CardContent>
            </Card>
          )}

          {/*
            Ce qui ne s'automatise pas n'est pas un echec: pour ces points-la,
            le geste humain EST la bonne reponse.
          */}
          {diagnostic.remise?.aLaMain?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Hand className="h-4 w-4" />
                  {t("diagnosticPoste.aLaMainTitre")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">{t("diagnosticPoste.aLaMainDesc")}</p>
                <ul className="space-y-2">
                  {diagnostic.remise.aLaMain.map((a) => (
                    <li key={a.code} className="border-l-2 pl-3">{a.consigne}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/*
            Ce qui n'a pas pu etre mesure se montre au meme titre que le reste.
            Une case vide n'est pas une case verte.
          */}
          {diagnostic.nonMesure.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <HelpCircle className="h-4 w-4" />
                  {t("diagnosticPoste.nonMesureTitre")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>{t("diagnosticPoste.nonMesureDesc")}</p>
                <ul className="list-disc list-inside">
                  {diagnostic.nonMesure.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
