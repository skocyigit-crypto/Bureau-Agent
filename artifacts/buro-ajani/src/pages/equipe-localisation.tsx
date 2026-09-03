/**
 * /equipe/localisation — Patron tarafı: bölge editörü + canlı ekip + 30g geçmiş.
 *
 * Wave 3, slice 3+4. KVKK: sadece administrateur+ erişebilir (sayfa-içi
 * gate; backend `/api/geofences` ve `/api/admin/team-locations` zaten
 * `requireRole("administrateur")` ile gated).
 *
 * - Sol panel: bolgeler listesi + ekle/sil. Yeni bolge: harita uzerinde
 *   tikla -> isim+yaricap iste -> POST /api/geofences.
 * - Orta: harita (Leaflet, OSM tiles). Bolgeler daire olarak, kullanicilar
 *   son bilinen bolgenin merkezi uzerinde marker olarak gosterilir.
 * - Sag panel: canli ekip listesi (son 24s aktif). SSE "checkin"
 *   meta.kind=="geofence" eventiyle anlik refetch.
 * - Alt: "Gecmis" tabi - kullanici secimi + son 30g olaylari.
 */

import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect,useMemo,useRef,useState } from "react";

// ---------------------------------------------------------------------------
// Types (backend ile aynalı, codegen yok zira /location ozel zod uses)
// ---------------------------------------------------------------------------

interface Geofence {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  color: string | null;
  isActive: boolean;
}

// Backend renvoie {states, geofences} ; on les fusionne cote client.
interface TeamState {
  userId: number;
  userNom: string;
  userPrenom: string;
  lastAt: string | null;
  isMoving: boolean;
  currentGeofenceIds: number[] | null;
}
interface TeamGeofenceRef {
  id: number;
  name: string;
  color: string | null;
}
interface TeamLocation {
  userId: number;
  nom: string;
  prenom: string;
  lastAt: string | null;
  isMoving: boolean;
  geofences: Array<{ id: number; name: string }>;
}

interface HistoryEvent {
  id: number;
  userId: number;
  event: "enter" | "exit" | "ping";
  geofenceId: number | null;
  at: string;
}

const API = (path: string) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api${path}`;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EquipeLocalisationPage() {
  const { t } = useTranslation();
  const { user } = useWorkspaceUser();
  const isAdmin = user?.role === "administrateur" || user?.role === "super_admin";

  if (!isAdmin) {
    return (
      <Layout>
        <div className="p-8">
          <Card>
            <CardHeader>
              <CardTitle>{t("equipeLocalisation.restrictedTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {t("equipeLocalisation.restrictedBody")}
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">{t("equipeLocalisation.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("equipeLocalisation.subtitle")}
          </p>
        </div>
        <Tabs defaultValue="live">
          <TabsList>
            <TabsTrigger value="live">{t("equipeLocalisation.tabLive")}</TabsTrigger>
            <TabsTrigger value="history">{t("equipeLocalisation.tabHistory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="mt-4">
            <LiveSection />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <HistorySection />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// LIVE: harita + bolge editoru + ekip listesi
// ---------------------------------------------------------------------------

function LiveSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const geofencesQ = useQuery<{ geofences: Geofence[] }>({
    queryKey: ["geofences"],
    queryFn: () => fetch(API("/geofences"), { credentials: "include" }).then((r) => r.json()),
  });

  const teamQ = useQuery<{ states: TeamState[]; geofences: TeamGeofenceRef[] }>({
    queryKey: ["team-locations"],
    queryFn: () =>
      fetch(API("/admin/team-locations"), { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 60_000,
  });

  // SSE invalidation: harita bolge degisiminde anlik tazelensin.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { type?: string; meta?: { kind?: string } }
        | undefined;
      if (detail?.type === "checkin" && detail?.meta?.kind === "geofence") {
        qc.invalidateQueries({ queryKey: ["team-locations"] });
      }
    };
    window.addEventListener("realtime-sync", handler);
    return () => window.removeEventListener("realtime-sync", handler);
  }, [qc]);

  const createMut = useMutation({
    mutationFn: async (payload: { name: string; lat: number; lng: number; radiusM: number }) => {
      const res = await fetch(API("/geofences"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json())?.error || t("equipeLocalisation.toast.createFailed"));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["geofences"] });
      toast({ title: t("equipeLocalisation.toast.zoneCreated") });
    },
    onError: (err: Error) => toast({ title: t("equipeLocalisation.toast.error"), description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(API(`/geofences/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(t("equipeLocalisation.toast.deleteFailed"));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["geofences"] });
      toast({ title: t("equipeLocalisation.toast.zoneDeleted") });
    },
  });

  const geofences = geofencesQ.data?.geofences ?? [];
  // Fusion (states x geofences) -> shape attendue par UI/MapView/team panel.
  const team: TeamLocation[] = useMemo(() => {
    const states = teamQ.data?.states ?? [];
    const refMap = new Map<number, TeamGeofenceRef>(
      (teamQ.data?.geofences ?? []).map((g) => [g.id, g]),
    );
    return states.map((s) => ({
      userId: s.userId,
      nom: s.userNom,
      prenom: s.userPrenom,
      lastAt: s.lastAt,
      isMoving: s.isMoving,
      geofences: (s.currentGeofenceIds ?? [])
        .map((id) => refMap.get(id))
        .filter((g): g is TeamGeofenceRef => !!g)
        .map((g) => ({ id: g.id, name: g.name })),
    }));
  }, [teamQ.data]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_280px] gap-4">
      {/* Sol: bolgeler */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("equipeLocalisation.zones", { count: geofences.length })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {geofences.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("equipeLocalisation.noZones")}
            </p>
          )}
          {geofences.map((g) => (
            <div key={g.id} className="flex items-center justify-between border rounded p-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{g.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t("equipeLocalisation.radius", { r: g.radiusM })} {g.isActive ? "" : t("equipeLocalisation.inactive")}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm(t("equipeLocalisation.deleteZoneConfirm", { name: g.name }))) deleteMut.mutate(g.id);
                }}
              >
                {t("equipeLocalisation.delete")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Orta: harita */}
      <Card className="min-h-[500px]">
        <CardContent className="p-2">
          <MapView
            geofences={geofences}
            team={team}
            onCreateAt={(lat, lng) => {
              const name = prompt(t("equipeLocalisation.promptZoneName"));
              if (!name) return;
              const r = prompt(t("equipeLocalisation.promptRadius"), "100");
              const radiusM = Math.max(5, Math.min(5000, parseInt(r || "100", 10) || 100));
              createMut.mutate({ name, lat, lng, radiusM });
            }}
          />
        </CardContent>
      </Card>

      {/* Sag: canli ekip */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("equipeLocalisation.liveTeam", { count: team.length })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {team.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("equipeLocalisation.noActiveEmployee")}</p>
          )}
          {team.map((u) => {
            const here = u.geofences.map((g) => g.name).join(", ");
            const ago = u.lastAt ? formatAgo(u.lastAt, t) : "—";
            return (
              <div key={u.userId} className="border rounded p-2 text-sm">
                <div className="font-medium">
                  {u.prenom} {u.nom}
                </div>
                <div className="text-xs text-muted-foreground">
                  {here || t("equipeLocalisation.outOfZone")} · {ago}
                  {u.isMoving ? t("equipeLocalisation.moving") : ""}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MapView (Leaflet imperatif — react-leaflet ile types karmasik)
// ---------------------------------------------------------------------------

function MapView({
  geofences,
  team,
  onCreateAt,
}: {
  geofences: Geofence[];
  team: TeamLocation[];
  onCreateAt: (lat: number, lng: number) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onCreateRef = useRef(onCreateAt);
  onCreateRef.current = onCreateAt;

  // Mount: tek seferlik harita olustur.
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    const map = L.map(mapRef.current).setView([48.8566, 2.3522], 12); // Paris default
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      onCreateRef.current(e.latlng.lat, e.latlng.lng);
    });
    layerRef.current = L.layerGroup().addTo(map);
    leafletRef.current = map;
    return () => {
      map.remove();
      leafletRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Bolgeler + kullanicilar degistikce katmanı yeniden cizer.
  useEffect(() => {
    const map = leafletRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    geofences.forEach((g) => {
      L.circle([g.lat, g.lng], {
        radius: g.radiusM,
        color: g.color || "#3b82f6",
        weight: 2,
        fillOpacity: 0.15,
      })
        .bindTooltip(g.name, { permanent: false })
        .addTo(layer);
    });

    team.forEach((u) => {
      // Kullanici geofence icindeyse o bolgenin merkezine, degilse atla
      // (ham GPS gostermiyoruz - patron talebi).
      const inside = u.geofences[0];
      if (!inside) return;
      const g = geofences.find((x) => x.id === inside.id);
      if (!g) return;
      L.marker([g.lat, g.lng])
        .bindPopup(`<b>${u.prenom} ${u.nom}</b><br/>${g.name}`)
        .addTo(layer);
    });

    // Bolgeler varsa otomatik olarak hepsini gosterecek sekilde zoom.
    if (geofences.length > 0) {
      const bounds = L.latLngBounds(geofences.map((g) => [g.lat, g.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.3), { animate: false, maxZoom: 15 });
    }
  }, [geofences, team]);

  return <div ref={mapRef} style={{ height: 500, width: "100%", borderRadius: 8 }} />;
}

// ---------------------------------------------------------------------------
// HISTORY: 30 gun gecmis
// ---------------------------------------------------------------------------

function HistorySection() {
  const { t } = useTranslation();
  const [userId, setUserId] = useState<string>("");
  const [days, setDays] = useState<string>("7");

  const teamQ = useQuery<{ states: TeamState[] }>({
    queryKey: ["team-locations"],
    queryFn: () =>
      fetch(API("/admin/team-locations"), { credentials: "include" }).then((r) => r.json()),
  });

  const geofencesQ = useQuery<{ geofences: Geofence[] }>({
    queryKey: ["geofences"],
    queryFn: () => fetch(API("/geofences"), { credentials: "include" }).then((r) => r.json()),
  });

  const historyQ = useQuery<{ events: HistoryEvent[] }>({
    queryKey: ["team-history", userId, days],
    enabled: !!userId,
    queryFn: () => {
      const from = new Date();
      from.setDate(from.getDate() - Math.min(30, Math.max(1, parseInt(days, 10) || 7)));
      // Backend attend `from` (pas `since`) — historyQuerySchema dans
      // routes/locations.ts. Cap a 30 jours impose cote serveur de toute facon.
      const params = new URLSearchParams({ userId, from: from.toISOString() });
      return fetch(API(`/admin/team-locations/history?${params}`), {
        credentials: "include",
      }).then((r) => r.json());
    },
  });

  const states = teamQ.data?.states ?? [];
  const events = historyQ.data?.events ?? [];
  // Pour afficher "enter — Bureau Paris" plutot qu'un id brut.
  const geofenceNameById = useMemo(() => {
    const m = new Map<number, string>();
    (geofencesQ.data?.geofences ?? []).forEach((g) => m.set(g.id, g.name));
    return m;
  }, [geofencesQ.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("equipeLocalisation.historyTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>{t("equipeLocalisation.employee")}</Label>
            <select
              className="w-full border rounded p-2 mt-1"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">{t("equipeLocalisation.chooseEmployee")}</option>
              {states.map((u) => (
                <option key={u.userId} value={String(u.userId)}>
                  {u.userPrenom} {u.userNom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t("equipeLocalisation.period")}</Label>
            <Input aria-label={t("equipeLocalisation.period")}
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        </div>
        {!userId && (
          <p className="text-sm text-muted-foreground">
            {t("equipeLocalisation.selectEmployee")}
          </p>
        )}
        {userId && historyQ.isLoading && <p className="text-sm">{t("equipeLocalisation.loading")}</p>}
        {userId && events.length === 0 && !historyQ.isLoading && (
          <p className="text-sm text-muted-foreground">{t("equipeLocalisation.noEvents")}</p>
        )}
        {events.length > 0 && (
          <div className="border rounded divide-y">
            {events.map((e) => (
              <div key={e.id} className="p-2 text-sm flex items-center justify-between">
                <div>
                  <span className="font-medium capitalize">{t(`equipeLocalisation.events.${e.event}`)}</span>
                  {e.geofenceId ? <> — {geofenceNameById.get(e.geofenceId) ?? t("equipeLocalisation.zoneNum", { id: e.geofenceId })}</> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString("fr-FR")}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------

function formatAgo(iso: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t("equipeLocalisation.ago.now");
  if (m < 60) return t("equipeLocalisation.ago.min", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("equipeLocalisation.ago.hour", { n: h });
  const d = Math.floor(h / 24);
  return t("equipeLocalisation.ago.day", { n: d });
}
