/**
 * Journal des reglements — l'ecran qui rend la conformite utilisable.
 *
 * Les dispositifs existaient deja cote serveur: journal en ajout seul, chaine
 * d'empreintes, clotures a total cumule, archive autonome, attestation. Rien
 * ne les appelait. Un dispositif que personne ne peut declencher ne protege
 * personne — et l'attestation remise au client affirme justement qu'il peut
 * verifier « a tout moment, depuis son propre compte ». Cet ecran est ce qui
 * rend cette phrase vraie.
 *
 * Trois choses y sont volontairement visibles en permanence, et non cachees
 * derriere un menu:
 *
 *   - le resultat de la DERNIERE verification, parce qu'une verification qu'on
 *     ne pense jamais a lancer ne vaut pas mieux que pas de verification;
 *   - l'archive et l'attestation, parce que ce sont les deux pieces qu'on
 *     cherche en urgence le jour d'un controle;
 *   - le fait qu'une correction se fait par contre-passation. L'utilisateur
 *     qui cherche « supprimer » doit comprendre pourquoi il ne le trouve pas.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const MOYENS = ["especes", "virement", "cheque", "carte", "prelevement", "autre"] as const;

interface Verdict {
  intacte?: boolean;
  coherent?: boolean;
  premiereRupture?: number | null;
  periode?: string | null;
  ecartCentimes?: number | null;
  explication?: string | null;
  verifiees?: number;
  cloturesVerifiees?: number;
}

export default function EncaissementsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [factureId, setFactureId] = useState("");
  const [montant, setMontant] = useState("");
  const [moyen, setMoyen] = useState<string>("virement");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [enregistre, setEnregistre] = useState(false);

  const [chaine, setChaine] = useState<Verdict | null>(null);
  const [conservation, setConservation] = useState<Verdict | null>(null);
  const [verifieLe, setVerifieLe] = useState<string | null>(null);
  const [verification, setVerification] = useState(false);

  const verifier = useCallback(async () => {
    setVerification(true);
    try {
      const [a, b] = await Promise.all([
        fetch(`${BASE}/api/encaissements/verifier`, { credentials: "include" }),
        fetch(`${BASE}/api/encaissements/conservation?type=journaliere`, { credentials: "include" }),
      ]);
      if (a.ok) setChaine(await a.json());
      if (b.ok) setConservation(await b.json());
      setVerifieLe(new Date().toLocaleString("fr-FR"));
    } catch {
      toast({ title: t("encaissements.toast.verificationEchouee"), variant: "destructive" });
    } finally {
      setVerification(false);
    }
  }, [toast, t]);

  // La verification se lance a l'ouverture: on veut que l'utilisateur VOIE
  // l'etat de son journal sans avoir a y penser. Un controle de conformite
  // qu'il faut se rappeler de declencher finit par ne plus etre declenche.
  useEffect(() => { void verifier(); }, [verifier]);

  const enregistrer = async () => {
    if (!factureId.trim() || !montant.trim()) {
      toast({ title: t("encaissements.toast.champsRequis"), variant: "destructive" });
      return;
    }
    setEnregistre(true);
    try {
      const res = await fetch(`${BASE}/api/encaissements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          factureId: Number(factureId),
          montant: Number(montant),
          moyen,
          dateEncaissement: new Date(`${date}T12:00:00`).toISOString(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Le 409 a un sens precis: la periode est close. Le message du serveur
        // explique quoi faire, on le montre tel quel plutot que de le resumer.
        toast({
          title: res.status === 409 ? t("encaissements.toast.periodeClose") : t("encaissements.toast.echec"),
          description: d.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("encaissements.toast.enregistre", { numero: d.numero }) });
      setMontant("");
      void verifier();
    } catch {
      toast({ title: t("encaissements.toast.echec"), variant: "destructive" });
    } finally {
      setEnregistre(false);
    }
  };

  const reprise = async () => {
    const ok = await confirmAction({
      title: t("encaissements.reprise.confirmTitre"),
      description: t("encaissements.reprise.confirmDesc"),
      confirmLabel: t("encaissements.reprise.confirmBouton"),
    });
    if (!ok) return;
    try {
      const res = await fetch(`${BASE}/api/encaissements/reprise`, { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: t("encaissements.toast.echec"), description: d.error, variant: "destructive" }); return; }
      toast({ title: t("encaissements.reprise.faite", { n: d.creees }) });
      void verifier();
    } catch {
      toast({ title: t("encaissements.toast.echec"), variant: "destructive" });
    }
  };

  const chaineOk = chaine?.intacte === true;
  const conservationOk = conservation?.coherent === true;
  const toutVaBien = chaineOk && conservationOk;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">{t("encaissements.titre")}</h1>
        <p className="text-muted-foreground mt-1">{t("encaissements.sousTitre")}</p>
      </div>

      {/*
        L'etat de conformite en haut, pas en bas: c'est la question a laquelle
        cet ecran repond. Le reste sert a la maintenir vraie.
      */}
      <Card className={toutVaBien ? "border-emerald-500" : "border-amber-500 border-2"}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {toutVaBien
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              : <AlertTriangle className="h-4 w-4 text-amber-500" />}
            {t("encaissements.etat.titre")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className={chaineOk ? "border-emerald-500 text-emerald-700 dark:text-emerald-300" : "border-amber-500 text-amber-700 dark:text-amber-300"}>
              {t("encaissements.etat.chaine")} — {chaineOk ? t("encaissements.etat.intacte") : t("encaissements.etat.aVerifier")}
            </Badge>
            <Badge variant="outline" className={conservationOk ? "border-emerald-500 text-emerald-700 dark:text-emerald-300" : "border-amber-500 text-amber-700 dark:text-amber-300"}>
              {t("encaissements.etat.conservation")} — {conservationOk ? t("encaissements.etat.coherente") : t("encaissements.etat.aVerifier")}
            </Badge>
            {verifieLe && (
              <span className="text-xs text-muted-foreground">
                {t("encaissements.etat.verifieLe", { quand: verifieLe })}
              </span>
            )}
          </div>

          {/* Une anomalie se lit en toutes lettres, avec son numero: c'est ce
              qu'un controleur demandera, et ce que l'utilisateur doit pouvoir
              transmettre sans interpretation. */}
          {chaine?.explication && (
            <p className="border-l-2 border-amber-500 pl-3">{chaine.explication}</p>
          )}
          {conservation?.explication && (
            <p className="border-l-2 border-amber-500 pl-3">{conservation.explication}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={verifier} disabled={verification}>
              {verification ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              {t("encaissements.etat.verifier")}
            </Button>
            <a href={`${BASE}/api/encaissements/archive?type=annuelle&periode=${new Date().getFullYear() - 1}`} download>
              <Button size="sm" variant="outline">
                <Download className="h-4 w-4 mr-2" />
                {t("encaissements.etat.archive", { annee: new Date().getFullYear() - 1 })}
              </Button>
            </a>
            <a href={`${BASE}/api/encaissements/attestation`} download>
              <Button size="sm" variant="outline">
                <FileCheck2 className="h-4 w-4 mr-2" />
                {t("encaissements.etat.attestation")}
              </Button>
            </a>
          </div>

          <p className="text-xs text-muted-foreground pt-1">{t("encaissements.etat.fondement")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("encaissements.saisie.titre")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="enc-facture" className="text-xs">{t("encaissements.saisie.facture")}</Label>
              <Input id="enc-facture" type="number" value={factureId} onChange={(e) => setFactureId(e.target.value)} placeholder="123" />
            </div>
            <div>
              <Label htmlFor="enc-montant" className="text-xs">{t("encaissements.saisie.montant")}</Label>
              <Input id="enc-montant" type="number" step="0.01" min="0" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="1500.00" />
            </div>
            <div>
              <Label htmlFor="enc-moyen" className="text-xs">{t("encaissements.saisie.moyen")}</Label>
              <Select value={moyen} onValueChange={setMoyen}>
                <SelectTrigger id="enc-moyen" aria-label={t("encaissements.saisie.moyen")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOYENS.map((m) => (
                    <SelectItem key={m} value={m}>{t(`encaissements.moyens.${m}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="enc-date" className="text-xs">{t("encaissements.saisie.date")}</Label>
              <Input id="enc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <Button onClick={enregistrer} disabled={enregistre}>
            {enregistre && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("encaissements.saisie.enregistrer")}
          </Button>

          {/*
            Dit ici, pas decouvert plus tard: quelqu'un qui cherche « modifier »
            ou « supprimer » doit comprendre pourquoi il ne trouve pas, sinon il
            conclut que le logiciel est incomplet.
          */}
          <p className="text-xs text-muted-foreground border-l-2 pl-3">
            {t("encaissements.saisie.avertissement")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            {t("encaissements.reprise.titre")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{t("encaissements.reprise.desc")}</p>
          <Button size="sm" variant="outline" onClick={reprise}>{t("encaissements.reprise.bouton")}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
