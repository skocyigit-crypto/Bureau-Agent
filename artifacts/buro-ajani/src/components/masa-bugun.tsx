/**
 * « Aujourd'hui » : la table de decision en tete du tableau de bord (plan du
 * 29/09, sections 3 et 10). Donnees : GET /api/bugun (services/masa-bugun.ts).
 *
 * Chaque ligne est un enregistrement et mene a sa fiche ; elle dit qui en
 * repond et pour quand. Couleurs de la charte : orange = attend une decision
 * humaine, rouge = erreur ou urgence, neutre = a savoir. Rien de vert ici :
 * le vert est reserve a ce qui est reellement termine.
 */
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, CalendarDays, Coins, FolderOpen, Inbox, RefreshCw, Siren } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import { Link } from "wouter";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
const FUSEAU = "Europe/Paris";

export type Ton = "bilgi" | "onay" | "acil";
export type Satir = {
  cle: string; tur: string; baslik: string; detay: string | null; href: string;
  sorumlu: string | null; zaman: string | null; ton: Ton; tutar?: number; para?: string;
};
type Rubrique = { satirlar: Satir[]; fazlasi: boolean };
export type MasaBugunVerisi = {
  simdi: Rubrique;
  onaylar: Rubrique & { toplam: number };
  plan: Rubrique;
  dosyalar: Rubrique;
  finans: Rubrique;
  ajanlar: Rubrique & { sayac: { calisiyor: number; bekliyor: number; hata: number } };
  uretildi: string;
};

const PANNEAUX: { cle: keyof Omit<MasaBugunVerisi, "uretildi">; icone: LucideIcon; tumu: string | null }[] = [
  { cle: "simdi", icone: Siren, tumu: null },
  { cle: "onaylar", icone: Inbox, tumu: "/file-approbation" },
  { cle: "plan", icone: CalendarDays, tumu: "/calendrier" },
  { cle: "dosyalar", icone: FolderOpen, tumu: "/prospects" },
  { cle: "finans", icone: Coins, tumu: "/factures" },
  { cle: "ajanlar", icone: Bot, tumu: "/bureau-taches" },
];

const BARRE: Record<Ton, string> = {
  bilgi: "border-l-slate-300 dark:border-l-slate-600",
  onay: "border-l-orange-400",
  acil: "border-l-red-600",
};

const SECRETAIRE = new Set(["task_overdue", "projet_en_retard", "missed_calls", "unread_messages", "inactive_contacts", "calendar_reminder", "auto_tasks", "auto_appointment"]);
const SOURCES_NOMMEES = new Set(["orchestrateur", "automation_rule", "app_audit", "saas_agent", "invoice_reminder", "support_email", "ai_execute"]);

/** D'ou vient une proposition : le producteur, nomme pour un humain. */
export function cleSource(type: string): string {
  if (type.startsWith("ai_receptionist")) return "telefon";
  if (SECRETAIRE.has(type)) return "sekreter";
  return SOURCES_NOMMEES.has(type) ? type : "autre";
}

/** Libelle de l'echeance selon la nature de la ligne. */
function prefixeTemps(tur: string): string | null {
  if (tur.startsWith("onay")) return "karar";
  if (tur === "fatura_gecikti") return "vade";
  if (tur === "teklif_bekliyor") return "gecerlilik";
  if (tur === "teslim" || tur === "santiye_gecikti") return "bitis";
  return null;
}

function formaterTemps(iso: string, langue: string): string {
  const d = new Date(iso);
  const jour = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const memeJour = jour(d) === jour(new Date());
  return new Intl.DateTimeFormat(langue, memeJour
    ? { timeZone: FUSEAU, hour: "2-digit", minute: "2-digit" }
    : { timeZone: FUSEAU, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

function Ligne({ s, langue }: { s: Satir; langue: string }) {
  const { t } = useTranslation();
  const libelle = t(`bugun.tur.${s.tur}`);
  const nature = libelle === `bugun.tur.${s.tur}` && s.tur.startsWith("onay_") ? t("bugun.tur.onay") : libelle;
  const titre = s.tur.startsWith("baglanti_") ? t(`bugun.baglanti.${s.tur}`) : s.baslik;
  // Un depassement nomme la grandeur a laquelle il est compare : ce que le
  // client a accepte (devis + avenants), face a la depense reelle. Le detail
  // des deux totaux est dans le dossier du chantier, ou mene la ligne.
  const detay = s.tur === "butce_asimi" && s.detay === "onayli_is" ? t("bugun.kaynakOnayliIs") : s.detay;
  const prefixe = s.zaman ? prefixeTemps(s.tur) : null;
  const source = s.tur.startsWith("onay_") && s.para ? t(`bugun.kaynak.${cleSource(s.para)}`) : null;
  return (
    <li>
      <Link
        href={s.href}
        className={`block border-l-4 ${BARRE[s.ton]} rounded-r-md px-3 py-2 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        data-testid={`bugun-satir-${s.cle}`}
        data-ton={s.ton}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{nature}</span>
          {s.zaman && (
            <span className="text-xs tabular-nums text-muted-foreground shrink-0">
              {prefixe ? `${t(`bugun.zaman.${prefixe}`)} ` : ""}{formaterTemps(s.zaman, langue)}
            </span>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-foreground truncate">{titre}</span>
          {typeof s.tutar === "number" && s.para && !s.tur.startsWith("onay_") && (
            <span className="text-sm font-semibold tabular-nums shrink-0">
              {new Intl.NumberFormat(langue, { style: "currency", currency: s.para, maximumFractionDigits: 0 }).format(s.tutar)}
            </span>
          )}
        </div>
        {(detay || s.sorumlu || source) && (
          <p className="text-xs text-muted-foreground truncate">
            {[detay, source, s.sorumlu ? `${t("bugun.sorumlu")} : ${s.sorumlu}` : null].filter(Boolean).join(" · ")}
          </p>
        )}
      </Link>
    </li>
  );
}

function Panneau({ cle, icone: Icone, tumu, rubrique, langue, entete }: {
  cle: string; icone: LucideIcon; tumu: string | null; rubrique: Rubrique; langue: string; entete?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card p-4 flex flex-col gap-3" data-testid={`bugun-panneau-${cle}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold flex items-center gap-2">
          <Icone className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {t(`bugun.panneau.${cle}`)}
        </h2>
        {tumu && (
          <Link href={tumu} className="text-xs font-medium text-blue-700 dark:text-blue-300 inline-flex items-center gap-1 hover:underline">
            {t("bugun.tumu")} <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        )}
      </div>
      {entete}
      {rubrique.satirlar.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`bugun.bos.${cle}`)}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rubrique.satirlar.map((s) => <Ligne key={s.cle} s={s} langue={langue} />)}
        </ul>
      )}
      {rubrique.fazlasi && tumu && (
        <Link href={tumu} className="text-xs text-muted-foreground hover:underline">{t("bugun.fazlasi")}</Link>
      )}
    </section>
  );
}

export function MasaBugun() {
  const { t, lang } = useTranslation();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<MasaBugunVerisi>({
    queryKey: ["bugun"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/bugun`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label={t("bugun.yukleniyor")}>
        {PANNEAUX.map((p) => <div key={p.cle} className="h-40 rounded-xl border bg-muted/40 animate-pulse" />)}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div role="alert" className="rounded-xl border border-red-300 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100 p-4 flex items-center justify-between gap-3">
        <p className="text-sm">{t("bugun.hata")}</p>
        <button type="button" onClick={() => refetch()} className="text-sm font-medium inline-flex items-center gap-1.5 underline underline-offset-2">
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" /> {t("bugun.tekrar")}
        </button>
      </div>
    );
  }

  const { sayac } = data.ajanlar;
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="masa-bugun">
      {PANNEAUX.map((p) => (
        <Panneau
          key={p.cle}
          cle={p.cle}
          icone={p.icone}
          tumu={p.tumu}
          rubrique={data[p.cle]}
          langue={lang}
          entete={
            p.cle === "onaylar" && data.onaylar.toplam > 0 ? (
              <p className="text-sm"><span className="inline-flex min-w-6 justify-center rounded-full bg-orange-400 text-slate-950 font-semibold px-1.5 mr-1.5">{data.onaylar.toplam}</span>{t("bugun.onayToplam")}</p>
            ) : p.cle === "ajanlar" ? (
              <p className="text-xs text-muted-foreground">
                {t("bugun.sayac", { calisiyor: sayac.calisiyor, bekliyor: sayac.bekliyor, hata: sayac.hata })}
              </p>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
