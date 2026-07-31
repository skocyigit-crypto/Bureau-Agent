import { PhoneSimulator,PhoneSimulatorDialog } from "@/components/phone-simulator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
CheckCheck,
CheckCircle2,
CloudDownload,
Cpu,
Download,
Globe,
HardDrive,
Laptop,
Monitor,
Package,
Play,
RefreshCcw,
Share2,
Smartphone,
Upload
} from "lucide-react";
import { useState } from "react";

export function TabInstallation() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <Card className="border-blue-200 dark:border-blue-900/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Laptop className="w-5 h-5 text-blue-600" />
                {t("settingsInstallation.mac.title")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("settingsInstallation.mac.desc")}
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs gap-1">
              <Monitor className="w-3 h-3" />
              {t("settingsInstallation.mac.badge")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-5 hover:border-blue-300 transition-colors relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 dark:bg-blue-950/20 rounded-bl-full" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Package className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{t("settingsInstallation.native.title")}</h3>
                    <p className="text-[10px] text-muted-foreground">{t("settingsInstallation.native.subtitle")}</p>
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  {[t("settingsInstallation.native.f1"), t("settingsInstallation.native.f2"), t("settingsInstallation.native.f3"), t("settingsInstallation.native.f4"), t("settingsInstallation.native.f5")].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <Button className="w-full gap-2" onClick={() => toast({ title: t("settingsInstallation.native.toastTitle"), description: t("settingsInstallation.native.toastDesc") })}>
                  <CloudDownload className="w-4 h-4" />
                  {t("settingsInstallation.native.download")}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center mt-2">{t("settingsInstallation.native.version")}</p>
              </div>
            </div>

            <div className="border rounded-xl p-5 hover:border-emerald-300 transition-colors relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 dark:bg-emerald-950/20 rounded-bl-full" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                    <Globe className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{t("settingsInstallation.pwa.title")}</h3>
                    <p className="text-[10px] text-muted-foreground">{t("settingsInstallation.pwa.subtitle")}</p>
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  {[t("settingsInstallation.pwa.f1"), t("settingsInstallation.pwa.f2"), t("settingsInstallation.pwa.f3"), t("settingsInstallation.pwa.f4"), t("settingsInstallation.pwa.f5")].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <Button variant="outline" className="w-full gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30" onClick={() => toast({ title: t("settingsInstallation.pwa.toastTitle"), description: t("settingsInstallation.pwa.toastDesc") })}>
                  <Share2 className="w-4 h-4" />
                  {t("settingsInstallation.pwa.install")}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center mt-2">{t("settingsInstallation.pwa.hint")}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="w-5 h-5 text-blue-600" />
            {t("settingsInstallation.migration.title")}
          </CardTitle>
          <CardDescription>{t("settingsInstallation.migration.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-lg p-4">
            <h4 className="font-semibold text-sm text-blue-800 dark:text-blue-300 mb-2">{t("settingsInstallation.migration.migratedTitle")}</h4>
            <div className="grid grid-cols-2 gap-2">
              {[t("settingsInstallation.migration.m1"), t("settingsInstallation.migration.m2"), t("settingsInstallation.migration.m3"), t("settingsInstallation.migration.m4"), t("settingsInstallation.migration.m5"), t("settingsInstallation.migration.m6"), t("settingsInstallation.migration.m7"), t("settingsInstallation.migration.m8")].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium">{t("settingsInstallation.migration.processTitle")}</h4>
            {[
              { step: 1, title: t("settingsInstallation.migration.step1Title"), desc: t("settingsInstallation.migration.step1Desc"), btn: t("settingsInstallation.migration.step1Btn"), icon: Download, action: t("settingsInstallation.migration.step1Action") },
              { step: 2, title: t("settingsInstallation.migration.step2Title"), desc: t("settingsInstallation.migration.step2Desc"), multiBtn: true },
              { step: 3, title: t("settingsInstallation.migration.step3Title"), desc: t("settingsInstallation.migration.step3Desc"), btn: t("settingsInstallation.migration.step3Btn"), icon: Upload, action: t("settingsInstallation.migration.step3Action") },
              { step: 4, title: t("settingsInstallation.migration.step4Title"), desc: t("settingsInstallation.migration.step4Desc"), btn: t("settingsInstallation.migration.step4Btn"), icon: RefreshCcw, action: t("settingsInstallation.migration.step4Action"), highlight: true },
            ].map((s) => (
              <div key={s.step} className={`border rounded-lg p-4 ${s.highlight ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10" : ""}`}>
                <div className="flex items-start gap-4">
                  <div className={`w-8 h-8 rounded-full ${s.highlight ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"} flex items-center justify-center text-sm font-bold shrink-0`}>{s.step}</div>
                  <div className="flex-1">
                    <h5 className="text-sm font-medium">{s.title}</h5>
                    <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                    {s.multiBtn ? (
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm" className="gap-2" onClick={() => toast({ title: t("settingsInstallation.migration.dlTitle"), description: t("settingsInstallation.migration.dlArm") })}>
                          <Cpu className="w-3.5 h-3.5" /> {t("settingsInstallation.migration.btnArm")}
                        </Button>
                        <Button variant="outline" size="sm" className="gap-2" onClick={() => toast({ title: t("settingsInstallation.migration.dlTitle"), description: t("settingsInstallation.migration.dlIntel") })}>
                          <HardDrive className="w-3.5 h-3.5" /> {t("settingsInstallation.migration.btnIntel")}
                        </Button>
                      </div>
                    ) : s.btn && s.icon && (
                      <Button variant="outline" size="sm" className={`mt-2 gap-2 ${s.highlight ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : ""}`} onClick={() => toast({ title: s.step === 1 ? t("settingsInstallation.migration.toastExport") : s.step === 3 ? t("settingsInstallation.migration.toastImport") : t("settingsInstallation.migration.toastVerify"), description: s.action! })}>
                        <s.icon className="w-3.5 h-3.5" /> {s.btn}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="w-5 h-5" />
            {t("settingsInstallation.compat.title")}
          </CardTitle>
          <CardDescription>{t("settingsInstallation.compat.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded-lg p-4 text-center">
              <div className="mx-auto w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-3">
                <Laptop className="w-6 h-6 text-blue-600" />
              </div>
              <h4 className="font-semibold text-sm">macOS</h4>
              <p className="text-xs text-muted-foreground mt-1">{t("settingsInstallation.compat.macDesc")}</p>
              <div className="mt-3 space-y-1">
                {[t("settingsInstallation.compat.macF1"), t("settingsInstallation.compat.macF2"), t("settingsInstallation.compat.macF3")].map((f) => (
                  <div key={f} className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" /> <span>{f}</span>
                  </div>
                ))}
              </div>
              <Badge className="mt-3 bg-blue-100 text-blue-700 border-0 text-[10px]">{t("settingsInstallation.compat.macBadge")}</Badge>
            </div>

            <div className="border rounded-lg p-4 text-center">
              <div className="mx-auto w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-3">
                <Monitor className="w-6 h-6 text-purple-600" />
              </div>
              <h4 className="font-semibold text-sm">Windows</h4>
              <p className="text-xs text-muted-foreground mt-1">{t("settingsInstallation.compat.winDesc")}</p>
              <div className="mt-3 space-y-1">
                {[t("settingsInstallation.compat.winF1"), t("settingsInstallation.compat.winF2"), t("settingsInstallation.compat.winF3")].map((f) => (
                  <div key={f} className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" /> <span>{f}</span>
                  </div>
                ))}
              </div>
              <Badge variant="outline" className="mt-3 text-[10px]">{t("settingsInstallation.compat.winBadge")}</Badge>
            </div>

            <div className="border rounded-lg p-4 text-center border-amber-200 dark:border-amber-800 bg-gradient-to-b from-amber-50/50 to-transparent dark:from-amber-950/10">
              <div className="mx-auto w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
                <Smartphone className="w-6 h-6 text-amber-600" />
              </div>
              <h4 className="font-semibold text-sm">{t("settingsInstallation.compat.mobileTitle")}</h4>
              <p className="text-xs text-muted-foreground mt-1">{t("settingsInstallation.compat.mobileDesc")}</p>
              <div className="mt-3 space-y-1">
                {[t("settingsInstallation.compat.mobileF1"), t("settingsInstallation.compat.mobileF2"), t("settingsInstallation.compat.mobileF3")].map((f) => (
                  <div key={f} className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" /> <span>{f}</span>
                  </div>
                ))}
              </div>
              <Button size="sm" className="mt-3 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setPhoneDialogOpen(true)}>
                <Play className="w-3 h-3" /> {t("settingsInstallation.compat.mobileBtn")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-200 dark:border-amber-900/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-amber-600" />
                {t("settingsInstallation.preview.title")}
              </CardTitle>
              <CardDescription className="mt-1">{t("settingsInstallation.preview.desc")}</CardDescription>
            </div>
            <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px] gap-1">
              <Smartphone className="w-3 h-3" /> {t("settingsInstallation.preview.badge")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col lg:flex-row items-start gap-8">
            <PhoneSimulator className="shrink-0" />
            <div className="flex-1 space-y-4">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">{t("settingsInstallation.preview.featuresTitle")}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: t("settingsInstallation.preview.f1l"), desc: t("settingsInstallation.preview.f1d") },
                    { label: t("settingsInstallation.preview.f2l"), desc: t("settingsInstallation.preview.f2d") },
                    { label: t("settingsInstallation.preview.f3l"), desc: t("settingsInstallation.preview.f3d") },
                    { label: t("settingsInstallation.preview.f4l"), desc: t("settingsInstallation.preview.f4d") },
                    { label: t("settingsInstallation.preview.f5l"), desc: t("settingsInstallation.preview.f5d") },
                    { label: t("settingsInstallation.preview.f6l"), desc: t("settingsInstallation.preview.f6d") },
                    { label: t("settingsInstallation.preview.f7l"), desc: t("settingsInstallation.preview.f7d") },
                    { label: t("settingsInstallation.preview.f8l"), desc: t("settingsInstallation.preview.f8d") },
                    { label: t("settingsInstallation.preview.f9l"), desc: t("settingsInstallation.preview.f9d") },
                    { label: t("settingsInstallation.preview.f10l"), desc: t("settingsInstallation.preview.f10d") },
                  ].map((f, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium">{f.label}</p>
                        <p className="text-[10px] text-muted-foreground">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <PhoneSimulatorDialog open={phoneDialogOpen} onOpenChange={setPhoneDialogOpen} />
    </div>
  );
}
