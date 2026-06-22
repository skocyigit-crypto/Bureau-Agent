import { useState, useEffect, useCallback } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, CalendarClock, Clock, CalendarX2, RefreshCw } from "lucide-react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/";

interface PublicSlot {
  start: string;
  end: string;
  label: string;
}

interface PublicOffer {
  orgName: string;
  timezone: string;
  reason: string;
  durationMinutes: number;
  contactName: string | null;
  status: "envoye" | "confirme" | "expire" | "annule";
  selectedSlotIndex: number | null;
  selectedSlotLabel: string | null;
  slots: PublicSlot[];
}

interface PublicClosure {
  dateStart: string;
  dateEnd: string;
  label: string | null;
}

/** Converts a UTC ISO string to a YYYY-MM-DD string in the given IANA timezone. */
function slotDateInTz(isoStart: string, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(isoStart));
    const year = parts.find((p) => p.type === "year")?.value ?? "";
    const month = parts.find((p) => p.type === "month")?.value ?? "";
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    return `${year}-${month}-${day}`;
  } catch {
    return isoStart.slice(0, 10);
  }
}

/** Returns the matching closure if the slot falls on a closed day, otherwise null. */
function getClosureForSlot(slot: PublicSlot, closures: PublicClosure[], tz: string): PublicClosure | null {
  const date = slotDateInTz(slot.start, tz);
  return closures.find((c) => date >= c.dateStart && date <= c.dateEnd) ?? null;
}

export default function RendezVousPublicPage() {
  const [, params] = useRoute("/rdv/:token");
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [confirmedLabel, setConfirmedLabel] = useState<string | null>(null);
  const [view, setView] = useState<"summary" | "reschedule">("summary");
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  // Live slots for reschedule view
  const [liveSlots, setLiveSlots] = useState<PublicSlot[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState("");

  // Closure dates for the org
  const [closures, setClosures] = useState<PublicClosure[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BASE}api/appointments/offer/${token}`);
      const data = await res.json();
      if (res.ok && data.offer) {
        setOffer(data.offer as PublicOffer);
      } else {
        setError(data.error || "Offre introuvable.");
      }
    } catch {
      setError("Impossible de charger cette proposition de rendez-vous.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchClosures = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BASE}api/appointments/offer/${token}/closures`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.closures)) {
          setClosures(data.closures as PublicClosure[]);
        }
      }
    } catch {
      // Non-blocking — closures are best-effort; absence just means no greying out
    }
  }, [token]);

  useEffect(() => {
    load();
    fetchClosures();
  }, [load, fetchClosures]);

  const fetchLiveSlots = useCallback(async () => {
    if (!token) return;
    setLoadingSlots(true);
    setSlotsError("");
    try {
      const res = await fetch(`${BASE}api/appointments/offer/${token}/available-slots`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.slots)) {
        setLiveSlots(data.slots as PublicSlot[]);
      } else {
        setSlotsError(data.error || "Impossible de charger les creneaux disponibles.");
        setLiveSlots([]);
      }
    } catch {
      setSlotsError("Erreur reseau lors du chargement des creneaux.");
      setLiveSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [token]);

  function enterRescheduleView() {
    setError("");
    setView("reschedule");
    if (liveSlots === null) {
      void fetchLiveSlots();
    }
  }

  // Confirmation initiale d'un creneau (offre `envoye`).
  async function selectSlot(index: number) {
    if (!token || submitting !== null) return;
    setSubmitting(index);
    setError("");
    try {
      const res = await fetch(`${BASE}api/appointments/offer/${token}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIndex: index }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const slot = offer?.slots[index];
        setConfirmedLabel(slot?.label ?? null);
        setOffer((prev) => (prev ? { ...prev, status: "confirme", selectedSlotIndex: index } : prev));
      } else {
        setError(data.error || "Ce creneau n'a pas pu etre confirme.");
        if (data.code === "conflict" || data.code === "already") {
          await load();
        }
      }
    } catch {
      setError("Erreur reseau lors de la confirmation.");
    } finally {
      setSubmitting(null);
    }
  }

  // Reprogrammation sur un creneau libre en temps reel.
  async function rescheduleSlot(slotIndex: number, slot: PublicSlot) {
    if (!token || submitting !== null) return;
    setSubmitting(slotIndex);
    setError("");
    try {
      const res = await fetch(`${BASE}api/appointments/offer/${token}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: { start: slot.start, end: slot.end } }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfirmedLabel(slot.label);
        setOffer((prev) => (prev ? { ...prev, status: "confirme", selectedSlotIndex: null } : prev));
        setView("summary");
      } else {
        setError(data.error || "Ce creneau n'a pas pu etre reprogramme.");
        if (data.code === "conflict" || data.code === "already" || data.code === "annule") {
          await load();
          void fetchLiveSlots();
        }
      }
    } catch {
      setError("Erreur reseau lors de la reprogrammation.");
    } finally {
      setSubmitting(null);
    }
  }

  // Annulation du rendez-vous confirme.
  async function cancelAppointment() {
    if (!token || cancelling) return;
    setCancelling(true);
    setError("");
    try {
      const res = await fetch(`${BASE}api/appointments/offer/${token}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCancelled(true);
        setOffer((prev) => (prev ? { ...prev, status: "annule" } : prev));
      } else {
        setError(data.error || "Ce rendez-vous n'a pas pu etre annule.");
        await load();
      }
    } catch {
      setError("Erreur reseau lors de l'annulation.");
    } finally {
      setCancelling(false);
    }
  }

  const isCancelled = cancelled || offer?.status === "annule";
  const isConfirmed = !isCancelled && (offer?.status === "confirme" || confirmedLabel !== null);
  const isExpired = !isCancelled && offer?.status === "expire";
  const selectedLabel =
    confirmedLabel ||
    offer?.selectedSlotLabel ||
    (offer && offer.selectedSlotIndex !== null ? offer.slots[offer.selectedSlotIndex]?.label : null);

  const tz = offer?.timezone ?? "Europe/Paris";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1729] via-[#1a2744] to-[#0f1729] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
            <CalendarClock className="h-6 w-6 text-amber-500" />
          </div>
          <CardTitle>{offer?.orgName || "Rendez-vous"}</CardTitle>
          {offer && !loading && !error && (
            <CardDescription>
              {isCancelled
                ? "Ce rendez-vous a ete annule"
                : isConfirmed
                  ? view === "reschedule"
                    ? "Choisissez un nouveau creneau"
                    : "Votre rendez-vous est confirme"
                  : isExpired
                    ? "Cette proposition n'est plus valable"
                    : `Choisissez un creneau pour : ${offer.reason}`}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement...
            </div>
          )}

          {!loading && error && !offer && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {!loading && offer && isCancelled && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CalendarX2 className="h-10 w-10 text-destructive" />
              <p className="font-medium">Rendez-vous annule</p>
              <p className="text-xs text-muted-foreground">
                Votre rendez-vous a bien ete annule. Pour reprendre rendez-vous, contactez {offer.orgName}.
              </p>
            </div>
          )}

          {!loading && offer && isConfirmed && view === "summary" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="font-medium">Rendez-vous confirme</p>
              {selectedLabel && <p className="text-sm text-muted-foreground">{selectedLabel}</p>}
              <p className="text-xs text-muted-foreground">Vous recevrez une confirmation. Merci&nbsp;!</p>

              {error && (
                <p className="w-full rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}

              <div className="mt-2 flex w-full flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={cancelling}
                  onClick={enterRescheduleView}
                >
                  <CalendarClock className="mr-2 h-4 w-4" /> Choisir un autre creneau
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive"
                  disabled={cancelling}
                  onClick={cancelAppointment}
                >
                  {cancelling ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CalendarX2 className="mr-2 h-4 w-4" />
                  )}
                  Annuler le rendez-vous
                </Button>
              </div>
            </div>
          )}

          {!loading && offer && isConfirmed && view === "reschedule" && (
            <div className="space-y-2">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}

              {loadingSlots && (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement des creneaux disponibles...
                </div>
              )}

              {!loadingSlots && slotsError && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <p className="text-sm text-destructive">{slotsError}</p>
                  <Button variant="outline" size="sm" onClick={fetchLiveSlots}>
                    <RefreshCw className="mr-2 h-3 w-3" /> Reessayer
                  </Button>
                </div>
              )}

              {!loadingSlots && liveSlots !== null && liveSlots.length === 0 && !slotsError && (
                <div className="py-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Aucun creneau disponible dans les 14 prochains jours. Contactez {offer.orgName} pour convenir d&apos;une date.
                  </p>
                </div>
              )}

              {!loadingSlots && liveSlots && liveSlots.length > 0 &&
                liveSlots.map((slot, i) => {
                  const closure = getClosureForSlot(slot, closures, tz);
                  return closure ? (
                    <div
                      key={`${slot.start}-${i}`}
                      className="flex h-auto w-full items-center justify-start rounded-md border border-border bg-muted/40 px-4 py-3 opacity-60 cursor-not-allowed"
                    >
                      <CalendarX2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col gap-0.5 text-left">
                        <span className="text-sm text-muted-foreground line-through">{slot.label}</span>
                        <span className="text-xs font-medium text-muted-foreground">
                          Fermé{closure.label ? ` — ${closure.label}` : ""}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <Button
                      key={`${slot.start}-${i}`}
                      variant="outline"
                      className="h-auto w-full justify-start py-3 text-left"
                      disabled={submitting !== null}
                      onClick={() => rescheduleSlot(i, slot)}
                    >
                      {submitting === i ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <Clock className="mr-2 h-4 w-4 shrink-0 text-amber-500" />
                      )}
                      <span className="text-sm">{slot.label}</span>
                    </Button>
                  );
                })
              }

              <Button
                variant="ghost"
                className="w-full"
                disabled={submitting !== null}
                onClick={() => {
                  setError("");
                  setView("summary");
                }}
              >
                Retour
              </Button>
              <p className="pt-1 text-center text-xs text-muted-foreground">
                Duree : {offer.durationMinutes} min · Fuseau : {offer.timezone}
              </p>
            </div>
          )}

          {!loading && offer && isExpired && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">
                Cette proposition a expire. Merci de recontacter {offer.orgName}.
              </p>
            </div>
          )}

          {!loading && offer && !isConfirmed && !isExpired && !isCancelled && (
            <div className="space-y-2">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
              {offer.slots.map((slot, i) => {
                const closure = getClosureForSlot(slot, closures, tz);
                return closure ? (
                  <div
                    key={`${slot.start}-${i}`}
                    className="flex h-auto w-full items-center justify-start rounded-md border border-border bg-muted/40 px-4 py-3 opacity-60 cursor-not-allowed"
                  >
                    <CalendarX2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col gap-0.5 text-left">
                      <span className="text-sm text-muted-foreground line-through">{slot.label}</span>
                      <span className="text-xs font-medium text-muted-foreground">
                        Fermé{closure.label ? ` — ${closure.label}` : ""}
                      </span>
                    </div>
                  </div>
                ) : (
                  <Button
                    key={`${slot.start}-${i}`}
                    variant="outline"
                    className="h-auto w-full justify-start py-3 text-left"
                    disabled={submitting !== null}
                    onClick={() => selectSlot(i)}
                  >
                    {submitting === i ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin shrink-0" />
                    ) : (
                      <Clock className="mr-2 h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    <span className="text-sm">{slot.label}</span>
                  </Button>
                );
              })}
              <p className="pt-2 text-center text-xs text-muted-foreground">
                Duree : {offer.durationMinutes} min · Fuseau : {offer.timezone}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
