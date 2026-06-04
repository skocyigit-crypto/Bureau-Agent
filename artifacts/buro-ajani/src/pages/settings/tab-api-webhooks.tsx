import { useMemo, useState } from "react";
import {
  Webhook, KeyRound, Plus, Trash2, RotateCw, Eye, Copy, Check,
  ListChecks, Loader2, ShieldAlert, Power, PowerOff, AlertTriangle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWebhooks, useCreateWebhook, useUpdateWebhook, useDeleteWebhook,
  useRotateWebhookSecret, useListWebhookDeliveries,
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
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      title="Copier"
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
  return (
    <Alert className="border-amber-300 bg-amber-50">
      <ShieldAlert className="h-4 w-4 text-amber-600" />
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription>
        <p className="mb-2 text-sm">
          Copiez cette valeur maintenant : elle ne sera <strong>plus jamais affichée</strong>.
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
      toast({ title: "URL requise", description: "Indiquez l'URL de destination du webhook.", variant: "destructive" });
      return;
    }
    if (selectedEventList.length === 0) {
      toast({ title: "Aucun événement", description: "Sélectionnez au moins un événement à envoyer.", variant: "destructive" });
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
            setSecretReveal({ title: "Secret de signature du webhook", secret: created.secret });
          }
          toast({ title: "Webhook créé", description: created.url });
        },
        onError: (err) =>
          toast({ title: "Échec de la création", description: errMsg(err, "Impossible de créer le webhook."), variant: "destructive" }),
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
            title: ep.active ? "Webhook désactivé" : "Webhook réactivé",
            description: ep.active ? undefined : "Le compteur d'échecs a été remis à zéro.",
          });
        },
        onError: (err) =>
          toast({ title: "Échec", description: errMsg(err, "Mise à jour impossible."), variant: "destructive" }),
      },
    );
  }

  function doRotate(ep: WebhookEndpoint) {
    rotateSecret.mutate(
      { id: ep.id },
      {
        onSuccess: (res) => {
          invalidateWebhooks();
          if (res.secret) setSecretReveal({ title: "Nouveau secret de signature", secret: res.secret });
        },
        onError: (err) =>
          toast({ title: "Échec", description: errMsg(err, "Rotation impossible."), variant: "destructive" }),
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
          toast({ title: "Webhook supprimé" });
          setDeleteTarget(null);
        },
        onError: (err) => {
          toast({ title: "Échec", description: errMsg(err, "Suppression impossible."), variant: "destructive" });
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
      toast({ title: "Nom requis", description: "Donnez un nom à la clé API.", variant: "destructive" });
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
          if (created.key) setSecretReveal({ title: `Clé API « ${created.name} »`, secret: created.key });
          toast({ title: "Clé API créée" });
        },
        onError: (err) =>
          toast({ title: "Échec de la création", description: errMsg(err, "Impossible de créer la clé."), variant: "destructive" }),
      },
    );
  }

  function doReveal(k: ApiKeySummary) {
    revealApiKey.mutate(
      { id: k.id },
      {
        onSuccess: (res) => setSecretReveal({ title: `Clé API « ${k.name} »`, secret: res.key }),
        onError: (err) =>
          toast({ title: "Révélation impossible", description: errMsg(err, "Accès refusé ou clé introuvable."), variant: "destructive" }),
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
          toast({ title: "Clé révoquée" });
          setRevokeTarget(null);
        },
        onError: (err) => {
          toast({ title: "Échec", description: errMsg(err, "Révocation impossible."), variant: "destructive" });
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
              <Webhook className="w-5 h-5 text-indigo-600" /> Webhooks sortants
            </CardTitle>
            <CardDescription>
              Recevez vos événements (contacts, appels, tâches…) en temps réel sur une URL
              externe. Chaque envoi est signé (HMAC-SHA256) avec le secret affiché à la création.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" /> Nouveau webhook
          </Button>
        </CardHeader>
        <CardContent>
          {webhooksQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
            </div>
          ) : webhooks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucun webhook configuré pour le moment.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>Événements</TableHead>
                    <TableHead>État</TableHead>
                    <TableHead>Dernière livraison</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                          <Button variant="ghost" size="icon" title="Historique des livraisons" onClick={() => setDeliveriesFor(ep)}>
                            <ListChecks className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Régénérer le secret" disabled={rotateSecret.isPending} onClick={() => doRotate(ep)}>
                            <RotateCw className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Supprimer" onClick={() => setDeleteTarget(ep)}>
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
              <KeyRound className="w-5 h-5 text-emerald-600" /> Clés API
            </CardTitle>
            <CardDescription>
              Authentifiez vos intégrations externes. La clé complète n'est affichée
              qu'à la création — conservez-la en lieu sûr.
            </CardDescription>
          </div>
          <Button onClick={() => setKeyCreateOpen(true)} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" /> Nouvelle clé
          </Button>
        </CardHeader>
        <CardContent>
          {apiKeysQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
            </div>
          ) : apiKeys.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucune clé API pour le moment.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Préfixe</TableHead>
                    <TableHead>État</TableHead>
                    <TableHead>Dernière utilisation</TableHead>
                    <TableHead>Expiration</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                            <Badge variant="outline" className="text-red-700">Révoquée</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-emerald-700">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(k.lastUsedAt)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(k.expiresAt)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Révéler la clé" disabled={revoked || revealApiKey.isPending} onClick={() => doReveal(k)}>
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Révoquer" disabled={revoked} onClick={() => setRevokeTarget(k)}>
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
            <DialogTitle>Nouveau webhook</DialogTitle>
            <DialogDescription>
              Définissez l'URL de destination et les événements à recevoir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wh-url">URL de destination</Label>
              <Input id="wh-url" placeholder="https://exemple.com/webhooks" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-desc">Description (optionnel)</Label>
              <Textarea id="wh-desc" rows={2} placeholder="À quoi sert ce webhook ?" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Événements</Label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={formAllEvents} onCheckedChange={(v) => setFormAllEvents(!!v)} />
                Tous les événements (joker <code className="font-mono">*</code>)
              </label>
              {!formAllEvents && (
                <div className="rounded-md border p-3">
                  <div className="grid grid-cols-[1fr_repeat(3,minmax(0,auto))] items-center gap-x-3 gap-y-1.5 text-sm">
                    <span />
                    {EVENT_ACTIONS.map((a) => (
                      <span key={a.key} className="text-center text-xs text-muted-foreground">{a.label}</span>
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button onClick={submitCreate} disabled={createWebhook.isPending} className="gap-2">
              {createWebhook.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Dialog : créer une clé API ---------- */}
      <Dialog open={keyCreateOpen} onOpenChange={setKeyCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nouvelle clé API</DialogTitle>
            <DialogDescription>La clé complète ne sera affichée qu'une seule fois.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Nom</Label>
              <Input id="key-name" placeholder="Ex : Intégration comptabilité" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-exp">Expiration (optionnel)</Label>
              <Input id="key-exp" type="date" value={keyExpiry} onChange={(e) => setKeyExpiry(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyCreateOpen(false)}>Annuler</Button>
            <Button onClick={submitCreateKey} disabled={createApiKey.isPending} className="gap-2">
              {createApiKey.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Créer
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
          {secretReveal && <SecretReveal label="Valeur secrète" secret={secretReveal.secret} />}
          <DialogFooter>
            <Button onClick={() => setSecretReveal(null)}>J'ai copié, fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Dialog : historique des livraisons ---------- */}
      <Dialog open={!!deliveriesFor} onOpenChange={(o) => { if (!o) setDeliveriesFor(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Historique des livraisons</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{deliveriesFor?.url}</DialogDescription>
          </DialogHeader>
          {deliveriesFor && <DeliveriesTable endpointId={deliveriesFor.id} />}
        </DialogContent>
      </Dialog>

      {/* ---------- Confirmations destructives ---------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce webhook ?</AlertDialogTitle>
            <AlertDialogDescription>
              L'endpoint <span className="font-mono">{deleteTarget?.url}</span> ne recevra plus aucun événement.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-red-600 hover:bg-red-700">Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Révoquer cette clé API ?</AlertDialogTitle>
            <AlertDialogDescription>
              La clé « {revokeTarget?.name} » cessera immédiatement de fonctionner. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={doRevoke} className="bg-red-600 hover:bg-red-700">Révoquer</AlertDialogAction>
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
  return (
    <>
      <span className="text-sm">{resource.label}</span>
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
  const { data, isLoading } = useListWebhookDeliveries(endpointId);
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
      </div>
    );
  }
  const deliveries = data ?? [];
  if (deliveries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Aucune livraison enregistrée.</p>;
  }
  return (
    <div className="max-h-[60vh] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Événement</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Tentatives</TableHead>
            <TableHead>HTTP</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    d.status === "delivered" ? "text-emerald-700"
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
