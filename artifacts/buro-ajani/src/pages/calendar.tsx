import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon3D } from "@/components/icon-3d";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Clock, MapPin, Download,
  Users, CheckSquare, Trash2, Phone, Mail, Building, User, FileText,
  AlertCircle, Star, Search, X, ChevronDown, Edit2, Eye, Printer
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
const DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAYS_FULL_FR = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MONTHS_FR = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];

const EVENT_TYPES = [
  { value: "rendez_vous", label: "Rendez-vous", color: "#3b82f6", icon: CalendarIcon },
  { value: "reunion", label: "Reunion", color: "#8b5cf6", icon: Users },
  { value: "appel", label: "Appel programme", color: "#22c55e", icon: Phone },
  { value: "echeance", label: "Echeance", color: "#ef4444", icon: AlertCircle },
  { value: "consultation", label: "Consultation", color: "#06b6d4", icon: FileText },
  { value: "visite", label: "Visite client", color: "#f97316", icon: Building },
  { value: "personnel", label: "Personnel", color: "#f59e0b", icon: Star },
];

const REMINDERS = [
  { value: "none", label: "Aucun rappel" },
  { value: "5min", label: "5 minutes avant" },
  { value: "15min", label: "15 minutes avant" },
  { value: "30min", label: "30 minutes avant" },
  { value: "1h", label: "1 heure avant" },
  { value: "2h", label: "2 heures avant" },
  { value: "1j", label: "1 jour avant" },
];

const PRIORITIES = [
  { value: "basse", label: "Basse", color: "bg-green-100 text-green-700 border-green-200" },
  { value: "normale", label: "Normale", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "haute", label: "Haute", color: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "urgente", label: "Urgente", color: "bg-red-100 text-red-700 border-red-200" },
];

const STATUSES = [
  { value: "confirme", label: "Confirme", color: "bg-emerald-100 text-emerald-700" },
  { value: "en_attente", label: "En attente", color: "bg-amber-100 text-amber-700" },
  { value: "annule", label: "Annule", color: "bg-red-100 text-red-700" },
  { value: "reporte", label: "Reporte", color: "bg-gray-100 text-gray-700" },
];

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month, -i), isCurrentMonth: false });
  }
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
  }
  return days;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function pad(n: number) { return n.toString().padStart(2, "0"); }

const defaultEvent = {
  title: "",
  type: "rendez_vous",
  startTime: "09:00",
  endTime: "10:00",
  location: "",
  description: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  contactCompany: "",
  contactNotes: "",
  reminder: "15min",
  priority: "normale",
  status: "confirme",
};

function ContactAutocomplete({
  onSelect,
}: {
  onSelect: (c: any) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["contacts-search", search],
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/api/contacts?search=${encodeURIComponent(search)}&limit=8`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur recherche contacts");
      return res.json();
    },
    enabled: search.length >= 1,
  });

  const contacts = data?.contacts || data || [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => search.length >= 1 && setOpen(true)}
          placeholder="Rechercher un contact existant..."
          className="pl-9"
        />
      </div>
      {open && contacts.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {contacts.map((c: any) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c);
                setSearch("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors flex items-center gap-3 border-b last:border-0"
            >
              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                  {c.firstName?.[0]}{c.lastName?.[0]}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.firstName} {c.lastName}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {c.phone && <span>{c.phone}</span>}
                  {c.company && <span>- {c.company}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EventFormDialog({
  open,
  onOpenChange,
  selectedDate,
  selectedHour,
  editEvent,
  onSave,
  isPending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedDate: Date | null;
  selectedHour?: number;
  editEvent?: any;
  onSave: (data: any) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState(defaultEvent);
  const [activeTab, setActiveTab] = useState<"general" | "contact" | "options">("general");

  useEffect(() => {
    if (open) {
      if (editEvent) {
        const start = new Date(editEvent.startDate);
        const end = new Date(editEvent.endDate);
        setForm({
          title: editEvent.title || "",
          type: editEvent.type || "rendez_vous",
          startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
          endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
          location: editEvent.location || "",
          description: editEvent.description || "",
          contactName: editEvent.contactName || "",
          contactPhone: editEvent.contactPhone || "",
          contactEmail: editEvent.contactEmail || "",
          contactCompany: editEvent.contactCompany || "",
          contactNotes: editEvent.contactNotes || "",
          reminder: editEvent.reminder || "15min",
          priority: editEvent.priority || "normale",
          status: editEvent.status || "confirme",
        });
      } else {
        const h = selectedHour ?? 9;
        setForm({
          ...defaultEvent,
          startTime: `${pad(h)}:00`,
          endTime: `${pad(h + 1)}:00`,
        });
      }
      setActiveTab("general");
    }
  }, [open, editEvent, selectedHour]);

  const update = (key: string, value: string) => setForm(p => ({ ...p, [key]: value }));

  const handleContactSelect = (c: any) => {
    setForm(p => ({
      ...p,
      contactName: `${c.firstName} ${c.lastName}`.trim(),
      contactPhone: c.phone || "",
      contactEmail: c.email || "",
      contactCompany: c.company || "",
      contactNotes: c.notes || "",
      title: p.title || `RDV - ${c.firstName} ${c.lastName}`.trim(),
    }));
  };

  const handleSave = () => {
    if (!selectedDate || !form.title.trim()) return;
    const [sh, sm] = form.startTime.split(":").map(Number);
    const [eh, em] = form.endTime.split(":").map(Number);
    const startDate = new Date(selectedDate);
    startDate.setHours(sh, sm, 0, 0);
    const endDate = new Date(selectedDate);
    endDate.setHours(eh, em, 0, 0);
    const typeInfo = EVENT_TYPES.find(t => t.value === form.type);
    onSave({
      title: form.title,
      description: form.description,
      type: form.type,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      location: form.location,
      color: typeInfo?.color || "#f59e0b",
      contactName: form.contactName || null,
      contactPhone: form.contactPhone || null,
      contactEmail: form.contactEmail || null,
      contactCompany: form.contactCompany || null,
      contactNotes: form.contactNotes || null,
      reminder: form.reminder,
      priority: form.priority,
      status: form.status,
    });
  };

  const dateLabel = selectedDate
    ? selectedDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";

  const typeInfo = EVENT_TYPES.find(t => t.value === form.type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editEvent ? (
              <><Edit2 className="w-5 h-5 text-amber-600" /> Modifier l'evenement</>
            ) : (
              <><Plus className="w-5 h-5 text-amber-600" /> Nouveau rendez-vous</>
            )}
          </DialogTitle>
          {dateLabel && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
              <CalendarIcon className="w-3.5 h-3.5" /> {dateLabel}
            </p>
          )}
        </DialogHeader>

        <div className="flex gap-1 bg-muted rounded-lg p-0.5 mb-4">
          {[
            { key: "general", label: "General", icon: CalendarIcon },
            { key: "contact", label: "Contact", icon: User },
            { key: "options", label: "Options", icon: FileText },
          ].map(tab => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "default" : "ghost"}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setActiveTab(tab.key as any)}
            >
              <tab.icon className="w-3.5 h-3.5 mr-1" />
              {tab.label}
            </Button>
          ))}
        </div>

        {activeTab === "general" && (
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium">Titre du rendez-vous</Label>
              <Input
                value={form.title}
                onChange={e => update("title", e.target.value)}
                placeholder="Ex: Consultation comptable M. Dupont"
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs font-medium">Type</Label>
              <Select value={form.type} onValueChange={v => update("type", v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Heure de debut</Label>
                <Input type="time" value={form.startTime} onChange={e => update("startTime", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-medium">Heure de fin</Label>
                <Input type="time" value={form.endTime} onChange={e => update("endTime", e.target.value)} className="mt-1" />
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium">Lieu</Label>
              <Input value={form.location} onChange={e => update("location", e.target.value)} placeholder="Bureau, salle 3, visioconference..." className="mt-1" />
            </div>

            <div>
              <Label className="text-xs font-medium">Description / Notes</Label>
              <Textarea
                value={form.description}
                onChange={e => update("description", e.target.value)}
                placeholder="Details du rendez-vous, sujets a aborder..."
                className="mt-1 min-h-[80px]"
              />
            </div>
          </div>
        )}

        {activeTab === "contact" && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-2">Importer depuis les contacts</p>
              <ContactAutocomplete onSelect={handleContactSelect} />
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs"><span className="bg-background px-2 text-muted-foreground">ou saisir manuellement</span></div>
            </div>

            <div>
              <Label className="text-xs font-medium flex items-center gap-1.5"><User className="w-3 h-3" /> Nom complet</Label>
              <Input value={form.contactName} onChange={e => update("contactName", e.target.value)} placeholder="Jean Dupont" className="mt-1" />
            </div>

            <div>
              <Label className="text-xs font-medium flex items-center gap-1.5"><Phone className="w-3 h-3" /> Telephone</Label>
              <Input value={form.contactPhone} onChange={e => update("contactPhone", e.target.value)} placeholder="+33 6 12 34 56 78" className="mt-1" />
            </div>

            <div>
              <Label className="text-xs font-medium flex items-center gap-1.5"><Mail className="w-3 h-3" /> Email</Label>
              <Input type="email" value={form.contactEmail} onChange={e => update("contactEmail", e.target.value)} placeholder="jean.dupont@example.com" className="mt-1" />
            </div>

            <div>
              <Label className="text-xs font-medium flex items-center gap-1.5"><Building className="w-3 h-3" /> Societe</Label>
              <Input value={form.contactCompany} onChange={e => update("contactCompany", e.target.value)} placeholder="Entreprise SARL" className="mt-1" />
            </div>

            <div>
              <Label className="text-xs font-medium flex items-center gap-1.5"><FileText className="w-3 h-3" /> Notes sur le contact</Label>
              <Textarea
                value={form.contactNotes}
                onChange={e => update("contactNotes", e.target.value)}
                placeholder="Client fidele, prefere les matins, sujet: declaration TVA..."
                className="mt-1 min-h-[60px]"
              />
            </div>
          </div>
        )}

        {activeTab === "options" && (
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium">Statut</Label>
              <Select value={form.status} onValueChange={v => update("status", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${s.color.split(" ")[0]}`} />
                        {s.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-medium">Priorite</Label>
              <Select value={form.priority} onValueChange={v => update("priority", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-medium">Rappel</Label>
              <Select value={form.reminder} onValueChange={v => update("reminder", v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMINDERS.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={handleSave}
            disabled={!form.title.trim() || !selectedDate || isPending}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
          >
            {isPending ? "Enregistrement..." : editEvent ? "Mettre a jour" : "Creer le rendez-vous"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EventDetailDialog({
  open,
  onOpenChange,
  event,
  onEdit,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  event: any;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!event) return null;
  const typeInfo = EVENT_TYPES.find(t => t.value === event.type);
  const statusInfo = STATUSES.find(s => s.value === event.status);
  const priorityInfo = PRIORITIES.find(p => p.value === event.priority);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: event.color || typeInfo?.color || "#3b82f6" }} />
            {event.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {typeInfo && <Badge variant="outline" className="text-[10px]">{typeInfo.label}</Badge>}
            {statusInfo && <Badge className={`text-[10px] ${statusInfo.color}`}>{statusInfo.label}</Badge>}
            {priorityInfo && event.priority !== "normale" && (
              <Badge className={`text-[10px] ${priorityInfo.color}`}>{priorityInfo.label}</Badge>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-muted-foreground" />
              {new Date(event.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              {event.endDate && ` - ${new Date(event.endDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
            </div>
            {event.location && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground" /> {event.location}
              </div>
            )}
          </div>

          {event.description && (
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{event.description}</p>
            </div>
          )}

          {(event.contactName || event.contactPhone || event.contactEmail) && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 rounded-lg p-3 border border-amber-200/50 dark:border-amber-800/50">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-2">Informations du contact</p>
              <div className="space-y-1.5">
                {event.contactName && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-3.5 h-3.5 text-amber-600" /> {event.contactName}
                  </div>
                )}
                {event.contactPhone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-3.5 h-3.5 text-amber-600" />
                    <a href={`tel:${event.contactPhone}`} className="text-amber-700 hover:underline">{event.contactPhone}</a>
                  </div>
                )}
                {event.contactEmail && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-3.5 h-3.5 text-amber-600" />
                    <a href={`mailto:${event.contactEmail}`} className="text-amber-700 hover:underline">{event.contactEmail}</a>
                  </div>
                )}
                {event.contactCompany && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building className="w-3.5 h-3.5 text-amber-600" /> {event.contactCompany}
                  </div>
                )}
                {event.contactNotes && (
                  <div className="mt-2 text-xs text-muted-foreground italic">{event.contactNotes}</div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {event.source === "calendar" && (
              <>
                <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}>
                  <Edit2 className="w-3.5 h-3.5 mr-1" /> Modifier
                </Button>
                <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={onDelete}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [view, setView] = useState<"mois" | "semaine" | "jour">("semaine");
  const [showEventForm, setShowEventForm] = useState(false);
  const [showEventDetail, setShowEventDetail] = useState(false);
  const [selectedHour, setSelectedHour] = useState<number | undefined>();
  const [editingEvent, setEditingEvent] = useState<any>(null);
  const [viewingEvent, setViewingEvent] = useState<any>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthDays = useMemo(() => getMonthDays(year, month), [year, month]);

  const startRange = new Date(year, month - 1, 1).toISOString();
  const endRange = new Date(year, month + 2, 0).toISOString();

  const { data, isError } = useQuery({
    queryKey: ["calendar-events", startRange, endRange],
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/api/calendar/events?start=${startRange}&end=${endRange}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur chargement calendrier");
      return res.json();
    },
  });

  useEffect(() => {
    if (isError) toast({ title: "Erreur", description: "Impossible de charger les evenements", variant: "destructive" });
  }, [isError]);

  const createMutation = useMutation({
    mutationFn: async (eventData: any) => {
      const res = await fetch(`${baseUrl}/api/calendar/events`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(eventData),
      });
      if (!res.ok) throw new Error("Erreur creation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      setShowEventForm(false);
      setEditingEvent(null);
      toast({ title: "Evenement cree" });
    },
    onError: () => toast({ title: "Erreur", description: "Impossible de creer l'evenement", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await fetch(`${baseUrl}/api/calendar/events/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erreur mise a jour");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      setShowEventForm(false);
      setEditingEvent(null);
      toast({ title: "Evenement mis a jour" });
    },
    onError: () => toast({ title: "Erreur", description: "Impossible de modifier l'evenement", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${baseUrl}/api/calendar/events/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erreur suppression");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      setShowEventDetail(false);
      setViewingEvent(null);
      toast({ title: "Evenement supprime" });
    },
    onError: () => toast({ title: "Erreur", description: "Impossible de supprimer l'evenement", variant: "destructive" }),
  });

  const allEvents = useMemo(() => {
    if (!data) return [];
    const calendar = (data.events || []).map((e: any) => ({ ...e, source: "calendar" }));
    const tasks = (data.taskEvents || []).map((e: any) => ({ ...e, source: "task" }));
    return [...calendar, ...tasks];
  }, [data]);

  function getEventsForDate(date: Date) {
    return allEvents.filter((e: any) => isSameDay(new Date(e.startDate), date));
  }

  function handleTimeSlotClick(date: Date, hour: number) {
    setSelectedDate(date);
    setSelectedHour(hour);
    setEditingEvent(null);
    setShowEventForm(true);
  }

  function handleEventClick(event: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    setViewingEvent(event);
    setShowEventDetail(true);
  }

  function handleEditFromDetail() {
    setShowEventDetail(false);
    setSelectedDate(new Date(viewingEvent.startDate));
    setEditingEvent(viewingEvent);
    setShowEventForm(true);
  }

  function handleSaveEvent(eventData: any) {
    if (editingEvent) {
      updateMutation.mutate({ id: editingEvent.id, data: eventData });
    } else {
      createMutation.mutate(eventData);
    }
  }

  const today = new Date();
  const navigate = (dir: number) => {
    if (view === "jour") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + dir);
      setCurrentDate(d);
    } else if (view === "semaine") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + dir * 7);
      setCurrentDate(d);
    } else {
      setCurrentDate(new Date(year, month + dir, 1));
    }
  };

  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    d.setDate(d.getDate() - ((day + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const todayEvents = getEventsForDate(today);
  const upcomingCount = allEvents.filter((e: any) => new Date(e.startDate) > today).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={CalendarIcon} variant="amber" size="lg" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Calendrier</h1>
            <p className="text-sm text-muted-foreground">Planification et gestion des rendez-vous</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-muted rounded-lg p-0.5">
            <Button variant={view === "jour" ? "default" : "ghost"} size="sm" onClick={() => setView("jour")} className="text-xs">Jour</Button>
            <Button variant={view === "semaine" ? "default" : "ghost"} size="sm" onClick={() => setView("semaine")} className="text-xs">Semaine</Button>
            <Button variant={view === "mois" ? "default" : "ghost"} size="sm" onClick={() => setView("mois")} className="text-xs">Mois</Button>
          </div>
          <Button onClick={() => setCurrentDate(new Date())} variant="outline" size="sm" className="text-xs">Aujourd'hui</Button>
          <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/calendar/events/export/csv`} download>
            <Button variant="outline" size="sm" className="text-xs"><Download className="w-3 h-3 mr-1" />CSV</Button>
          </a>
          <Button variant="outline" size="sm" className="text-xs" title="Imprimer" onClick={() => window.print()}><Printer className="w-3 h-3" /></Button>
          <Button
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-white"
            onClick={() => {
              setSelectedDate(selectedDate || new Date());
              setSelectedHour(undefined);
              setEditingEvent(null);
              setShowEventForm(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Nouveau RDV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/50">
          <CardContent className="py-3 flex items-center gap-3">
            <CalendarIcon className="w-5 h-5 text-blue-600" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Aujourd'hui</p>
              <p className="text-lg font-bold">{todayEvents.length} <span className="text-xs font-normal text-muted-foreground">evenement(s)</span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/50">
          <CardContent className="py-3 flex items-center gap-3">
            <Clock className="w-5 h-5 text-amber-600" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">A venir</p>
              <p className="text-lg font-bold">{upcomingCount} <span className="text-xs font-normal text-muted-foreground">planifie(s)</span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/50">
          <CardContent className="py-3 flex items-center gap-3">
            <CheckSquare className="w-5 h-5 text-emerald-600" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ce mois</p>
              <p className="text-lg font-bold">{allEvents.length} <span className="text-xs font-normal text-muted-foreground">total</span></p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ChevronLeft className="w-5 h-5" /></Button>
            <CardTitle className="text-lg">
              {view === "jour"
                ? currentDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
                : view === "semaine"
                ? `${weekDays[0].getDate()} - ${weekDays[6].getDate()} ${MONTHS_FR[weekDays[6].getMonth()]} ${weekDays[6].getFullYear()}`
                : `${MONTHS_FR[month]} ${year}`
              }
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => navigate(1)}><ChevronRight className="w-5 h-5" /></Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-4">
          {view === "mois" && (
            <>
              <div className="grid grid-cols-7 mb-1">
                {DAYS_FR.map(d => <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                {monthDays.map(({ date, isCurrentMonth }, i) => {
                  const events = getEventsForDate(date);
                  const isToday = isSameDay(date, today);
                  const isSelected = selectedDate && isSameDay(date, selectedDate);
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedDate(date);
                        setView("jour");
                        setCurrentDate(date);
                      }}
                      className={`min-h-[80px] p-1.5 text-left transition-colors bg-card hover:bg-amber-50/50 dark:hover:bg-amber-950/10
                        ${!isCurrentMonth ? "opacity-40" : ""}
                        ${isSelected ? "ring-2 ring-amber-500 ring-inset" : ""}
                      `}
                    >
                      <span className={`text-xs font-medium inline-flex w-6 h-6 items-center justify-center rounded-full
                        ${isToday ? "bg-amber-500 text-white" : ""}
                      `}>
                        {date.getDate()}
                      </span>
                      <div className="mt-0.5 space-y-0.5">
                        {events.slice(0, 3).map((e: any, j: number) => (
                          <div
                            key={j}
                            className="text-[10px] truncate rounded px-1 py-0.5 text-white font-medium cursor-pointer hover:opacity-80"
                            style={{ backgroundColor: e.color || "#3b82f6" }}
                            onClick={(ev) => handleEventClick(e, ev)}
                          >
                            {e.title}
                          </div>
                        ))}
                        {events.length > 3 && <div className="text-[10px] text-muted-foreground pl-1">+{events.length - 3}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === "semaine" && (
            <div className="overflow-auto max-h-[650px]">
              <div className="grid min-w-[700px]" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
                <div />
                {weekDays.map((d, i) => (
                  <div
                    key={i}
                    className={`text-center py-2 border-b cursor-pointer hover:bg-amber-50/30 dark:hover:bg-amber-950/10 transition-colors
                      ${isSameDay(d, today) ? "bg-amber-50 dark:bg-amber-950/20" : ""}
                    `}
                    onClick={() => { setView("jour"); setCurrentDate(d); }}
                  >
                    <p className={`text-[10px] uppercase tracking-wider ${isSameDay(d, today) ? "text-amber-700 font-semibold" : "text-muted-foreground"}`}>
                      {DAYS_FR[i]}
                    </p>
                    <p className={`text-lg font-bold ${isSameDay(d, today) ? "text-amber-600" : ""}`}>{d.getDate()}</p>
                  </div>
                ))}
                {HOURS.map(h => (
                  <div key={h} className="contents">
                    <div className="text-[10px] text-muted-foreground pr-2 text-right pt-1 border-r h-12 flex items-start justify-end">
                      {pad(h)}:00
                    </div>
                    {weekDays.map((d, di) => {
                      const events = getEventsForDate(d).filter((e: any) => new Date(e.startDate).getHours() === h);
                      const isNow = isSameDay(d, today) && today.getHours() === h;
                      return (
                        <button
                          key={di}
                          onClick={() => handleTimeSlotClick(d, h)}
                          className={`border-b border-r h-12 p-0.5 hover:bg-amber-50/40 dark:hover:bg-amber-950/10 transition-colors relative group
                            ${isNow ? "bg-amber-50/60 dark:bg-amber-950/30" : ""}
                          `}
                        >
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Plus className="w-4 h-4 text-amber-400" />
                          </div>
                          {events.map((e: any, ei: number) => (
                            <div
                              key={ei}
                              className="text-[10px] truncate rounded px-1.5 py-0.5 text-white font-medium mb-0.5 cursor-pointer hover:opacity-80 relative z-10"
                              style={{ backgroundColor: e.color || "#3b82f6" }}
                              onClick={(ev) => handleEventClick(e, ev)}
                            >
                              {pad(new Date(e.startDate).getHours())}:{pad(new Date(e.startDate).getMinutes())} {e.title}
                            </div>
                          ))}
                          {isNow && <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-red-500 z-0 pointer-events-none"><div className="w-2 h-2 rounded-full bg-red-500 -mt-[3px] -ml-1" /></div>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "jour" && (
            <div className="overflow-auto max-h-[650px]">
              <div className="min-w-0">
                {HOURS.map(h => {
                  const events = getEventsForDate(currentDate).filter((e: any) => new Date(e.startDate).getHours() === h);
                  const isNow = isSameDay(currentDate, today) && today.getHours() === h;
                  return (
                    <div key={h} className="flex border-b">
                      <div className="w-16 shrink-0 text-xs text-muted-foreground text-right pr-3 pt-2 border-r">
                        {pad(h)}:00
                      </div>
                      <button
                        onClick={() => handleTimeSlotClick(currentDate, h)}
                        className={`flex-1 min-h-[56px] p-1.5 hover:bg-amber-50/40 dark:hover:bg-amber-950/10 transition-colors relative group text-left
                          ${isNow ? "bg-amber-50/60 dark:bg-amber-950/30" : ""}
                        `}
                      >
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-amber-500">
                          <Plus className="w-4 h-4" />
                          <span className="text-[10px] font-medium">Ajouter RDV</span>
                        </div>
                        {events.map((e: any, ei: number) => {
                          const startMin = new Date(e.startDate).getMinutes();
                          const endTime = e.endDate ? new Date(e.endDate) : null;
                          const typeInfo = EVENT_TYPES.find(t => t.value === e.type);
                          return (
                            <div
                              key={ei}
                              className="flex items-start gap-2 p-2 rounded-lg mb-1 text-white cursor-pointer hover:opacity-90 transition-opacity relative z-10"
                              style={{ backgroundColor: e.color || typeInfo?.color || "#3b82f6" }}
                              onClick={(ev) => handleEventClick(e, ev)}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold truncate">{e.title}</p>
                                <div className="flex items-center gap-2 text-xs opacity-90 mt-0.5">
                                  <span>{pad(new Date(e.startDate).getHours())}:{pad(startMin)}</span>
                                  {endTime && <span>- {pad(endTime.getHours())}:{pad(endTime.getMinutes())}</span>}
                                  {e.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{e.location}</span>}
                                </div>
                                {e.contactName && (
                                  <div className="flex items-center gap-1 text-xs opacity-80 mt-0.5">
                                    <User className="w-3 h-3" /> {e.contactName}
                                    {e.contactPhone && <span>- {e.contactPhone}</span>}
                                  </div>
                                )}
                              </div>
                              {e.status && e.status !== "confirme" && (
                                <Badge className="text-[10px] bg-white/20 border-white/30 shrink-0">
                                  {STATUSES.find(s => s.value === e.status)?.label || e.status}
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                        {isNow && (
                          <div className="absolute left-0 right-0 h-[2px] bg-red-500 z-0 pointer-events-none" style={{ top: `${(today.getMinutes() / 60) * 100}%` }}>
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500 -mt-[4px] -ml-1" />
                          </div>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-amber-600" />
              Prochains rendez-vous
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const upcoming = allEvents
                .filter((e: any) => new Date(e.startDate) >= today)
                .sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                .slice(0, 5);
              if (upcoming.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">Aucun rendez-vous a venir</p>;
              return (
                <div className="space-y-2">
                  {upcoming.map((e: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => handleEventClick(e)}
                      className="w-full text-left p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: e.color || "#3b82f6" }} />
                          <span className="text-sm font-medium truncate">{e.title}</span>
                        </div>
                        {e.contactName && <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{e.contactName}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1 ml-4.5">
                        <span>{new Date(e.startDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                        <span>{new Date(e.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                        {e.location && <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{e.location}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-600" />
              Legende
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {EVENT_TYPES.map(t => (
                <div key={t.value} className="flex items-center gap-2 p-1.5 rounded">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="text-xs text-muted-foreground">{t.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 p-1.5 rounded">
                <CheckSquare className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Taches avec echeance</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t">
              <p className="text-[10px] text-muted-foreground mb-2">Astuce : Cliquez sur un creneau horaire pour creer un rendez-vous instantanement</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <EventFormDialog
        open={showEventForm}
        onOpenChange={setShowEventForm}
        selectedDate={selectedDate}
        selectedHour={selectedHour}
        editEvent={editingEvent}
        onSave={handleSaveEvent}
        isPending={createMutation.isPending || updateMutation.isPending}
      />

      <EventDetailDialog
        open={showEventDetail}
        onOpenChange={setShowEventDetail}
        event={viewingEvent}
        onEdit={handleEditFromDetail}
        onDelete={() => viewingEvent && deleteMutation.mutate(viewingEvent.id)}
      />
    </div>
  );
}
