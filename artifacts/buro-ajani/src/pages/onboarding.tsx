import { useState, useEffect, useCallback } from "react";
import { Rocket, Check, ChevronRight, ChevronLeft, Download, Smartphone, Globe, Zap, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface IntegrationItem {
  id: string;
  name: string;
  category: string;
  description: string;
  features: string[];
  status: "connecte" | "deconnecte" | "en_attente";
}

const CATEGORY_LABELS: Record<string, string> = {
  crm: "CRM",
  communication: "Communication",
  gestion_projet: "Gestion de projet",
  comptabilite: "Comptabilité",
  documents: "Documents",
  messagerie: "Messagerie",
  marketing: "Marketing",
  automatisation: "Automatisation",
  support: "Support client",
};

const CATEGORY_ICONS: Record<string, string> = {
  crm: "👥",
  communication: "💬",
  gestion_projet: "📋",
  comptabilite: "💰",
  documents: "📄",
  messagerie: "📧",
  marketing: "📣",
  automatisation: "⚡",
  support: "🎧",
};

export default function OnboardingPage({ onComplete }: { onComplete?: () => void }) {
  const [step, setStep] = useState(0);
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [selectedIntegrations, setSelectedIntegrations] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [isPwaInstalled, setIsPwaInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsPwaInstalled(true);
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    fetch(`${baseUrl}/api/integrations/catalog`, { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        setIntegrations(data.integrations || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [baseUrl]);

  const handlePwaInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setIsPwaInstalled(true);
    setDeferredPrompt(null);
  };

  const toggleIntegration = (id: string) => {
    setSelectedIntegrations(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleComplete = useCallback(async () => {
    setCompleting(true);
    try {
      await fetch(`${baseUrl}/api/auth/complete-onboarding`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIntegrations: Array.from(selectedIntegrations) }),
      });
    } catch (err) { console.error("[Onboarding] complete failed:", err); }
    setCompleting(false);
    onComplete?.();
  }, [baseUrl, selectedIntegrations, onComplete]);

  const categorizedIntegrations = integrations.reduce<Record<string, IntegrationItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const steps = [
    { title: "Bienvenue", icon: Rocket },
    { title: "Installer", icon: Download },
    { title: "Integrations", icon: Zap },
    { title: "Prêt !", icon: Check },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f1729] via-[#1a2744] to-[#0f1729] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                i === step ? "bg-amber-500 text-[#0f1729] scale-110" :
                i < step ? "bg-emerald-500 text-white" :
                "bg-white/10 text-white/40"
              }`}>
                {i < step ? <Check className="w-5 h-5" /> : <s.icon className="w-5 h-5" />}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-12 h-0.5 ${i < step ? "bg-emerald-500" : "bg-white/10"}`} />
              )}
            </div>
          ))}
        </div>

        <Card className="bg-white/5 backdrop-blur-xl border-white/10 text-white overflow-hidden">
          <CardContent className="p-8">
            {step === 0 && (
              <div className="text-center space-y-6">
                <div className="w-20 h-20 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto">
                  <Rocket className="w-10 h-10 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Bienvenue sur Agent de Bureau !</h2>
                  <p className="text-white/60 text-sm leading-relaxed max-w-md mx-auto">
                    Configurons votre espace de travail en quelques etapes. 
                    Nous allons vous aider a installer l'application et connecter vos outils préférés.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-4">
                  <div className="bg-white/5 rounded-xl p-4 text-center">
                    <Smartphone className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                    <p className="text-xs text-white/60">Application mobile & desktop</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-4 text-center">
                    <Zap className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                    <p className="text-xs text-white/60">20+ integrations disponibles</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-4 text-center">
                    <Globe className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                    <p className="text-xs text-white/60">Accessible partout</p>
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center">
                  <h2 className="text-xl font-bold mb-2">Installer l'application</h2>
                  <p className="text-white/60 text-sm">
                    Installez Agent de Bureau sur vos appareils pour un accès rapide.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center shrink-0">
                        <Smartphone className="w-6 h-6 text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">Application Desktop / Navigateur</h3>
                        <p className="text-white/50 text-xs mt-1">
                          {isPwaInstalled
                            ? "L'application est installée sur cet appareil !"
                            : "Installez comme une application native depuis votre navigateur."}
                        </p>
                      </div>
                      {isPwaInstalled ? (
                        <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
                          <Check className="w-5 h-5 text-emerald-400" />
                        </div>
                      ) : deferredPrompt ? (
                        <Button size="sm" onClick={handlePwaInstall} className="bg-blue-500 hover:bg-blue-600 text-white text-xs">
                          <Download className="w-3.5 h-3.5 mr-1" />
                          Installer
                        </Button>
                      ) : (
                        <span className="text-white/30 text-xs">Via menu navigateur</span>
                      )}
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center shrink-0">
                        <Globe className="w-6 h-6 text-emerald-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">Application Mobile (iOS / Android)</h3>
                        <p className="text-white/50 text-xs mt-1">
                          Telechargez l'app mobile pour gerer votre bureau en déplacement.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/20 text-white/70 hover:text-white text-xs"
                        onClick={() => window.open(`${baseUrl}/telecharger`, "_blank")}
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1" />
                        Voir
                      </Button>
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center shrink-0">
                        <Globe className="w-6 h-6 text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">Acces Web</h3>
                        <p className="text-white/50 text-xs mt-1">
                          Utilisez Agent de Bureau depuis n'importe quel navigateur, n'importe ou.
                        </p>
                      </div>
                      <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
                        <Check className="w-5 h-5 text-emerald-400" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div className="text-center">
                  <h2 className="text-xl font-bold mb-2">Connectez vos outils</h2>
                  <p className="text-white/60 text-sm">
                    Selectionnez les applications que vous utilisez déjà. Vous pourrez les configurer plus tard.
                  </p>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {Object.entries(categorizedIntegrations).map(([category, items]) => (
                      <div key={category}>
                        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <span>{CATEGORY_ICONS[category] || "📦"}</span>
                          {CATEGORY_LABELS[category] || category}
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                          {items.map(integration => {
                            const selected = selectedIntegrations.has(integration.id);
                            return (
                              <button
                                key={integration.id}
                                onClick={() => toggleIntegration(integration.id)}
                                className={`text-left p-3 rounded-lg border transition-all ${
                                  selected
                                    ? "bg-amber-500/10 border-amber-500/50"
                                    : "bg-white/5 border-white/10 hover:border-white/20"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-5 h-5 rounded flex items-center justify-center text-xs ${
                                    selected ? "bg-amber-500 text-[#0f1729]" : "bg-white/10"
                                  }`}>
                                    {selected && <Check className="w-3 h-3" />}
                                  </div>
                                  <span className="text-sm font-medium truncate">{integration.name}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedIntegrations.size > 0 && (
                  <p className="text-center text-amber-400 text-xs">
                    {selectedIntegrations.size} integration{selectedIntegrations.size > 1 ? "s" : ""} selectionnee{selectedIntegrations.size > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="text-center space-y-6">
                <div className="w-20 h-20 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto">
                  <Check className="w-10 h-10 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Tout est prêt !</h2>
                  <p className="text-white/60 text-sm leading-relaxed max-w-md mx-auto">
                    Votre espace Agent de Bureau est configure. Vous pouvez commencer a 
                    gerer vos appels, contacts et taches dès maintenant.
                  </p>
                </div>
                <div className="bg-white/5 rounded-xl p-5 text-left space-y-3">
                  <h3 className="font-semibold text-sm text-amber-400">Prochaines etapes :</h3>
                  <ul className="space-y-2 text-sm text-white/70">
                    <li className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs text-amber-400">1</div>
                      Ajoutez vos premiers contacts
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs text-amber-400">2</div>
                      Configurez vos integrations dans les paramètres
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs text-amber-400">3</div>
                      Invitez vos collaborateurs
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs text-amber-400">4</div>
                      Explorez le tableau de bord et l'IA
                    </li>
                  </ul>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
              {step > 0 ? (
                <Button variant="ghost" onClick={() => setStep(s => s - 1)} className="text-white/60 hover:text-white">
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Retour
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => { handleComplete(); }} className="text-white/40 hover:text-white/60 text-xs">
                  <X className="w-3.5 h-3.5 mr-1" />
                  Passer
                </Button>
              )}

              {step < steps.length - 1 ? (
                <Button onClick={() => setStep(s => s + 1)} className="bg-amber-500 hover:bg-amber-600 text-[#0f1729] font-semibold">
                  Continuer
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleComplete} disabled={completing} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold">
                  {completing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
                  Commencer !
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
