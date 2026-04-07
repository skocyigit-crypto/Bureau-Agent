import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Icon3D } from "@/components/icon-3d";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Clock, MapPin, Users, CheckSquare, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
const DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS_FR = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];

const EVENT_TYPES = [
  { value: "rendez_vous", label: "Rendez-vous", color: "#3b82f6" },
  { value: "reunion", label: "Reunion", color: "#8b5cf6" },
  { value: "appel", label: "Appel programme", color: "#22c55e" },
  { value: "echeance", label: "Echeance", color: "#ef4444" },
  { value: "personnel", label: "Personnel", color: "#f59e0b" },
];

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

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [view, setView] = useState<"mois" | "semaine">("mois");
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: "", type: "rendez_vous", startTime: "09:00", endTime: "10:00", location: "", description: "" });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthDays = useMemo(() => getMonthDays(year, month), [year, month]);

  const startRange = new Date(year, month - 1, 1).toISOString();
  const endRange = new Date(year, month + 2, 0).toISOString();

  const { data } = useQuery({
    queryKey: ["calendar-events", startRange, endRange],
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/api/calendar/events?start=${startRange}&end=${endRange}`, { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (eventData: any) => {
      const res = await fetch(`${baseUrl}/api/calendar/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(eventData),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      setShowNewEvent(false);
      setNewEvent({ title: "", type: "rendez_vous", startTime: "09:00", endTime: "10:00", location: "", description: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${baseUrl}/api/calendar/events/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
  });

  const allEvents = useMemo(() => {
    if (!data) return [];
    const calendar = (data.events || []).map((e: any) => ({ ...e, source: "calendar" }));
    const tasks = (data.taskEvents || []).map((e: any) => ({ ...e, source: "task" }));
    return [...calendar, ...tasks];
  }, [data]);

  function getEventsForDate(date: Date) {
    return allEvents.filter((e: any) => {
      const start = new Date(e.startDate);
      return isSameDay(start, date);
    });
  }

  function handleCreateEvent() {
    if (!selectedDate || !newEvent.title.trim()) return;
    const [sh, sm] = newEvent.startTime.split(":").map(Number);
    const [eh, em] = newEvent.endTime.split(":").map(Number);
    const startDate = new Date(selectedDate);
    startDate.setHours(sh, sm, 0, 0);
    const endDate = new Date(selectedDate);
    endDate.setHours(eh, em, 0, 0);
    const typeInfo = EVENT_TYPES.find(t => t.value === newEvent.type);
    createMutation.mutate({
      title: newEvent.title,
      description: newEvent.description,
      type: newEvent.type,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      location: newEvent.location,
      color: typeInfo?.color || "#f59e0b",
    });
  }

  const today = new Date();
  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  const navigate = (dir: number) => setCurrentDate(new Date(year, month + dir, 1));

  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    d.setDate(d.getDate() - ((day + 6) % 7));
    return d;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const hours = Array.from({ length: 13 }, (_, i) => i + 7);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon3D icon={CalendarIcon} variant="amber" size="lg" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Calendrier</h1>
            <p className="text-sm text-muted-foreground">Planification et suivi des evenements</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-lg p-0.5">
            <Button variant={view === "mois" ? "default" : "ghost"} size="sm" onClick={() => setView("mois")}>Mois</Button>
            <Button variant={view === "semaine" ? "default" : "ghost"} size="sm" onClick={() => setView("semaine")}>Semaine</Button>
          </div>
          <Button onClick={() => setCurrentDate(new Date())} variant="outline" size="sm">Aujourd'hui</Button>
          <Dialog open={showNewEvent} onOpenChange={setShowNewEvent}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white">
                <Plus className="w-4 h-4 mr-1" /> Nouvel evenement
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvel evenement {selectedDate ? `- ${selectedDate.toLocaleDateString("fr-FR")}` : ""}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label>Titre</Label>
                  <Input value={newEvent.title} onChange={e => setNewEvent(p => ({ ...p, title: e.target.value }))} placeholder="Reunion client..." />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select value={newEvent.type} onValueChange={v => setNewEvent(p => ({ ...p, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Debut</Label><Input type="time" value={newEvent.startTime} onChange={e => setNewEvent(p => ({ ...p, startTime: e.target.value }))} /></div>
                  <div><Label>Fin</Label><Input type="time" value={newEvent.endTime} onChange={e => setNewEvent(p => ({ ...p, endTime: e.target.value }))} /></div>
                </div>
                <div><Label>Lieu</Label><Input value={newEvent.location} onChange={e => setNewEvent(p => ({ ...p, location: e.target.value }))} placeholder="Bureau, salle 3..." /></div>
                <div><Label>Description</Label><Input value={newEvent.description} onChange={e => setNewEvent(p => ({ ...p, description: e.target.value }))} placeholder="Details..." /></div>
                <Button onClick={handleCreateEvent} disabled={!newEvent.title.trim() || !selectedDate || createMutation.isPending} className="w-full bg-amber-500 hover:bg-amber-600 text-white">
                  {createMutation.isPending ? "Enregistrement..." : "Creer l'evenement"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ChevronLeft className="w-5 h-5" /></Button>
                <CardTitle className="text-lg">{MONTHS_FR[month]} {year}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => navigate(1)}><ChevronRight className="w-5 h-5" /></Button>
              </div>
            </CardHeader>
            <CardContent>
              {view === "mois" ? (
                <>
                  <div className="grid grid-cols-7 mb-2">
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
                          onClick={() => setSelectedDate(date)}
                          className={`min-h-[80px] p-1.5 text-left transition-colors bg-card hover:bg-muted/60
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
                              <div key={j} className="text-[10px] truncate rounded px-1 py-0.5 text-white font-medium" style={{ backgroundColor: e.color || "#3b82f6" }}>
                                {e.title}
                              </div>
                            ))}
                            {events.length > 3 && <div className="text-[10px] text-muted-foreground pl-1">+{events.length - 3} de plus</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="overflow-auto max-h-[600px]">
                  <div className="grid grid-cols-8 min-w-[700px]">
                    <div className="col-span-1" />
                    {weekDays.map((d, i) => (
                      <div key={i} className={`text-center text-xs font-medium p-2 border-b ${isSameDay(d, today) ? "bg-amber-50 text-amber-700" : "text-muted-foreground"}`}>
                        {DAYS_FR[i]} {d.getDate()}
                      </div>
                    ))}
                    {hours.map(h => (
                      <div key={h} className="contents">
                        <div className="text-[10px] text-muted-foreground pr-2 text-right pt-2 border-r">{h}:00</div>
                        {weekDays.map((d, di) => {
                          const events = getEventsForDate(d).filter((e: any) => {
                            const eH = new Date(e.startDate).getHours();
                            return eH === h;
                          });
                          return (
                            <button key={di} onClick={() => setSelectedDate(d)} className="border-b border-r min-h-[40px] p-0.5 hover:bg-muted/30 transition-colors relative">
                              {events.map((e: any, ei: number) => (
                                <div key={ei} className="text-[10px] truncate rounded px-1 py-0.5 text-white font-medium mb-0.5" style={{ backgroundColor: e.color || "#3b82f6" }}>
                                  {e.title}
                                </div>
                              ))}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {selectedDate ? selectedDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "Selectionnez une date"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedDate && (
                <div className="space-y-2">
                  {selectedEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Aucun evenement</p>
                  ) : (
                    selectedEvents.map((e: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg border bg-muted/30 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: e.color || "#3b82f6" }} />
                            <span className="text-sm font-medium">{e.title}</span>
                          </div>
                          {e.source === "calendar" && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteMutation.mutate(e.id)}>
                              <Trash2 className="w-3 h-3 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                        {e.source === "task" && <Badge variant="outline" className="text-[10px]"><CheckSquare className="w-3 h-3 mr-1" /> Tache</Badge>}
                        {!e.allDay && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {new Date(e.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                            {e.endDate && ` - ${new Date(e.endDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
                          </div>
                        )}
                        {e.location && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3" /> {e.location}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => setShowNewEvent(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Ajouter
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Legende</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {EVENT_TYPES.map(t => (
                <div key={t.value} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="text-xs text-muted-foreground">{t.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <CheckSquare className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Taches avec echeance</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
