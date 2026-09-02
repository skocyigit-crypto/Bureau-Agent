import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { useTranslation } from "@/i18n";
import { Check,ChevronLeft,ChevronRight,Download,ExternalLink,Globe,Loader2,Rocket,Smartphone,X,Zap } from "lucide-react";
import { useCallback,useEffect,useState } from "react";

interface IntegrationItem {
  id: string;
  name: string;
  category: string;
  description: string;
  features: string[];
  status: "connecte" | "deconnecte" | "en_attente";
}

const CATEGORY_LABELS: Record<string, string> = {
  crm: "onboarding.categories.crm",
  communication: "onboarding.categories.communication",
  gestion_projet: "onboarding.categories.gestion_projet",
  comptabilite: "onboarding.categories.comptabilite",
  documents: "onboarding.categories.documents",
  messagerie: "onboarding.categories.messagerie",
  marketing: "onboarding.categories.marketing",
  automatisation: "onboarding.categories.automatisation",
  support: "onboarding.categories.support",
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
  const { t } = useTranslation();
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
    { title: t("onboarding.steps.welcome"), icon: Rocket },
    { title: t("onboarding.steps.install"), icon: Download },
    { title: t("onboarding.steps.integrations"), icon: Zap },
    { title: t("onboarding.steps.ready"), icon: Check },
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
                  <h2 className="text-2xl font-bold mb-2">{t("onboarding.welcome.title")}</h2>
                  <p className="text-white/60 text-sm leading-relaxed max-w-md mx-auto">
                    {t("onboarding.welcome.desc")}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-4">
                  <div className="bg-white/5 rounded-xl p-4 text-center">
                    <Smartphone className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                    <p className="text-xs text-white/60">{t("onboarding.welcome.feat1")}</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-4 text-center">
                    <Zap className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                    <p className="text-xs text-white/60">{t("onboarding.welcome.feat2")}</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-4 text-center">
                    <Globe className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                    <p className="text-xs text-white/60">{t("onboarding.welcome.feat3")}</p>
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center">
                  <h2 className="text-xl font-bold mb-2">{t("onboarding.install.title")}</h2>
                  <p className="text-white/60 text-sm">
                    {t("onboarding.install.desc")}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center shrink-0">
                        <Smartphone className="w-6 h-6 text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">{t("onboarding.install.desktopTitle")}</h3>
                        <p className="text-white/50 text-xs mt-1">
                          {isPwaInstalled
                            ? t("onboarding.install.desktopInstalled")
                            : t("onboarding.install.desktopDesc")}
                        </p>
                      </div>
                      {isPwaInstalled ? (
                        <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
                          <Check className="w-5 h-5 text-emerald-400" />
                        </div>
                      ) : deferredPrompt ? (
                        <Button size="sm" onClick={handlePwaInstall} className="bg-blue-500 hover:bg-blue-600 text-white text-xs">
                          <Download className="w-3.5 h-3.5 mr-1" />
                          {t("onboarding.install.install")}
                        </Button>
                      ) : (
                        <span className="text-white/30 text-xs">{t("onboarding.install.viaBrowser")}</span>
                      )}
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center shrink-0">
                        <Globe className="w-6 h-6 text-emerald-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">{t("onboarding.install.mobileTitle")}</h3>
                        <p className="text-white/50 text-xs mt-1">
                          {t("onboarding.install.mobileDesc")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/20 text-white/70 hover:text-white text-xs"
                        onClick={() => window.open(`${baseUrl}/telecharger`, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1" />
                        {t("onboarding.install.view")}
                      </Button>
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center shrink-0">
                        <Globe className="w-6 h-6 text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">{t("onboarding.install.webTitle")}</h3>
                        <p className="text-white/50 text-xs mt-1">
                          {t("onboarding.install.webDesc")}
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
                  <h2 className="text-xl font-bold mb-2">{t("onboarding.integrations.title")}</h2>
                  <p className="text-white/60 text-sm">
                    {t("onboarding.integrations.desc")}
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
                          {CATEGORY_LABELS[category] ? t(CATEGORY_LABELS[category]) : category}
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
                    {t("onboarding.integrations.selectedCount", { count: selectedIntegrations.size })}
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
                  <h2 className="text-2xl font-bold mb-2">{t("onboarding.ready.title")}</h2>
                  <p className="text-white/60 text-sm leading-relaxed max-w-md mx-auto">
                    {t("onboarding.ready.desc")}
                  </p>
                </div>
                <div className="bg-white/5 rounded-xl p-5 text-left space-y-3">
                  <h3 className="font-semibold text-sm text-amber-400">{t("onboarding.ready.nextSteps")}</h3>
                  <ul className="space-y-2 text-sm text-white/70">
                    <li className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs text-amber-400">1</div>
                      {t("onboarding.ready.step1")}
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs text-amber-400">2</div>
                      {t("onboarding.ready.step2")}
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs text-amber-400">3</div>
                      {t("onboarding.ready.step3")}
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-xs text-amber-400">4</div>
                      {t("onboarding.ready.step4")}
                    </li>
                  </ul>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
              {step > 0 ? (
                <Button variant="ghost" onClick={() => setStep(s => s - 1)} className="text-white/60 hover:text-white">
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  {t("common.back")}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => { handleComplete(); }} className="text-white/40 hover:text-white/60 text-xs">
                  <X className="w-3.5 h-3.5 mr-1" />
                  {t("onboarding.skip")}
                </Button>
              )}

              {step < steps.length - 1 ? (
                <Button onClick={() => setStep(s => s + 1)} className="bg-amber-500 hover:bg-amber-600 text-[#0f1729] font-semibold">
                  {t("onboarding.continue")}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleComplete} disabled={completing} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold">
                  {completing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
                  {t("onboarding.start")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
