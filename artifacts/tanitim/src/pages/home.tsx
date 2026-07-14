import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { motion, useScroll, useTransform, useInView } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { AjanDemo } from "@/components/AjanDemo";

// DemoModal n'est rendu que sur clic — chargement paresseux pour
// retirer ses 215 lignes (+ framer-motion deja en cache + lucide
// icones) du bundle d'entree. Suspense avec fallback null car le
// modal est invisible tant qu'il n'est pas ouvert.
const DemoModal = lazy(() =>
  import("@/components/DemoModal").then((m) => ({ default: m.DemoModal })),
);
const ContactModal = lazy(() =>
  import("@/components/ContactModal").then((m) => ({ default: m.ContactModal })),
);
type ContactKind = "rappel" | "devis";
import { HeroLiveScene, LiveActivityTicker, CursorGlow } from "@/components/HeroLiveScene";
import { ShowcaseAvatar3D } from "@/components/ShowcaseAvatar3D";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";
import { AnimatedDashboardMock } from "@/components/AnimatedDashboardMock";
import { 
  PhoneCall, 
  Users, 
  CheckSquare, 
  Voicemail, 
  BarChart3, 
  Globe, 
  ArrowRight,
  ShieldCheck,
  Zap,
  MessageSquare,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ArrowUpRight,
  Lock,
  Server,
  FileText,
  Clock,
  Briefcase,
  Headset,
  Package,
  Bot,
  Plug,
  Brain,
  Shield,
  CloudUpload,
  Calculator,
  Receipt,
  FolderKanban,
  Scale,
  Mail,
  Database,
  Workflow,
  Gauge
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";

import featureCallsPath from "@/assets/images/feature-calls.webp";
import featureDashboardPath from "@/assets/images/feature-dashboard.webp";
import testimonial1Path from "@/assets/images/testimonial-1.webp";
import testimonial2Path from "@/assets/images/testimonial-2.webp";
import testimonial3Path from "@/assets/images/testimonial-3.webp";

const fadeInUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15 }
  }
};

// Source unique pour la section FAQ ET son balisage structure FAQPage
// (schema.org) — genere depuis le meme tableau plus bas pour garantir que
// les donnees structurees ne divergent jamais du contenu reellement affiche
// (Google penalise/ignore les schemas qui ne correspondent pas a la page).
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Combien de temps prend la mise en place?",
    a: "L'inscription et la configuration initiale prennent moins de 5 minutes. Importez vos contacts, configurez votre pipeline commercial et commencez a creer des devis immediatement. L'importation de vos lignes existantes (portabilite) peut prendre de 3 a 7 jours ouvres."
  },
  {
    q: "Comment fonctionne la periode d'essai?",
    a: "Vous disposez de 14 jours d'essai gratuit sur le plan Professionnel, avec toutes les fonctionnalites debloquees : IA, devis, facturation, sauvegarde cloud, conformite juridique. Aucune carte bancaire n'est requise pour commencer."
  },
  {
    q: "Mes donnees sont-elles securisees?",
    a: "La securite est notre priorite absolue. Sauvegardes automatiques chiffrees quotidiennes avec recuperation a un instant precis (point-in-time recovery) sur une infrastructure cloud europeenne dediee — vos donnees ne transitent jamais par un compte tiers externe. Monitoring continu de la protection des donnees, verification d'integrite et restauration rapide. Conforme RGPD avec gestion complete des documents juridiques (CGU, CGV, DPA, SLA)."
  },
  {
    q: "Que peut faire l'assistant IA?",
    a: "L'assistant Sophie combine 7 agents IA specialises : analyse sentimentale des appels, previsions d'activite, scoring clients, evaluation de performance, detection automatique de calculs mathematiques (15 types) et recommandations proactives. Il apprend de vos donnees pour proposer des actions concretes."
  },
  {
    q: "Comment fonctionne la facturation?",
    a: "Creez des devis professionnels, convertissez-les en factures d'un clic, gerez la TVA et les remises. Les relances de paiement partent automatiquement chaque jour pour chaque facture en retard, sans action manuelle. Le systeme de facturation par usage calcule automatiquement les depassements de forfait avec rapprochement bancaire integre."
  },
  {
    q: "Comment sont traites les e-mails de support?",
    a: "Chaque e-mail recu sur notre adresse de support est analyse par IA (categorie, priorite, brouillon de reponse redige automatiquement), puis relu et valide par un membre de notre equipe avant tout envoi — l'IA accelere la reponse, un humain garde toujours la main."
  },
  {
    q: "Quelles integrations sont disponibles?",
    a: "Agent de Bureau propose 58 integrations natives : Google Workspace (26 services avec Hub integre), Microsoft 365 (19 services) et Apple/iCloud (13 services). Plus Salesforce, HubSpot, Slack, Notion, Zapier et bien d'autres. API ouverte pour connecter vos propres outils."
  },
  {
    q: "Proposez-vous une application mobile?",
    a: "Oui, une application mobile Expo React Native est disponible avec toutes les fonctionnalites essentielles : gestion des appels, contacts, taches, notifications push en temps reel et acces au tableau de bord depuis votre telephone."
  },
  {
    q: "Puis-je restaurer mes donnees?",
    a: "Absolument. Chaque sauvegarde peut etre verifiee (integrite, checksum), simulee (dry-run) et restauree en un clic. Vous pouvez aussi exporter l'integralite de vos donnees en JSON a tout moment. Le systeme alerte automatiquement les administrateurs si la protection des donnees est insuffisante."
  }
];

function FaqJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };
  // JSON.stringify of a fixed, developer-authored array — not user input, so
  // dangerouslySetInnerHTML is safe here (same pattern as any static <script> tag).
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

function Counter({ end, suffix = "", duration = 2 }: { end: number, suffix?: string, duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  useEffect(() => {
    if (isInView) {
      let start = 0;
      const stepTime = Math.abs(Math.floor(duration * 1000 / end));
      
      // if number is very large, step by larger amounts
      const increment = end > 1000 ? Math.ceil(end / 100) : Math.ceil(end / 50);
      
      const timer = setInterval(() => {
        start += increment;
        if (start >= end) {
          setCount(end);
          clearInterval(timer);
        } else {
          setCount(start);
        }
      }, Math.max(stepTime, 20));

      return () => clearInterval(timer);
    }
    return undefined;
  }, [isInView, end, duration]);

  const formattedCount = count > 1000 && count !== end 
    ? count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") 
    : end >= 1000 && count === end 
      ? end.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
      : count;

  return (
    <span ref={ref}>
      {count === end && end >= 1000000 ? "1.2M" : formattedCount}{suffix}
    </span>
  );
}

export default function Home() {
  const { scrollYProgress } = useScroll();
  const parallaxY = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoSource, setDemoSource] = useState<string | undefined>(undefined);
  const [contactKind, setContactKind] = useState<ContactKind | null>(null);
  const [contactSource, setContactSource] = useState<string | undefined>(undefined);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterDone, setNewsletterDone] = useState(false);

  const openDemo = (source?: string) => { setDemoSource(source); setDemoOpen(true); };
  const openContact = (kind: ContactKind, source?: string) => { setContactSource(source); setContactKind(kind); };

  useDocumentMeta(PAGE_META.home);

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden font-sans">
      {demoOpen && (
        <Suspense fallback={null}>
          <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} source={demoSource} />
        </Suspense>
      )}
      {contactKind && (
        <Suspense fallback={null}>
          <ContactModal open={contactKind !== null} kind={contactKind} onClose={() => setContactKind(null)} source={contactSource} />
        </Suspense>
      )}
      <Navbar onDemoClick={() => openDemo("Navigation — bouton démo")} />

      <main className="flex-grow pt-20">
        {/* 1. HERO SECTION */}
        <section className="relative pt-24 pb-32 md:pt-36 md:pb-48 overflow-hidden bg-[#1a2744] text-primary-foreground">
          <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")'}}></div>

          {/* Live 3D-feel scene: orbiting cards, particles, ECG, gradient mesh */}
          <HeroLiveScene />
          <CursorGlow />

          <div className="container mx-auto px-4 relative z-10">
            <div className="max-w-5xl mx-auto text-center">
              <motion.div 
                initial="hidden" animate="visible" variants={staggerContainer}
              >
                <motion.div variants={fadeInUp} className="mb-8 inline-flex items-center gap-3 px-4 py-2.5 rounded-full bg-white/5 border border-white/10 text-white font-medium text-sm backdrop-blur-md shadow-2xl">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#f59e0b] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#f59e0b]"></span>
                  </span>
                  Le centre nerveux de votre bureau professionnel
                  <span className="px-2 py-0.5 rounded-full bg-white/10 text-xs font-semibold uppercase tracking-wider ml-2">Nouveau</span>
                </motion.div>
                
                <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight mb-8 leading-[1.05] text-white">
                  L'excellence de l'accueil, <br className="hidden md:block"/>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#f59e0b] to-yellow-200">sans compromis.</span>
                </motion.h1>
                
                <motion.p variants={fadeInUp} className="text-xl md:text-2xl text-blue-100/80 mb-12 max-w-3xl mx-auto leading-relaxed font-medium">
                  CRM, appels, devis, facturation, stock, IA multi-agents et protection des donnees : la plateforme complete, puissante et fierement concue pour le marche francais.
                </motion.p>
                
                <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <a href="/register">
                    <Button size="lg" className="h-16 px-10 text-lg bg-[#f59e0b] text-[#1a2744] hover:bg-[#f59e0b]/90 rounded-full w-full sm:w-auto font-bold shadow-[0_0_40px_-10px_rgba(245,158,11,0.5)] transition-all hover:scale-105">
                      Démarrer l'essai gratuit
                      <ArrowRight className="ml-2 w-5 h-5" />
                    </Button>
                  </a>
                  <Button size="lg" variant="outline" className="h-16 px-10 text-lg bg-white/5 border-white/20 text-white hover:bg-white/10 rounded-full w-full sm:w-auto font-semibold transition-all hover:scale-105 backdrop-blur-sm" onClick={() => openDemo("Présentation générale de la plateforme")}>
                    Planifier une démo
                  </Button>
                </motion.div>
                
                <motion.p variants={fadeInUp} className="mt-8 text-sm text-white/50 font-medium">
                  Plus de 2 500 bureaux gérés en France • Aucune carte bancaire requise
                </motion.p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 2. DASHBOARD PREVIEW SECTION — animated live mockup with 3D tilt */}
        <section className="relative -mt-24 md:-mt-40 z-20 px-4 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="container mx-auto max-w-6xl"
          >
            <AnimatedDashboardMock />
          </motion.div>
        </section>

        {/* 2.1 LIVE ACTIVITY TICKER — continuous motion strip */}
        <LiveActivityTicker />

        {/* 2.4 SHOWCASE 3D AVATAR — big talking head, on-device viseme engine */}
        <section className="relative overflow-hidden bg-[#1a2744] py-24 text-white">
          <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")'}}></div>
          <div className="container relative z-10 mx-auto grid items-center gap-12 px-4 lg:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="order-2 text-center lg:order-1 lg:text-left"
            >
              <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-md">
                <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
                Démo voix • 100% sur votre appareil
              </span>
              <h2 className="mb-5 text-4xl font-extrabold leading-tight md:text-5xl">
                Rencontrez votre{" "}
                <span className="bg-gradient-to-r from-[#f59e0b] to-yellow-200 bg-clip-text text-transparent">
                  agent de bureau
                </span>
              </h2>
              <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-blue-100/80 lg:mx-0">
                Cliquez sur l'avatar pour l'entendre se présenter. La synthèse vocale
                s'exécute entièrement sur votre appareil — aucune donnée audio ne quitte
                votre navigateur. C'est le même moteur de lecture labiale que l'assistant
                intégré à l'application.
              </p>
              <ul className="mx-auto max-w-md space-y-2 text-left text-blue-100/70 lg:mx-0">
                <li className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f59e0b]/20 text-[#f59e0b]">✓</span>
                  Voix synthétisée localement, sans serveur tiers
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f59e0b]/20 text-[#f59e0b]">✓</span>
                  Lecture labiale en temps réel (français)
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f59e0b]/20 text-[#f59e0b]">✓</span>
                  Accueil professionnel, 24h/24
                </li>
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="order-1 lg:order-2"
            >
              <ShowcaseAvatar3D />
            </motion.div>
          </div>
        </section>

        {/* 2.5 AJAN DEMO — public Gemini-powered live demo */}
        <AjanDemo />

        {/* 3. LOGOS / TRUST SECTION */}
        <section className="py-12 bg-background overflow-hidden border-b border-border/40">
          <div className="container mx-auto px-4 text-center mb-8">
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-[0.2em]">
              LA CONFIANCE DES MEILLEURS SECRÉTARIATS EN FRANCE
            </p>
          </div>
          
          <div className="relative flex overflow-x-hidden group">
            <div className="animate-marquee whitespace-nowrap flex items-center gap-16 md:gap-32 py-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex items-center gap-16 md:gap-32 opacity-40 grayscale group-hover:grayscale-0 group-hover:opacity-80 transition-all duration-500">
                  <div className="text-2xl font-bold font-serif">Volantera</div>
                  <div className="text-2xl font-bold tracking-tighter">ORBICORP</div>
                  <div className="flex items-center gap-2 text-2xl font-extrabold italic"><Zap className="w-6 h-6 text-accent"/> Zephira</div>
                  <div className="text-2xl font-bold">NOVAXIS</div>
                  <div className="text-2xl font-bold uppercase tracking-widest border-2 border-current px-2 py-1">Lumara</div>
                  <div className="text-2xl font-medium tracking-wide">Calyx<span className="font-bold">Hub</span></div>
                  <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-foreground to-muted-foreground">PRISMEO</div>
                </div>
              ))}
            </div>
            <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-background to-transparent pointer-events-none"></div>
            <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-background to-transparent pointer-events-none"></div>
          </div>
        </section>

        {/* 4. STATISTICS COUNTER SECTION */}
        <section className="py-24 bg-primary/5">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
              {[
                { label: "Bureaux geres", value: 2500, suffix: "+" },
                { label: "Appels traites", display: "1,2M+", value: 120, suffix: "" },
                { label: "Fonctionnalites", value: 16, suffix: " modules" },
                { label: "Disponibilite", value: 24, suffix: "/7" }
              ].map((stat, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="text-center"
                >
                  <div className="text-4xl md:text-5xl lg:text-6xl font-black text-primary mb-2 tracking-tighter">
                    {(stat as any).display ? (
                      <span>{(stat as any).display}</span>
                    ) : (
                      <Counter end={stat.value} suffix={stat.suffix} duration={2.5} />
                    )}
                  </div>
                  <div className="text-sm md:text-base font-semibold text-muted-foreground uppercase tracking-wider">
                    {stat.label}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. COMPREHENSIVE FEATURES SECTION */}
        <section id="fonctionnalites" className="py-32 bg-background relative">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <span className="text-accent font-bold tracking-widest uppercase text-sm mb-4 block">Plateforme Unifiée</span>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-primary mb-6 tracking-tight">
                Tout ce dont vous avez besoin. <br/>
                <span className="text-muted-foreground font-medium">Rien de superflu.</span>
              </h2>
              <p className="text-xl text-muted-foreground leading-relaxed">
                Une suite complète d'outils pensés spécifiquement pour la gestion de l'accueil et du secrétariat français. L'élégance au service de la productivité.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              {[
                {
                  icon: <PhoneCall className="w-7 h-7" />,
                  title: "Centre d'appels",
                  desc: "Routage intelligent, transfert en un clic, identification automatique de l'appelant et historique complet en temps reel."
                },
                {
                  icon: <Users className="w-7 h-7" />,
                  title: "CRM & Contacts",
                  desc: "Annuaire professionnel intelligent avec prospects, suivi des interactions et pipeline commercial integre."
                },
                {
                  icon: <Receipt className="w-7 h-7" />,
                  title: "Devis & Facturation",
                  desc: "Creation de devis, conversion en factures, suivi des paiements et relances de retard envoyees automatiquement chaque jour. TVA, remises et multi-devises."
                },
                {
                  icon: <FolderKanban className="w-7 h-7" />,
                  title: "Gestion de projets",
                  desc: "Projets avec budgets, echeances et suivi d'avancement. Associez contacts, devis et factures a chaque projet."
                },
                {
                  icon: <CheckSquare className="w-7 h-7" />,
                  title: "Tâches & Automatisations",
                  desc: "Taches assignables avec priorites, regles d'automatisation personnalisees et alertes intelligentes."
                },
                {
                  icon: <Brain className="w-7 h-7" />,
                  title: "Multi-Agent IA",
                  desc: "7 agents IA specialises : analyse sentimentale, previsions, performance, scoring clients et actions proactives."
                },
                {
                  icon: <Calculator className="w-7 h-7" />,
                  title: "Moteur Mathematique",
                  desc: "15 types de calculs integres : financier, statistique, geometrie, conversions, trigonometrie et bien plus."
                },
                {
                  icon: <Shield className="w-7 h-7" />,
                  title: "Protection des Donnees",
                  desc: "Surveillance automatique toutes les 6h, alertes de sauvegarde, conformite RGPD et chiffrement AES-256."
                },
                {
                  icon: <CloudUpload className="w-7 h-7" />,
                  title: "Sauvegarde Cloud",
                  desc: "Sauvegarde chiffree sur Google Drive, verification d'integrite, restauration et export JSON en un clic."
                },
                {
                  icon: <Package className="w-7 h-7" />,
                  title: "Gestion de stock",
                  desc: "Inventaire complet avec scan QR/code-barres, import IA de factures et suivi automatique des niveaux."
                },
                {
                  icon: <Scale className="w-7 h-7" />,
                  title: "Conformite Juridique",
                  desc: "Gestion CGU, CGV, RGPD, DPA, SLA et propriete intellectuelle. Suivi par organisation avec dashboard."
                },
                {
                  icon: <BarChart3 className="w-7 h-7" />,
                  title: "Analyses & Rapports",
                  desc: "Tableaux de bord en temps reel, rapports quotidiens automatiques, metriques de performance par equipe."
                },
                {
                  icon: <Mail className="w-7 h-7" />,
                  title: "Google Workspace Hub",
                  desc: "Gmail, Drive, Calendar et Contacts integres nativement. Synchronisation bidirectionnelle en temps reel."
                },
                {
                  icon: <Database className="w-7 h-7" />,
                  title: "Facturation Usage",
                  desc: "Forfaits avec calcul automatique des depassements, snapshots d'usage et rapprochement bancaire."
                },
                {
                  icon: <Workflow className="w-7 h-7" />,
                  title: "Automatisations",
                  desc: "Regles personnalisees, alertes proactives, rappels de taches, relances de facturation quotidiennes, tri IA des e-mails de support, pointage auto depuis Google Calendar."
                },
                {
                  icon: <Globe className="w-7 h-7" />,
                  title: "100% Francais",
                  desc: "Interface, documentation et support integralement en francais. Concu pour le marche francophone."
                }
              ].map((feature, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05, duration: 0.5 }}
                  className="bg-card border border-border/50 p-8 rounded-[2rem] hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] hover:-translate-y-2 transition-all duration-300 group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-6 opacity-5 transform translate-x-1/4 -translate-y-1/4 group-hover:scale-150 transition-transform duration-700">
                    {feature.icon}
                  </div>
                  <div className="w-16 h-16 rounded-2xl bg-primary/5 text-primary flex items-center justify-center mb-8 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300 shadow-sm">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-foreground tracking-tight">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed font-medium">
                    {feature.desc}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* 6. FEATURE DEEP DIVE 1 */}
        <section className="py-32 overflow-hidden bg-primary/5">
          <div className="container mx-auto px-4">
            <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
              <motion.div 
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="flex-1 space-y-8"
              >
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent font-bold text-sm tracking-wide uppercase">
                  <Headset className="w-4 h-4" />
                  Standard virtuel
                </div>
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-primary leading-[1.1] tracking-tight">
                  Ne manquez plus <span className="text-accent">jamais</span> un appel important.
                </h2>
                <p className="text-xl text-muted-foreground leading-relaxed font-medium">
                  Notre système de routage intelligent distribue les appels au bon interlocuteur instantanément. Visualisez en temps réel qui est en ligne et gérez les files d'attente avec une interface claire et épurée.
                </p>
                <div className="space-y-5 pt-4">
                  {[
                    "Transfert d'appel en un clic avec contexte partagé",
                    "Identification automatique de l'appelant via l'annuaire",
                    "Historique complet accessible instantanément pendant l'appel"
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-primary shrink-0 mt-0.5 shadow-md">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <p className="text-lg text-foreground font-semibold leading-snug">{item}</p>
                    </div>
                  ))}
                </div>
                <div className="pt-6">
                  <a href="/register">
                    <Button className="group h-14 px-8 text-lg rounded-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold shadow-xl hover:shadow-primary/25 transition-all">
                      Démarrer gratuitement
                      <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </a>
                </div>
              </motion.div>
              
              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                style={{ y: parallaxY }}
                className="flex-1 relative w-full max-w-xl lg:max-w-none mx-auto"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-primary/5 rounded-[2.5rem] transform rotate-3 scale-105 blur-lg"></div>
                <div className="absolute inset-0 bg-background rounded-[2.5rem] transform rotate-3 border border-border shadow-2xl"></div>
                <img
                  src={featureCallsPath}
                  alt="Illustration de routage d'appels"
                  width={1280}
                  height={698}
                  loading="lazy"
                  decoding="async"
                  className="rounded-[2rem] relative z-10 shadow-2xl border border-border w-full h-auto object-cover"
                />
                
                {/* Floating UI Elements */}
                <motion.div 
                  animate={{ y: [0, -15, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -right-12 top-24 z-20 bg-background border border-border shadow-xl rounded-2xl p-4 flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                    <PhoneCall className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Appel entrant</p>
                    <p className="text-xs text-muted-foreground">Jean Dupont - En attente</p>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 7. FEATURE DEEP DIVE 2 */}
        <section id="analytique" className="py-32 bg-[#1a2744] text-white overflow-hidden relative">
          <div className="absolute inset-0 opacity-[0.02] mix-blend-overlay pointer-events-none" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")'}}></div>
          <div className="container mx-auto px-4 relative z-10">
            <div className="flex flex-col lg:flex-row-reverse items-center gap-16 lg:gap-24">
              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="flex-1 space-y-8"
              >
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/20 border border-accent/30 text-accent font-bold text-sm tracking-wide uppercase">
                  <BarChart3 className="w-4 h-4" />
                  Analyses en temps réel
                </div>
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight">
                  Prenez des décisions basées sur <span className="text-accent">les données.</span>
                </h2>
                <p className="text-xl text-blue-100/80 leading-relaxed font-medium">
                  Comprenez les pics d'activité, mesurez les temps de réponse et optimisez le planning de votre équipe grâce à nos tableaux de bord analytiques de niveau entreprise, conçus pour les managers exigeants.
                </p>
                <div className="space-y-6 pt-4">
                  {[
                    "Génération de rapports hebdomadaires automatiques",
                    "Métriques de performance individuelles et d'équipe",
                    "Analyse approfondie de la satisfaction client"
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-accent shrink-0 mt-0.5 border border-white/10">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <p className="text-lg text-white font-semibold leading-snug">{item}</p>
                    </div>
                  ))}
                </div>
                <div className="pt-6">
                  <a href="/register">
                    <Button className="group h-14 px-8 text-lg rounded-full bg-white text-primary hover:bg-white/90 font-bold shadow-xl transition-all">
                      Voir le tableau de bord
                      <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </a>
                </div>
              </motion.div>
              
              <motion.div 
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="flex-1 relative w-full max-w-xl lg:max-w-none mx-auto"
              >
                <div className="absolute inset-0 bg-gradient-to-tr from-accent/30 to-blue-500/20 rounded-[2.5rem] transform -rotate-3 scale-105 blur-lg"></div>
                <img
                  src={featureDashboardPath}
                  alt="Tableau de bord analytique"
                  width={1280}
                  height={698}
                  loading="lazy"
                  decoding="async"
                  className="rounded-[2rem] relative z-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 w-full h-auto object-cover"
                />
              </motion.div>
            </div>
          </div>
        </section>

        {/* 8. COMMENT CA MARCHE */}
        <section id="comment-ca-marche" className="py-32 bg-background">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto mb-24">
              <span className="text-accent font-bold tracking-widest uppercase text-sm mb-4 block">Déploiement Éclair</span>
              <h2 className="text-4xl md:text-5xl font-extrabold text-primary mb-6">Comment ça marche ?</h2>
              <p className="text-xl text-muted-foreground font-medium">
                Mettez en place votre nouveau secrétariat virtuel en moins de temps qu'il n'en faut pour prendre un café.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative max-w-6xl mx-auto">
              {/* Connector Line */}
              <div className="hidden md:block absolute top-12 left-[12.5%] right-[12.5%] h-1 bg-border rounded-full z-0">
                <motion.div 
                  initial={{ width: "0%" }}
                  whileInView={{ width: "100%" }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.5, ease: "easeInOut" }}
                  className="h-full bg-accent rounded-full"
                ></motion.div>
              </div>
              
              {[
                {
                  icon: <Building2 className="w-8 h-8" />,
                  title: "Créez votre espace",
                  desc: "Inscrivez-vous en 2 minutes et paramétrez l'identité de votre bureau."
                },
                {
                  icon: <PhoneCall className="w-8 h-8" />,
                  title: "Connectez vos lignes",
                  desc: "Importez vos numéros existants ou créez-en de nouveaux instantanément."
                },
                {
                  icon: <Clock className="w-8 h-8" />,
                  title: "Configurez le routage",
                  desc: "Définissez vos règles de redirection, vos horaires et votre message d'accueil."
                },
                {
                  icon: <Briefcase className="w-8 h-8" />,
                  title: "Gérez votre bureau",
                  desc: "Recevez des appels, assignez des tâches et collaborez avec votre équipe."
                }
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.2, duration: 0.6 }}
                  className="relative z-10 flex flex-col items-center text-center group"
                >
                  <div className="w-24 h-24 rounded-full bg-card border-4 border-background shadow-[0_0_30px_-5px_rgba(0,0,0,0.1)] flex items-center justify-center text-primary mb-8 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-accent group-hover:scale-110 transition-all duration-300">
                    {item.icon}
                  </div>
                  <div className="bg-muted/50 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mb-4 border border-border">
                    {i + 1}
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-foreground">{item.title}</h3>
                  <p className="text-muted-foreground font-medium leading-relaxed">
                    {item.desc}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* 9. PRICING SECTION */}
        <section id="tarifs" className="py-32 bg-primary/5">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <span className="text-accent font-bold tracking-widest uppercase text-sm mb-4 block">Tarification Simple</span>
              <h2 className="text-4xl md:text-5xl font-extrabold text-primary mb-6">Des tarifs clairs, sans surprise.</h2>
              <p className="text-xl text-muted-foreground font-medium">
                Choisissez le plan qui correspond à la taille et aux ambitions de votre bureau.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto items-center">
              {/* Tier 1 - Starter */}
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="bg-card rounded-[2rem] p-10 border border-border shadow-lg"
              >
                <h3 className="text-2xl font-bold text-foreground mb-2">Starter</h3>
                <p className="text-muted-foreground mb-8 min-h-[48px]">Pour les petits bureaux et independants.</p>
                <div className="mb-8">
                  <span className="text-5xl font-extrabold text-primary">29€</span>
                  <span className="text-muted-foreground font-medium">/mois</span>
                </div>
                <a href="/register" className="block w-full mb-8">
                  <Button variant="outline" className="w-full h-14 rounded-xl text-lg font-bold border-2 hover:bg-primary/5">
                    Essai gratuit 14 jours
                  </Button>
                </a>
                <ul className="space-y-4">
                  {[
                    "Jusqu'a 5 utilisateurs",
                    "500 contacts & prospects",
                    "2 000 appels / mois",
                    "Devis & facturation",
                    "Gestion de stock",
                    "Sauvegarde chiffree",
                    "Support par email"
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.div>

              {/* Tier 2 - POPULAR */}
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="bg-primary rounded-[2rem] p-10 shadow-[0_30px_60px_-15px_rgba(26,39,68,0.5)] transform md:-translate-y-4 relative border border-accent/20"
              >
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                  <span className="bg-accent text-accent-foreground px-4 py-1 rounded-full text-sm font-bold uppercase tracking-wider shadow-lg">
                    Le plus choisi
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Professionnel</h3>
                <p className="text-blue-200/80 mb-8 min-h-[48px]">Pour les PME et bureaux en croissance.</p>
                <div className="mb-8">
                  <span className="text-5xl font-extrabold text-white">79€</span>
                  <span className="text-blue-200/80 font-medium">/mois</span>
                </div>
                <a href="/register" className="block w-full mb-8">
                  <Button className="w-full h-14 rounded-xl text-lg font-bold bg-accent text-accent-foreground hover:bg-accent/90 shadow-xl">
                    Essai gratuit 14 jours
                  </Button>
                </a>
                <ul className="space-y-4">
                  {[
                    "Jusqu'a 15 utilisateurs",
                    "5 000 contacts & prospects",
                    "10 000 appels / mois",
                    "Multi-Agent IA (7 agents)",
                    "Moteur mathematique",
                    "Google Workspace Hub",
                    "Protection des donnees auto",
                    "Conformite juridique",
                    "Support prioritaire 24/7"
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-white font-medium">
                      <CheckCircle2 className="w-5 h-5 text-accent shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.div>

              {/* Tier 3 */}
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 }}
                className="bg-card rounded-[2rem] p-10 border border-border shadow-lg"
              >
                <h3 className="text-2xl font-bold text-foreground mb-2">Entreprise</h3>
                <p className="text-muted-foreground mb-8 min-h-[48px]">Pour les grands groupes et volumes massifs.</p>
                <div className="mb-8">
                  <span className="text-5xl font-extrabold text-primary">199€</span>
                  <span className="text-muted-foreground font-medium">/mois</span>
                </div>
                <Button variant="outline" className="w-full h-14 rounded-xl text-lg font-bold border-2 mb-3 hover:bg-primary/5" onClick={() => openContact("devis", "Offre Entreprise (sur mesure)")}>
                  Demander un devis sur mesure
                </Button>
                <button
                  type="button"
                  onClick={() => openContact("rappel", "Offre Entreprise (sur mesure)")}
                  className="w-full text-sm font-semibold text-muted-foreground hover:text-primary transition-colors mb-8"
                >
                  ou être rappelé sous 2h →
                </button>
                <ul className="space-y-4">
                  {[
                    "Jusqu'a 100 utilisateurs",
                    "50 000 contacts illimites",
                    "Appels illimites",
                    "IA sur mesure + API ouverte",
                    "SLA Garanti 99.9%",
                    "Account Manager dedie",
                    "Sauvegarde & restauration avancee",
                    "Audit de securite complet",
                    "Formation sur site"
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                      <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 10. TESTIMONIALS SECTION */}
        <section id="temoignages" className="py-32 bg-background relative overflow-hidden">
          <div className="absolute top-0 right-0 p-32 text-accent opacity-5 pointer-events-none transform translate-x-1/4 -translate-y-1/4">
            <MessageSquare className="w-96 h-96" />
          </div>
          
          <div className="container mx-auto px-4 relative z-10">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <h2 className="text-4xl md:text-5xl font-extrabold text-primary mb-6">Ils ont transformé leur accueil.</h2>
              <p className="text-xl text-muted-foreground font-medium">
                Découvrez pourquoi les meilleurs professionnels de l'administration choisissent Agent de Bureau.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  name: "A. Morel",
                  role: "Office Manager",
                  company: "Volantera Solutions",
                  image: testimonial1Path,
                  quote: "Agent de Bureau a complètement transformé notre façon de travailler. Fini les pertes d'informations entre la réception et les collaborateurs. L'interface est belle, rapide et surtout, pensée pour notre métier."
                },
                {
                  name: "R. Blanchard",
                  role: "Directeur Général",
                  company: "Zephira Tech",
                  image: testimonial2Path,
                  quote: "La qualité de l'accueil téléphonique est la première image de notre entreprise. Avec les analytiques d'Agent de Bureau, nous avons réduit notre temps de réponse moyen de 40% en un mois."
                },
                {
                  name: "L. Duvernet",
                  role: "Responsable Réception",
                  company: "Orbispace",
                  image: testimonial3Path,
                  quote: "Gérer 50 lignes différentes était un cauchemar quotidien. Le routage intelligent fait le travail à notre place. C'est de loin le meilleur investissement logiciel que nous ayons fait cette année."
                }
              ].map((testimonial, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                  className="bg-card rounded-[2rem] p-8 border border-border shadow-lg flex flex-col h-full"
                >
                  <div className="flex gap-1 text-accent mb-6">
                    {[1,2,3,4,5].map(star => (
                      <span key={star} className="text-xl">★</span>
                    ))}
                  </div>
                  <blockquote className="text-lg font-medium text-foreground leading-relaxed mb-8 flex-grow">
                    "{testimonial.quote}"
                  </blockquote>
                  <div className="flex items-center gap-4 mt-auto">
                    <img
                      src={testimonial.image}
                      alt={testimonial.name}
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                      className="w-14 h-14 rounded-full object-cover border-2 border-primary/10"
                    />
                    <div>
                      <div className="font-bold text-primary">{testimonial.name}</div>
                      <div className="text-sm text-muted-foreground">{testimonial.role}, {testimonial.company}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* 11. INTEGRATIONS SECTION */}
        <section id="integrations" className="py-24 bg-muted/30 border-y border-border">
          <div className="container mx-auto px-4 text-center">
            <span className="text-accent font-bold tracking-widest uppercase text-sm mb-4 block">Ecosysteme Complet</span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-primary mb-4">58 integrations natives</h2>
            <p className="text-lg text-muted-foreground mb-12 max-w-2xl mx-auto">Connectez l'ensemble de vos outils professionnels en un clic. Trois ecosystemes, une seule plateforme.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto mb-12">
              {[
                { name: "Google Workspace", count: 26, color: "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800", tools: ["Gmail", "Calendar", "Drive", "Meet", "Docs", "Sheets"] },
                { name: "Microsoft 365", count: 19, color: "bg-[#0078D4]/5 border-[#0078D4]/20", tools: ["Outlook", "Teams", "OneDrive", "Word", "Excel", "SharePoint"] },
                { name: "Apple / iCloud", count: 13, color: "bg-gray-50 border-gray-200 dark:bg-gray-900/20 dark:border-gray-700", tools: ["iCloud Mail", "Calendrier", "iCloud Drive", "FaceTime", "Pages", "Notes"] },
              ].map((platform, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className={`rounded-2xl border p-8 ${platform.color} text-left`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-foreground">{platform.name}</h3>
                    <span className="text-sm font-bold text-accent">{platform.count} services</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {platform.tools.map((tool, j) => (
                      <span key={j} className="px-3 py-1 bg-background/80 border border-border rounded-lg text-xs font-medium text-muted-foreground">{tool}</span>
                    ))}
                    <span className="px-3 py-1 bg-accent/10 border border-accent/20 rounded-lg text-xs font-bold text-accent">+{platform.count - platform.tools.length}</span>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="flex flex-wrap justify-center items-center gap-4 md:gap-6">
              {['Salesforce', 'Slack', 'Zoom', 'HubSpot', 'Notion', 'Zapier', 'Resend', 'Stripe'].map((integration, i) => (
                <div key={i} className="px-5 py-2.5 bg-card border border-border rounded-xl shadow-sm font-bold text-sm text-muted-foreground hover:text-primary hover:border-primary hover:shadow-md transition-all cursor-pointer">
                  {integration}
                </div>
              ))}
              <span className="text-sm text-muted-foreground font-medium">+ 13 autres</span>
            </div>
          </div>
        </section>

        {/* 12. FAQ SECTION */}
        <section id="faq" className="py-32 bg-background">
          <div className="container mx-auto px-4 max-w-4xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-extrabold text-primary mb-6">Questions fréquentes</h2>
              <p className="text-xl text-muted-foreground font-medium">Tout ce que vous devez savoir avant de vous lancer.</p>
            </div>
            
            <Accordion type="single" collapsible className="w-full space-y-4">
              {FAQ_ITEMS.map((faq, i) => (
                <AccordionItem key={i} value={`item-${i}`} className="bg-card border border-border rounded-xl px-6 data-[state=open]:shadow-md transition-all">
                  <AccordionTrigger className="text-lg font-bold hover:no-underline hover:text-primary text-left py-6">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <FaqJsonLd />
          </div>
        </section>

        {/* 13. SECURITY/COMPLIANCE SECTION */}
        <section className="py-20 bg-primary/5 border-t border-border">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h3 className="text-2xl font-extrabold text-primary mb-2">Securite & Conformite de niveau entreprise</h3>
              <p className="text-muted-foreground">Vos donnees sont protegees 24h/24, 7j/7 par des mecanismes de securite avances.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
              {[
                { icon: <ShieldCheck className="w-7 h-7" />, label: "Conforme RGPD" },
                { icon: <Lock className="w-7 h-7" />, label: "Chiffrement AES-256" },
                { icon: <Server className="w-7 h-7" />, label: "Hebergement France" },
                { icon: <CloudUpload className="w-7 h-7" />, label: "Sauvegarde auto 6h" },
                { icon: <Shield className="w-7 h-7" />, label: "Monitoring continu" },
                { icon: <Scale className="w-7 h-7" />, label: "CGU/CGV/DPA/SLA" },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center gap-3 p-4 rounded-2xl bg-card border border-border text-center">
                  <div className="text-primary">{item.icon}</div>
                  <span className="text-sm font-bold text-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 14. CTA & NEWSLETTER SECTION */}
        <section className="py-32 bg-primary text-white text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")'}}></div>
          
          <div className="absolute top-0 right-0 w-96 h-96 bg-accent rounded-full mix-blend-screen filter blur-[150px] opacity-20"></div>
          
          <div className="container mx-auto px-4 relative z-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="max-w-4xl mx-auto"
            >
              <h2 className="text-5xl md:text-7xl font-black mb-8 tracking-tight leading-tight">
                Prêt à moderniser votre <span className="text-accent">accueil</span> ?
              </h2>
              <p className="text-xl md:text-2xl mb-12 text-blue-100/90 font-medium leading-relaxed">
                Rejoignez les entreprises françaises qui ont fait le choix de l'excellence opérationnelle avec Agent de Bureau.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-16">
                <a href="/register">
                  <Button size="lg" className="h-16 px-12 text-xl bg-accent text-accent-foreground hover:bg-accent/90 rounded-full w-full sm:w-auto font-bold shadow-[0_0_40px_-10px_rgba(245,158,11,0.6)] hover:scale-105 transition-all">
                    Commencer gratuitement
                  </Button>
                </a>
                <Button size="lg" variant="outline" className="h-16 px-12 text-xl border-2 border-white/20 text-white hover:bg-white/10 rounded-full w-full sm:w-auto font-bold hover:scale-105 transition-all backdrop-blur-sm" onClick={() => openDemo("Parler à un expert")}>
                  Parler à un expert
                </Button>
              </div>

              <div className="max-w-md mx-auto bg-white/5 p-6 rounded-3xl border border-white/10 backdrop-blur-md">
                <h4 className="text-sm font-bold uppercase tracking-widest text-white/80 mb-4">Restez informé</h4>
                {newsletterDone ? (
                  <p className="text-center text-accent font-bold py-2">✓ Inscription confirmée. Merci !</p>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="votre@email.fr"
                      value={newsletterEmail}
                      onChange={(e) => setNewsletterEmail(e.target.value)}
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/50 h-12 rounded-xl focus-visible:ring-accent"
                    />
                    <Button
                      className="h-12 bg-white text-primary hover:bg-white/90 rounded-xl font-bold px-6 shrink-0"
                      onClick={() => { if (newsletterEmail.includes("@")) setNewsletterDone(true); }}
                    >
                      S'inscrire
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
