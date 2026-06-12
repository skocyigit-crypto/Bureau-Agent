import { useState, useEffect, useCallback } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, CalendarClock, Clock } from "lucide-react";

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
  slots: PublicSlot[];
}

export default function RendezVousPublicPage() {
  const [, params] = useRoute("/rdv/:token");
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [confirmedLabel, setConfirmedLabel] = useState<string | null>(null);

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

  useEffect(() => {
    load();
  }, [load]);

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

  const isConfirmed = offer?.status === "confirme" || confirmedLabel !== null;
  const isExpired = offer?.status === "expire" || offer?.status === "annule";

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
              {isConfirmed
                ? "Votre rendez-vous est confirme"
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

          {!loading && offer && isConfirmed && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="font-medium">Rendez-vous confirme</p>
              {(confirmedLabel ||
                (offer.selectedSlotIndex !== null && offer.slots[offer.selectedSlotIndex]?.label)) && (
                <p className="text-sm text-muted-foreground">
                  {confirmedLabel || offer.slots[offer.selectedSlotIndex!]?.label}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Vous recevrez une confirmation. Merci&nbsp;!
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

          {!loading && offer && !isConfirmed && !isExpired && (
            <div className="space-y-2">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
              {offer.slots.map((slot, i) => (
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
              ))}
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
