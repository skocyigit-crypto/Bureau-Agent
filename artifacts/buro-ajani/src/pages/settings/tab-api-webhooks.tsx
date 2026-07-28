import { useMemo, useState } from "react";
import {
  Webhook, KeyRound, Plus, Trash2, RotateCw, Eye, Copy, Check,
  ListChecks, Loader2, ShieldAlert, Power, PowerOff, AlertTriangle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWebhooks, useCreateWebhook, useUpdateWebhook, useDeleteWebhook,
  useRotateWebhookSecret, useListWebhookDeliveries, useRetryWebhookDelivery,
  useListApiKeys, useCreateApiKey, useRevealApiKey, useRevokeApiKey,
  getListWebhooksQueryKey, getListApiKeysQueryKey, getListWebhookDeliveriesQueryKey,
  type WebhookEndpoint, type ApiKeySummary,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";

// Catalogue d'événements proposés. Les noms suivent le format `type.action`
// émis par le broadcaster serveur (cf. webhook-service.eventName). La valeur
// "*" souscrit à TOUS les événements.
const EVENT_RESOURCES: { key: string; label: string }[] = [
  { key: "contact", label: "Contacts" },
  { key: "call", label: "Appels" },
  { key: "message", label: "Messages" },
  { key: "task", label: "Tâches" },
  { key: "calendar", label: "Agenda" },
  { key: "note", label: "Notes" },
  { key: "projet", label: "Projets" },
  { key: "reminder", label: "Rappels" },
  { key: "checkin", label: "Pointages" },
  { key: "whatsapp", label: "WhatsApp" },
];
const EVENT_ACTIONS: { key: string; label: string }[] = [
  { key: "created", label: "Créé" },
  { key: "updated", label: "Modifié" },
  { key: "deleted", label: "Supprimé" },
];

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function errMsg(err: unknown, fallback: string): string {
  const e = err as { message?: string; error?: string } | undefined;
  return e?.error || e?.message || fallback;
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      title={t("settingsApiWebhooks.copy")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard indisponible : l'utilisateur peut sélectionner le texte */
        }
      }}
    >
      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

/** Encart affichant un secret en clair une seule fois, avec bouton de copie. */
function SecretReveal({ label, secret }: { label: string; secret: string }) {
  const { t } = useTranslation();
  return (
    <Alert className="border-amber-300 bg-amber-50">
      <ShieldAlert className="h-4 w-4 text-amber-600" />
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription>
        <p className="mb-2 text-sm">
          {t("settingsApiWebhooks.secretReveal.text")} <strong>{t("settingsApiWebhooks.secretReveal.strong")}</strong>.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs ring-1 ring-amber-200">
            {secret}
          </code>
          <CopyButton value={secret} />
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function TabApiWebhooks() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // ----- Webhooks -----
  const webhooksQuery = useListWebhooks();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const rotateSecret = useRotateWebhookSecret();

  const [createOpen, setCreateOpen] = useState(false);
  const [formUrl, setFormUrl] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formAllEvents, setFormAllEvents] = useState(false);
  const [formEvents, setFormEvents] = useState<Set<string>>(new Set());
  const [secretReveal, setSecretReveal] = useState<{ title: string; secret: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookEndpoint | null>(null);

  const invalidateWebhooks = () =>
    qc.invalidateQueries({ queryKey: getListWebhooksQueryKey() });

  function toggleEvent(name: string) {
    setFormEvents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const selectedEventList = useMemo(
    () => (formAllEvents ? ["*"] : Array.from(formEvents)),
    [formAllEvents, formEvents],
  );

  function resetForm() {
    setFormUrl("");
    setFormDesc("");
    setFormAllEvents(false);
    setFormEvents(new Set());
  }

  function submitCreate() {
    if (!formUrl.trim()) {
      toast({ title: t("settingsApiWebhooks.toast.urlRequired"), description: t("settingsApiWebhooks.toast.urlRequiredDesc"), variant: "destructive" });
      return;
    }
    if (selectedEventList.length === 0) {
      toast({ title: t("settingsApiWebhooks.toast.noEvent"), description: t("settingsApiWebhooks.toast.noEventDesc"), variant: "destructive" });
      return;
    }
    createWebhook.mutate(
      {
        data: {
          url: formUrl.trim(),
          description: formDesc.trim() || undefined,
          events: selectedEventList,
          active: true,
        },
      },
      {
        onSuccess: (created) => {
          setCreateOpen(false);
          resetForm();
          invalidateWebhooks();
          if (created.secret) {
            setSecretReveal({ title: t("settingsApiWebhooks.toast.secretTitle"), secret: created.secret });
          }
          toast({ title: t("settingsApiWebhooks.toast.webhookCreated"), description: created.url });
        },
        onError: (err) =>
          toast({ title: t("settingsApiWebhooks.toast.createFailed"), description: errMsg(err, t("settingsApiWebhooks.toast.createFailedDesc")), variant: "destructive" }),
      },
    );
  }

  function toggleActive(ep: WebhookEndpoint) {
    updateWebhook.mutate(
      { id: ep.id, data: { active: !ep.active } },
      {
        onSuccess: () => {
          invalidateWebhooks();
          toast({
            title: ep.active ? t("settingsApiWebhooks.toast.webhookDisabled") : t("settingsApiWebhooks.toast.webhookEnabled"),
            description: ep.active ? undefined : t("settingsApiWebhooks.toast.failureReset"),
          });
        },
        onError: (err) =>
          toast({ title: t("settingsApiWebhooks.toast.failure"), description: errMsg(err, t("settingsApiWebhooks.toast.updateFailed")), variant: "destructive" }),
      },
    );
  }

  function doRotate(ep: WebhookEndpoint) {
    rotateSecret.mutate(
      { id: ep.id },
      {
        onSuccess: (res) => {
          invalidateWebhooks();
          if (res.secret) setSecretReveal({ title: t("settingsApiWebhooks.toast.newSecretTitle"), secret: res.secret });
        },
        onError: (err) =>
          toast({ title: t("settingsApiWebhooks.toast.failure"), description: errMsg(err, t("settingsApiWebhooks.toast.rotateFailed")), variant: "destructive" }),
      },
    );
  }

  function doDelete() {
    if (!deleteTarget) return;
    deleteWebhook.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          invalidateWebhooks();
          toast({ title: t("settingsApiWebhooks.toast.webhookDeleted") });
          setDeleteTarget(null);
        },
        onError: (err) => {
          toast({ title: t("settingsApiWebhooks.toast.failure"), description: errMsg(err, t("settingsApiWebhooks.toast.deleteFailed")), variant: "destructive" });
          setDeleteTarget(null);
        },
      },
    );
  }

  // ----- Clés API -----
  const apiKeysQuery = useListApiKeys();
  const createApiKey = useCreateApiKey();
  const revealApiKey = useRevealApiKey();
  const revokeApiKey = useRevokeApiKey();

  const [keyCreateOpen, setKeyCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyExpiry, setKeyExpiry] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);

  const invalidateKeys = () => qc.invalidateQueries({ queryKey: getListApiKeysQueryKey() });

  function submitCreateKey() {
    if (!keyName.trim()) {
      toast({ title: t("settingsApiWebhooks.toast.nameRequired"), description: t("settingsApiWebhooks.toast.nameRequiredDesc"), variant: "destructive" });
      return;
    }
    createApiKey.mutate(
      {
        data: {
          name: keyName.trim(),
          expiresAt: keyExpiry ? new Date(`${keyExpiry}T23:59:59`).toISOString() : undefined,
        },
      },
      {
        onSuccess: (created) => {
          setKeyCreateOpen(false);
          setKeyName("");
          setKeyExpiry("");
          invalidateKeys();
          if (created.key) setSecretReveal({ title: t("settingsApiWebhooks.toast.keyApiTitle", { name: created.name }), secret: created.key });
          toast({ title: t("settingsApiWebhooks.toast.keyCreated") });
        },
        onError: (err) =>
          toast({ title: t("settingsApiWebhooks.toast.createFailed"), description: errMsg(err, t("settingsApiWebhooks.toast.keyCreateFailedDesc")), variant: "destructive" }),
      },
    );
  }

  function doReveal(k: ApiKeySummary) {
    revealApiKey.mutate(
      { id: k.id },
      {
        onSuccess: (res) => setSecretReveal({ title: t("settingsApiWebhooks.toast.keyApiTitle", { name: k.name }), secret: res.key }),
        onError: (err) =>
          toast({ title: t("settingsApiWebhooks.toast.revealFailed"), description: errMsg(err, t("settingsApiWebhooks.toast.revealFailedDesc")), variant: "destructive" }),
      },
    );
  }

  function doRevoke() {
    if (!revokeTarget) return;
    revokeApiKey.mutate(
      { id: revokeTarget.id },
      {
        onSuccess: () => {
          invalidateKeys();
          toast({ title: t("settingsApiWebhooks.toast.keyRevoked") });
          setRevokeTarget(null);
        },
        onError: (err) => {
          toast({ title: t("settingsApiWebhooks.toast.failure"), description: errMsg(err, t("settingsApiWebhooks.toast.revokeFailed")), variant: "destructive" });
          setRevokeTarget(null);
        },
      },
    );
  }

  const webhooks = webhooksQuery.data ?? [];
  const apiKeys = apiKeysQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* ---------- Webhooks ---------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="w-5 h-5 text-indigo-600" /> {t("settingsApiWebhooks.webhooks.title")}
            </CardTitle>
            <CardDescription>
              {t("settingsApiWebhooks.webhooks.description")}
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" /> {t("settingsApiWebhooks.webhooks.new")}
          </Button>
        </CardHeader>
        <CardContent>
          {webhooksQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("settingsApiWebhooks.loading")}
            </div>
          ) : webhooks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("settingsApiWebhooks.webhooks.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("settingsApiWebhooks.webhooks.colUrl")}</TableHead>
                    <TableHead>{t("settingsApiWebhooks.webhooks.colEvents")}</TableHead>
                    <TableHead>{t("settingsApiWebhooks.webhooks.colState")}</TableHead>
                    <TableHead>{t("settingsApiWebhooks.webhooks.colLastDelivery")}</TableHead>
                    <TableHead className="text-right">{t("settingsApiWebhooks.webhooks.colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webhooks.map((ep) => (
                    <TableRow key={ep.id}>
                      <TableCell className="max-w-[260px]">
                        <span className="block truncate font-mono text-xs" title={ep.url}>{ep.url}</span>
                        {ep.description && (
                          <span className="block truncate text-xs text-muted-foreground" title={ep.description}>
                            {ep.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {ep.events.slice(0, 4).map((e) => (
                            <Badge key={e} variant="secondary" className="font-mono text-[10px]">{e}</Badge>
                          ))}
                          {ep.events.length > 4 && (
                            <Badge variant="outline" className="text-[10px]">+{ep.events.length - 4}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch checked={ep.active} onCheckedChange={() => toggleActive(ep)} />
                          {ep.failureCount > 0 && (
                            <Badge variant="outline" className="gap-1 text-amber-700">
                              <AlertTriangle className="w-3 h-3" />{ep.failureCount}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <span>{fmtDate(ep.lastDeliveryAt)}</span>
                        {ep.lastStatus && <span className="block">{ep.lastStatus}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title={t("settingsApiWebhooks.webhooks.historyTitle")} onClick={() => setDeliveriesFor(ep)}>
                            <ListChecks className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title={t("settingsApiWebhooks.webhooks.regenSecret")} disabled={rotateSecret.isPending} onClick={() => doRotate(ep)}>
                            <RotateCw className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title={t("settingsApiWebhooks.webhooks.delete")} onClick={() => setDeleteTarget(ep)}>
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Clés API ---------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-emerald-600" /> {t("settingsApiWebhooks.keys.title")}
            </CardTitle>
            <CardDescription>
              {t("settingsApiWebhooks.keys.description")}
            </CardDescription>
          </div>
          <Button onClick={() => setKeyCreateOpen(true)} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" /> {t("settingsApiWebhooks.keys.new")}
          </Button>
        </CardHeader>
        <CardContent>
          {apiKeysQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("settingsApiWebhooks.loading")}
            </div>
          ) : apiKeys.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("settingsApiWebhooks.keys.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("settingsApiWebhooks.keys.colName")}</TableHead>
                    <TableHead>{t("settingsApiWebhooks.keys.colPrefix")}</TableHead>
                    <TableHead>{t("settingsApiWebhooks.keys.colState")}</TableHead>
                    <TableHead>{t("settingsApiWebhooks.keys.colLastUse")}</TableHead>
                    <TableHead>{t("settingsApiWebhooks.keys.colExpiration")}</TableHead>
                    <TableHead className="text-right">{t("settingsApiWebhooks.keys.colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((k) => {
                    const revoked = !!k.revokedAt;
                    return (
                      <TableRow key={k.id} className={revoked ? "opacity-60" : undefined}>
                        <TableCell className="font-medium">{k.name}</TableCell>
                        <TableCell><code className="font-mono text-xs">{k.keyPrefix}…</code></TableCell>
                        <TableCell>
                          {revoked ? (
                            <Badge variant="outline" className="text-red-700">{t("settingsApiWebhooks.keys.revoked")}</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-emerald-700">{t("settingsApiWebhooks.keys.active")}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(k.lastUsedAt)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(k.expiresAt)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title={t("settingsApiWebhooks.keys.reveal")} disabled={revoked || revealApiKey.isPending} onClick={() => doReveal(k)}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title={t("settingsApiWebhooks.keys.revoke")} disabled={revoked} onClick={() => setRevokeTarget(k)}>
                              <PowerOff className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Dialog : créer un webhook ---------- */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settingsApiWebhooks.createDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("settingsApiWebhooks.createDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wh-url">{t("settingsApiWebhooks.createDialog.urlLabel")}</Label>
              <Input id="wh-url" placeholder={t("settingsApiWebhooks.createDialog.urlPlaceholder")} value={formUrl} onChange={(e) => setFormUrl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-desc">{t("settingsApiWebhooks.createDialog.descLabel")}</Label>
              <Textarea id="wh-desc" rows={2} placeholder={t("settingsApiWebhooks.createDialog.descPlaceholder")} value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("settingsApiWebhooks.createDialog.eventsLabel")}</Label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={formAllEvents} onCheckedChange={(v) => setFormAllEvents(!!v)} />
                {t("settingsApiWebhooks.createDialog.allEventsPrefix")} <code className="font-mono">*</code>)
              </label>
              {!formAllEvents && (
                <div className="rounded-md border p-3">
                  <div className="grid grid-cols-[1fr_repeat(3,minmax(0,auto))] items-center gap-x-3 gap-y-1.5 text-sm">
                    <span />
                    {EVENT_ACTIONS.map((a) => (
                      <span key={a.key} className="text-center text-xs text-muted-foreground">{t(`settingsApiWebhooks.actions.${a.key}`)}</span>
                    ))}
                    {EVENT_RESOURCES.map((r) => (
                      <FragmentRow key={r.key} resource={r} selected={formEvents} onToggle={toggleEvent} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("settingsApiWebhooks.createDialog.cancel")}</Button>
            <Button onClick={submitCreate} disabled={createWebhook.isPending} className="gap-2">
              {createWebhook.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {t("settingsApiWebhooks.createDialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Dialog : créer une clé API ---------- */}
      <Dialog open={keyCreateOpen} onOpenChange={setKeyCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settingsApiWebhooks.keyDialog.title")}</DialogTitle>
            <DialogDescription>{t("settingsApiWebhooks.keyDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">{t("settingsApiWebhooks.keyDialog.nameLabel")}</Label>
              <Input id="key-name" placeholder={t("settingsApiWebhooks.keyDialog.namePlaceholder")} value={keyName} onChange={(e) => setKeyName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-exp">{t("settingsApiWebhooks.keyDialog.expiryLabel")}</Label>
              <Input id="key-exp" type="date" value={keyExpiry} onChange={(e) => setKeyExpiry(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyCreateOpen(false)}>{t("settingsApiWebhooks.keyDialog.cancel")}</Button>
            <Button onClick={submitCreateKey} disabled={createApiKey.isPending} className="gap-2">
              {createApiKey.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {t("settingsApiWebhooks.keyDialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Dialog : révélation d'un secret (une seule fois) ---------- */}
      <Dialog open={!!secretReveal} onOpenChange={(o) => { if (!o) setSecretReveal(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{secretReveal?.title}</DialogTitle>
          </DialogHeader>
          {secretReveal && <SecretReveal label={t("settingsApiWebhooks.secretReveal.label")} secret={secretReveal.secret} />}
          <DialogFooter>
            <Button onClick={() => setSecretReveal(null)}>{t("settingsApiWebhooks.secretDialog.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Dialog : historique des livraisons ---------- */}
      <Dialog open={!!deliveriesFor} onOpenChange={(o) => { if (!o) setDeliveriesFor(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("settingsApiWebhooks.deliveries.title")}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{deliveriesFor?.url}</DialogDescription>
          </DialogHeader>
          {deliveriesFor && <DeliveriesTable endpointId={deliveriesFor.id} />}
        </DialogContent>
      </Dialog>

      {/* ---------- Confirmations destructives ---------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settingsApiWebhooks.confirmDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settingsApiWebhooks.confirmDelete.descPrefix")} <span className="font-mono">{deleteTarget?.url}</span> {t("settingsApiWebhooks.confirmDelete.descSuffix")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settingsApiWebhooks.confirmDelete.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-red-600 hover:bg-red-700">{t("settingsApiWebhooks.confirmDelete.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settingsApiWebhooks.confirmRevoke.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settingsApiWebhooks.confirmRevoke.desc", { name: revokeTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settingsApiWebhooks.confirmRevoke.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={doRevoke} className="bg-red-600 hover:bg-red-700">{t("settingsApiWebhooks.confirmRevoke.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Une ligne ressource dans la grille de sélection d'événements. */
function FragmentRow({
  resource, selected, onToggle,
}: {
  resource: { key: string; label: string };
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <span className="text-sm">{t(`settingsApiWebhooks.resources.${resource.key}`)}</span>
      {EVENT_ACTIONS.map((a) => {
        const name = `${resource.key}.${a.key}`;
        return (
          <div key={a.key} className="flex justify-center">
            <Checkbox checked={selected.has(name)} onCheckedChange={() => onToggle(name)} aria-label={name} />
          </div>
        );
      })}
    </>
  );
}

/** Tableau des livraisons d'un endpoint (chargé à la demande). */
function DeliveriesTable({ endpointId }: { endpointId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useListWebhookDeliveries(endpointId);
  const retryDelivery = useRetryWebhookDelivery();

  function doRetry(deliveryId: number) {
    retryDelivery.mutate(
      { id: endpointId, deliveryId },
      {
        onSuccess: () => {
          // Rafraîchit l'historique (nouveau statut) et la liste (failureCount /
          // dernier statut de l'endpoint changent après la nouvelle tentative).
          qc.invalidateQueries({ queryKey: getListWebhookDeliveriesQueryKey(endpointId) });
          qc.invalidateQueries({ queryKey: getListWebhooksQueryKey() });
          toast({ title: t("settingsApiWebhooks.toast.deliveryRescheduled"), description: t("settingsApiWebhooks.toast.deliveryRescheduledDesc") });
        },
        onError: (err) =>
          toast({ title: t("settingsApiWebhooks.toast.failure"), description: errMsg(err, t("settingsApiWebhooks.toast.retryFailed")), variant: "destructive" }),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {t("settingsApiWebhooks.loading")}
      </div>
    );
  }
  const deliveries = data ?? [];
  if (deliveries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("settingsApiWebhooks.deliveries.empty")}</p>;
  }
  return (
    <div className="max-h-[60vh] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("settingsApiWebhooks.deliveries.colEvent")}</TableHead>
            <TableHead>{t("settingsApiWebhooks.deliveries.colStatus")}</TableHead>
            <TableHead>{t("settingsApiWebhooks.deliveries.colAttempts")}</TableHead>
            <TableHead>{t("settingsApiWebhooks.deliveries.colHttp")}</TableHead>
            <TableHead>{t("settingsApiWebhooks.deliveries.colDate")}</TableHead>
            <TableHead className="text-right">{t("settingsApiWebhooks.deliveries.colActions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((d) => {
            const canRetry = d.status === "failed" || d.status === "retrying";
            return (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    title={d.error ?? undefined}
                    className={
                      d.status === "success" ? "text-emerald-700"
                        : d.status === "failed" ? "text-red-700"
                        : "text-amber-700"
                    }
                  >
                    {d.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{d.attempts}/{d.maxAttempts}</TableCell>
                <TableCell className="text-xs">{d.responseStatus ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(d.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {canRetry && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("settingsApiWebhooks.deliveries.retry")}
                      disabled={retryDelivery.isPending}
                      onClick={() => doRetry(d.id)}
                    >
                      <RotateCw className="w-4 h-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
