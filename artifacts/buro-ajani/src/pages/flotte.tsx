import { useState, useEffect, useCallback } from "react";
import {
  Truck,
  Loader2,
  Plus,
  Save,
  X,
  Pencil,
  Trash2,
  AlertTriangle,
  Wrench,
  Gauge,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface Vehicule {
  id: number;
  plateNumber: string;
  brandModel: string;
  currentMileage: number;
  nextServiceMileage: number | null;
  lastKnownFaultCode: string;
  assignedProjetId: number | null;
  status: string;
  serviceDue: boolean;
  hasFault: boolean;
  needsAttention: boolean;
}

interface Projet {
  id: number;
  title: string;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "disponible", label: "Disponible" },
  { value: "en_service", label: "En service" },
  { value: "maintenance", label: "En maintenance" },
  { value: "hors_service", label: "Hors service" },
];

const STATUS_TINT: Record<string, string> = {
  disponible: "bg-emerald-100 text-emerald-700",
  en_service: "bg-blue-100 text-blue-700",
  maintenance: "bg-amber-100 text-amber-700",
  hors_service: "bg-gray-200 text-gray-700",
};

const statusLabel = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;

const km = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n).toLocaleString("fr-FR")} km`;

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

interface FormState {
  plateNumber: string;
  brandModel: string;
  currentMileage: string;
  nextServiceMileage: string;
  lastKnownFaultCode: string;
  assignedProjetId: string;
  status: string;
}

const emptyForm: FormState = {
  plateNumber: "",
  brandModel: "",
  currentMileage: "0",
  nextServiceMileage: "",
  lastKnownFaultCode: "NONE",
  assignedProjetId: "",
  status: "disponible",
};

export default function FlottePage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [vehicules, setVehicules] = useState<Vehicule[]>([]);
  const [projets, setProjets] = useState<Projet[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const projetTitle = useCallback(
    (id: number | null) => (id == null ? null : projets.find((p) => p.id === id)?.title ?? `Chantier #${id}`),
    [projets],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/vehicules`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setVehicules(Array.isArray(data?.vehicules) ? data.vehicules : []);
    } catch {
      toast({
        title: "Chargement impossible",
        description: "Impossible de charger la flotte.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadProjets = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/projets`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      const list: any[] = Array.isArray(data) ? data : (data?.projets ?? data?.items ?? []);
      setProjets(
        list
          .filter((p) => p && typeof p.id === "number")
          .map((p) => ({ id: p.id, title: p.title ?? p.nom ?? `Chantier #${p.id}` })),
      );
    } catch {
      /* dropdown chantier optionnel — pas bloquant */
    }
  }, []);

  useEffect(() => {
    load();
    loadProjets();
  }, [load, loadProjets]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (v: Vehicule) => {
    setEditingId(v.id);
    setForm({
      plateNumber: v.plateNumber,
      brandModel: v.brandModel,
      currentMileage: String(v.currentMileage),
      nextServiceMileage: v.nextServiceMileage == null ? "" : String(v.nextServiceMileage),
      lastKnownFaultCode: v.lastKnownFaultCode || "NONE",
      assignedProjetId: v.assignedProjetId == null ? "" : String(v.assignedProjetId),
      status: v.status,
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const save = async () => {
    const plateNumber = form.plateNumber.trim();
    const brandModel = form.brandModel.trim();
    if (!plateNumber || !brandModel) {
      toast({
        title: "Champs requis",
        description: "Renseignez l'immatriculation et la marque/modèle.",
        variant: "destructive",
      });
      return;
    }
    const currentMileage = Number(form.currentMileage || 0);
    if (!Number.isFinite(currentMileage) || currentMileage < 0) {
      toast({ title: "Kilométrage invalide", description: "Saisissez un kilométrage positif.", variant: "destructive" });
      return;
    }
    const nextServiceMileage =
      form.nextServiceMileage.trim() === "" ? null : Number(form.nextServiceMileage);
    if (nextServiceMileage != null && (!Number.isFinite(nextServiceMileage) || nextServiceMileage < 0)) {
      toast({ title: "Seuil invalide", description: "Le seuil d'entretien doit être positif.", variant: "destructive" });
      return;
    }

    const payload = {
      plateNumber,
      brandModel,
      currentMileage: Math.round(currentMileage),
      nextServiceMileage: nextServiceMileage == null ? null : Math.round(nextServiceMileage),
      lastKnownFaultCode: form.lastKnownFaultCode.trim() || "NONE",
      assignedProjetId: form.assignedProjetId === "" ? null : Number(form.assignedProjetId),
      status: form.status,
    };

    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/vehicules/${editingId}` : `${BASE}/api/vehicules`;
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || String(res.status));
      }
      toast({
        title: editingId ? "Véhicule mis à jour" : "Véhicule ajouté",
        description: `${brandModel} (${plateNumber}) enregistré.`,
      });
      closeForm();
      load();
    } catch (e) {
      toast({
        title: "Échec",
        description: e instanceof Error ? e.message : "Enregistrement impossible.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (v: Vehicule) => {
    if (!window.confirm(`Supprimer ${v.brandModel} (${v.plateNumber}) ?`)) return;
    setDeletingId(v.id);
    try {
      const res = await fetch(`${BASE}/api/vehicules/${v.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      toast({ title: "Supprimé", description: `${v.plateNumber} retiré de la flotte.` });
      setVehicules((prev) => prev.filter((x) => x.id !== v.id));
    } catch {
      toast({ title: "Échec", description: "Suppression impossible.", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const attentionCount = vehicules.filter((v) => v.needsAttention).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sky-100 p-2.5 text-sky-700">
            <Truck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Flotte &amp; Entretien</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Gérez votre parc de véhicules (camions, utilitaires…). Quand un code défaut remonte ou que
              le kilométrage atteint le seuil d'entretien, l'assistant proactif vous propose un
              rendez-vous d'entretien. Aucune réservation automatique — uniquement des suggestions.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="icon" onClick={load} title="Rafraîchir">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Ajouter un véhicule
          </Button>
        </div>
      </div>

      {attentionCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {attentionCount} véhicule(s) nécessitent une attention (code défaut ou entretien dû).
        </div>
      )}

      {/* Formulaire création / édition */}
      {formOpen && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-lg">
              <span>{editingId ? "Modifier le véhicule" : "Nouveau véhicule"}</span>
              <Button variant="ghost" size="icon" onClick={closeForm}>
                <X className="h-4 w-4" />
              </Button>
            </CardTitle>
            <CardDescription>
              Le kilométrage et le code défaut alimentent les suggestions d'entretien.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plate">Immatriculation *</Label>
                <Input
                  id="plate"
                  value={form.plateNumber}
                  onChange={(e) => setForm({ ...form, plateNumber: e.target.value })}
                  placeholder="Ex : AB-123-CD"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand">Marque &amp; modèle *</Label>
                <Input
                  id="brand"
                  value={form.brandModel}
                  onChange={(e) => setForm({ ...form, brandModel: e.target.value })}
                  placeholder="Ex : Mercedes Atego"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mileage">Kilométrage actuel</Label>
                <Input
                  id="mileage"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={form.currentMileage}
                  onChange={(e) => setForm({ ...form, currentMileage: e.target.value })}
                  placeholder="Ex : 125000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nextservice">Seuil d'entretien (km)</Label>
                <Input
                  id="nextservice"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={form.nextServiceMileage}
                  onChange={(e) => setForm({ ...form, nextServiceMileage: e.target.value })}
                  placeholder="Ex : 130000"
                />
                <p className="text-xs text-muted-foreground">
                  Quand le kilométrage l'atteint, une suggestion d'entretien est créée.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fault">Code défaut</Label>
                <Input
                  id="fault"
                  value={form.lastKnownFaultCode}
                  onChange={(e) => setForm({ ...form, lastKnownFaultCode: e.target.value })}
                  placeholder='"NONE" si aucun, ex : P0420'
                />
                <p className="text-xs text-muted-foreground">
                  Laissez « NONE » si aucun défaut. Toute autre valeur déclenche une alerte.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status">Statut</Label>
                <select
                  id="status"
                  className={selectClass}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="projet">Chantier affecté (optionnel)</Label>
                <select
                  id="projet"
                  className={selectClass}
                  value={form.assignedProjetId}
                  onChange={(e) => setForm({ ...form, assignedProjetId: e.target.value })}
                >
                  <option value="">— Aucun —</option>
                  {projets.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {editingId ? "Enregistrer" : "Ajouter"}
              </Button>
              <Button variant="ghost" onClick={closeForm} disabled={saving}>
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Liste des véhicules */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : vehicules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <Truck className="h-10 w-10 opacity-40" />
            <p>Aucun véhicule pour le moment. Ajoutez votre premier camion ou utilitaire.</p>
            <Button onClick={openCreate} variant="secondary">
              <Plus className="mr-2 h-4 w-4" /> Ajouter un véhicule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {vehicules.map((v) => {
            const projet = projetTitle(v.assignedProjetId);
            return (
              <Card key={v.id} className={v.needsAttention ? "border-amber-300" : undefined}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{v.brandModel}</span>
                      <Badge variant="outline" className="font-mono">
                        {v.plateNumber}
                      </Badge>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TINT[v.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {statusLabel(v.status)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3.5 w-3.5" /> {km(v.currentMileage)}
                      </span>
                      {v.nextServiceMileage != null && (
                        <span className="flex items-center gap-1">
                          <Wrench className="h-3.5 w-3.5" /> Entretien à {km(v.nextServiceMileage)}
                        </span>
                      )}
                      {projet && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {projet}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {v.hasFault && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" /> Défaut : {v.lastKnownFaultCode}
                        </Badge>
                      )}
                      {v.serviceDue && (
                        <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700">
                          <Wrench className="h-3 w-3" /> Entretien dû
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(v)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => remove(v)}
                      disabled={deletingId === v.id}
                    >
                      {deletingId === v.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
