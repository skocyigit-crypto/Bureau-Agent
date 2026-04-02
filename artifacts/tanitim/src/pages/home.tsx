import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
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
  Headset,
  MessageSquare
} from "lucide-react";

import heroDashboardPath from "@/assets/images/hero-dashboard.png";
import featureCallsPath from "@/assets/images/feature-calls.png";
import featureDashboardPath from "@/assets/images/feature-dashboard.png";
import officeManagerPath from "@/assets/images/office-manager.png";

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-grow pt-20">
        {/* 1. HERO SECTION */}
        <section className="relative pt-24 pb-32 md:pt-32 md:pb-40 overflow-hidden bg-primary text-primary-foreground">
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay pointer-events-none"></div>
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent"></div>
          <div className="container mx-auto px-4 relative z-10">
            <div className="max-w-4xl mx-auto text-center">
              <motion.div 
                initial="hidden" animate="visible" variants={staggerContainer}
              >
                <motion.div variants={fadeInUp} className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-foreground/10 text-accent font-medium text-sm border border-primary-foreground/20">
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
                  Le centre nerveux de votre bureau
                </motion.div>
                
                <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 leading-[1.1]">
                  Enfin, un outil qui <br className="hidden md:block"/>
                  <span className="text-accent">comprend notre travail.</span>
                </motion.h1>
                
                <motion.p variants={fadeInUp} className="text-xl md:text-2xl text-primary-foreground/80 mb-12 max-w-2xl mx-auto leading-relaxed">
                  Gérez vos appels, vos contacts et vos tâches depuis une interface unique, puissante et entièrement en français. Conçu pour les professionnels exigeants.
                </motion.p>
                
                <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Button size="lg" className="h-14 px-8 text-lg bg-accent text-accent-foreground hover:bg-accent/90 rounded-full w-full sm:w-auto font-semibold">
                    Démarrer gratuitement
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 px-8 text-lg bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 rounded-full w-full sm:w-auto">
                    Voir la démo
                  </Button>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 2. DASHBOARD PREVIEW SECTION */}
        <section className="relative -mt-20 md:-mt-32 z-20 px-4">
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="container mx-auto max-w-6xl"
          >
            <div className="rounded-2xl md:rounded-3xl overflow-hidden shadow-2xl border border-border/50 bg-card p-2 md:p-4">
              <img 
                src={heroDashboardPath} 
                alt="Interface d'Agent de Bureau" 
                className="w-full h-auto rounded-xl md:rounded-2xl border border-border/50"
              />
            </div>
          </motion.div>
        </section>

        {/* 3. LOGOS / TRUST SECTION */}
        <section className="py-20 bg-background border-b border-border/40">
          <div className="container mx-auto px-4 text-center">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-8">
              La confiance des meilleurs secrétariats en France
            </p>
            <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-50 grayscale">
              <div className="text-xl font-bold font-serif">L'Atelier</div>
              <div className="text-xl font-bold tracking-tighter">BUREAUX&CO</div>
              <div className="text-xl font-extrabold italic">Nexus Paris</div>
              <div className="text-xl font-bold">SYNERGIE</div>
              <div className="text-xl font-bold uppercase tracking-widest">Aura</div>
            </div>
          </div>
        </section>

        {/* 4. FEATURES GRID */}
        <section id="fonctionnalites" className="py-32 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <h2 className="text-4xl md:text-5xl font-bold text-primary mb-6">Tout ce dont vous avez besoin, <br/>rien de superflu.</h2>
              <p className="text-lg text-muted-foreground">
                Une suite complète d'outils pensés spécifiquement pour la gestion de l'accueil et du secrétariat. Adieu les post-its perdus et les messages oubliés.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                {
                  icon: <PhoneCall className="w-6 h-6" />,
                  title: "Gestion des appels",
                  desc: "Routez, transférez et suivez les appels entrants et sortants avec une fluidité déconcertante."
                },
                {
                  icon: <Users className="w-6 h-6" />,
                  title: "Annuaire professionnel",
                  desc: "Un carnet de contacts intelligent avec historique complet des interactions et notes associées."
                },
                {
                  icon: <CheckSquare className="w-6 h-6" />,
                  title: "Gestion des tâches",
                  desc: "Transformez une demande téléphonique en tâche assignable en un seul clic."
                },
                {
                  icon: <Voicemail className="w-6 h-6" />,
                  title: "Messagerie vocale",
                  desc: "Transcription automatique des messages vocaux et organisation par priorité."
                },
                {
                  icon: <BarChart3 className="w-6 h-6" />,
                  title: "Analyses avancées",
                  desc: "Tableaux de bord détaillés pour comprendre vos flux de communication et optimiser vos équipes."
                },
                {
                  icon: <Globe className="w-6 h-6" />,
                  title: "100% en Français",
                  desc: "Une interface, un support et une documentation pensés pour le marché francophone."
                }
              ].map((feature, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="bg-card border border-border/50 p-8 rounded-3xl hover:shadow-xl transition-all duration-300 group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-primary/5 text-primary flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-foreground">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.desc}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. FEATURE DEEP DIVE 1 */}
        <section className="py-32 overflow-hidden bg-background">
          <div className="container mx-auto px-4">
            <div className="flex flex-col lg:flex-row items-center gap-16">
              <motion.div 
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
                className="flex-1 space-y-8"
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/20 text-primary font-bold text-sm">
                  <Zap className="w-4 h-4 text-accent" />
                  Flux de travail optimisé
                </div>
                <h2 className="text-4xl md:text-5xl font-bold text-primary leading-tight">
                  Ne manquez plus jamais un appel important.
                </h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Notre système de routage intelligent distribue les appels au bon interlocuteur instantanément. Visualisez en temps réel qui est en ligne, qui est disponible, et gérez les files d'attente avec une interface claire.
                </p>
                <ul className="space-y-4">
                  {[
                    "Transfert d'appel en un clic avec contexte",
                    "Identification automatique de l'appelant",
                    "Historique complet accessible instantanément"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                      <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-primary shrink-0">
                        <CheckSquare className="w-3 h-3" />
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
                <Button className="group gap-2 rounded-full h-12 px-6 bg-primary text-primary-foreground hover:bg-primary/90">
                  Découvrir la téléphonie <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </motion.div>
              
              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
                className="flex-1 relative w-full max-w-xl lg:max-w-none mx-auto"
              >
                <div className="absolute inset-0 bg-primary/5 rounded-3xl transform rotate-3"></div>
                <img 
                  src={featureCallsPath} 
                  alt="Illustration de routage d'appels" 
                  className="rounded-3xl relative z-10 shadow-2xl border border-border"
                />
              </motion.div>
            </div>
          </div>
        </section>

        {/* 6. HOW IT WORKS */}
        <section className="py-32 bg-primary/5">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold text-primary mb-16">Comment ça marche ?</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
              <div className="hidden md:block absolute top-12 left-1/6 right-1/6 h-0.5 bg-border z-0"></div>
              
              {[
                {
                  step: "1",
                  title: "Connectez vos lignes",
                  desc: "Importez vos numéros existants ou créez-en de nouveaux en quelques minutes."
                },
                {
                  step: "2",
                  title: "Configurez le routage",
                  desc: "Définissez vos règles de redirection, vos horaires et votre messagerie d'accueil."
                },
                {
                  step: "3",
                  title: "Gérez votre bureau",
                  desc: "Recevez des appels, assignez des tâches et collaborez avec votre équipe."
                }
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.2, duration: 0.5 }}
                  className="relative z-10 flex flex-col items-center"
                >
                  <div className="w-24 h-24 rounded-full bg-card border-4 border-background shadow-xl flex items-center justify-center text-3xl font-extrabold text-primary mb-6">
                    {item.step}
                  </div>
                  <h3 className="text-2xl font-bold mb-4 text-foreground">{item.title}</h3>
                  <p className="text-muted-foreground text-center max-w-sm">
                    {item.desc}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* 7. FEATURE DEEP DIVE 2 */}
        <section id="analytique" className="py-32 bg-primary text-primary-foreground overflow-hidden">
          <div className="container mx-auto px-4">
            <div className="flex flex-col lg:flex-row-reverse items-center gap-16">
              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
                className="flex-1 space-y-8"
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/20 text-accent font-medium text-sm">
                  <BarChart3 className="w-4 h-4 text-accent" />
                  Analyses en temps réel
                </div>
                <h2 className="text-4xl md:text-5xl font-bold leading-tight">
                  Prenez des décisions basées sur des données.
                </h2>
                <p className="text-lg text-primary-foreground/80 leading-relaxed">
                  Comprenez les pics d'activité, mesurez les temps de réponse et optimisez le planning de votre équipe grâce à nos tableaux de bord analytiques conçus pour les managers.
                </p>
                <ul className="space-y-4">
                  {[
                    "Rapports hebdomadaires automatiques",
                    "Métriques de performance de l'équipe",
                    "Analyse de la satisfaction client"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 font-medium">
                      <div className="w-6 h-6 rounded-full bg-primary-foreground/10 flex items-center justify-center text-accent shrink-0">
                        <CheckSquare className="w-3 h-3" />
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>
              
              <motion.div 
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
                className="flex-1 relative w-full max-w-xl lg:max-w-none mx-auto"
              >
                <div className="absolute inset-0 bg-primary-foreground/5 rounded-3xl transform -rotate-3"></div>
                <img 
                  src={featureDashboardPath} 
                  alt="Tableau de bord analytique" 
                  className="rounded-3xl relative z-10 shadow-2xl border border-primary-foreground/10"
                />
              </motion.div>
            </div>
          </div>
        </section>

        {/* 8. TESTIMONIAL */}
        <section id="temoignages" className="py-32 bg-background">
          <div className="container mx-auto px-4">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="max-w-5xl mx-auto bg-card border border-border rounded-[2.5rem] overflow-hidden shadow-2xl relative"
            >
              <div className="absolute top-0 right-0 p-8 text-accent opacity-20">
                <MessageSquare className="w-32 h-32" />
              </div>
              <div className="flex flex-col md:flex-row relative z-10">
                <div className="md:w-2/5 h-80 md:h-auto relative">
                  <img 
                    src={officeManagerPath} 
                    alt="Office Manager" 
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
                <div className="md:w-3/5 p-10 md:p-16 flex flex-col justify-center">
                  <div className="mb-6 flex gap-1 text-accent">
                    {[1,2,3,4,5].map(star => (
                      <span key={star} className="text-2xl">★</span>
                    ))}
                  </div>
                  <blockquote className="text-2xl font-medium text-foreground leading-snug mb-8">
                    "Agent de Bureau a complètement transformé notre façon de travailler. Fini les pertes d'informations entre la réception et les collaborateurs. L'interface est belle, rapide et surtout, pensée pour notre métier."
                  </blockquote>
                  <div>
                    <div className="font-bold text-xl text-primary">Sophie Laurent</div>
                    <div className="text-muted-foreground">Office Manager chez Nexus Paris</div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* 9. CTA SECTION */}
        <section className="py-32 bg-accent text-accent-foreground text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay pointer-events-none"></div>
          <div className="container mx-auto px-4 relative z-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-4xl md:text-6xl font-extrabold mb-8 tracking-tight max-w-3xl mx-auto leading-tight text-primary">
                Prêt à moderniser votre accueil ?
              </h2>
              <p className="text-xl md:text-2xl mb-12 opacity-90 max-w-2xl mx-auto text-primary/80 font-medium">
                Rejoignez des centaines d'entreprises françaises qui font confiance à Agent de Bureau pour gérer leur secrétariat.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" className="h-16 px-10 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-full w-full sm:w-auto font-bold shadow-2xl hover:shadow-primary/25 hover:-translate-y-1 transition-all">
                  Commencer l'essai de 14 jours
                </Button>
                <Button size="lg" variant="outline" className="h-16 px-10 text-lg border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground rounded-full w-full sm:w-auto font-bold transition-all">
                  Contacter les ventes
                </Button>
              </div>
              <p className="mt-8 text-sm text-primary/70 font-medium flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Aucune carte de crédit requise. Installation en 2 minutes.
              </p>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
