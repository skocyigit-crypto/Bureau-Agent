import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { CalendarDays,CheckSquare,FolderKanban,Loader2,MessageSquare,Phone,Plus,Send,Users,Zap } from "lucide-react";
import { useEffect,useState } from "react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

type ActionType = "contact" | "tache" | "appel" | "message" | "evenement" | "projet";

interface QuickActionHubProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: ActionType;
}

export function QuickActionHub({ open, onOpenChange, defaultTab = "contact" }: QuickActionHubProps) {
  const [tab, setTab] = useState<ActionType>(defaultTab);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (open && defaultTab) setTab(defaultTab);
  }, [open, defaultTab]);

  const handleSubmit = async (endpoint: string, data: Record<string, any>, label: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || t("quickActionHub.toast.errorStatus", { status: r.status }));
      }
      toast({ title: t("quickActionHub.toast.successTitle"), description: t("quickActionHub.toast.created", { label }) });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: t("quickActionHub.toast.errorTitle"), description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 text-white">
              <Zap className="h-4 w-4" />
            </div>
            {t("quickActionHub.title")}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ActionType)}>
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="contact" className="text-xs gap-1"><Users className="h-3 w-3" />{t("quickActionHub.entity.contact")}</TabsTrigger>
            <TabsTrigger value="tache" className="text-xs gap-1"><CheckSquare className="h-3 w-3" />{t("quickActionHub.entity.tache")}</TabsTrigger>
            <TabsTrigger value="appel" className="text-xs gap-1"><Phone className="h-3 w-3" />{t("quickActionHub.entity.appel")}</TabsTrigger>
            <TabsTrigger value="message" className="text-xs gap-1"><MessageSquare className="h-3 w-3" />{t("quickActionHub.entity.message")}</TabsTrigger>
            <TabsTrigger value="evenement" className="text-xs gap-1"><CalendarDays className="h-3 w-3" />{t("quickActionHub.entity.evenement")}</TabsTrigger>
            <TabsTrigger value="projet" className="text-xs gap-1"><FolderKanban className="h-3 w-3" />{t("quickActionHub.entity.projet")}</TabsTrigger>
          </TabsList>

          <TabsContent value="contact">
            <QuickContactForm onSubmit={(d) => handleSubmit("contacts", d, t("quickActionHub.entity.contact"))} loading={loading} />
          </TabsContent>
          <TabsContent value="tache">
            <QuickTaskForm onSubmit={(d) => handleSubmit("tasks", d, t("quickActionHub.entity.tache"))} loading={loading} />
          </TabsContent>
          <TabsContent value="appel">
            <QuickCallForm onSubmit={(d) => handleSubmit("calls", d, t("quickActionHub.entity.appel"))} loading={loading} />
          </TabsContent>
          <TabsContent value="message">
            <QuickMessageForm onSubmit={(d) => handleSubmit("messages", d, t("quickActionHub.entity.message"))} loading={loading} />
          </TabsContent>
          <TabsContent value="evenement">
            <QuickEventForm onSubmit={(d) => handleSubmit("calendar/events", d, t("quickActionHub.entity.evenement"))} loading={loading} />
          </TabsContent>
          <TabsContent value="projet">
            <QuickProjetForm onSubmit={(d) => handleSubmit("projets", d, t("quickActionHub.entity.projet"))} loading={loading} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function QuickContactForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [category, setCategory] = useState("client");
  const { t } = useTranslation();

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ firstName, lastName, email, phone, company, category }); }} className="space-y-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t("quickActionHub.contact.firstName")}</Label><Input aria-label={t("quickActionHub.contact.firstName")} value={firstName} onChange={e => setFirstName(e.target.value)} required placeholder={t("quickActionHub.contact.phFirstName")} /></div>
        <div><Label className="text-xs">{t("quickActionHub.contact.lastName")}</Label><Input aria-label={t("quickActionHub.contact.lastName")} value={lastName} onChange={e => setLastName(e.target.value)} required placeholder={t("quickActionHub.contact.phLastName")} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t("quickActionHub.contact.email")}</Label><Input aria-label={t("quickActionHub.contact.email")} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t("quickActionHub.contact.phEmail")} /></div>
        <div><Label className="text-xs">{t("quickActionHub.contact.phone")}</Label><Input aria-label={t("quickActionHub.contact.phone")} value={phone} onChange={e => setPhone(e.target.value)} required placeholder={t("quickActionHub.contact.phPhone")} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t("quickActionHub.contact.company")}</Label><Input aria-label={t("quickActionHub.contact.company")} value={company} onChange={e => setCompany(e.target.value)} placeholder={t("quickActionHub.contact.phCompany")} /></div>
        <div>
          <Label className="text-xs">{t("quickActionHub.contact.category")}</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label={t("quickActionHub.contact.category")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="client">{t("quickActionHub.contact.catClient")}</SelectItem>
              <SelectItem value="fournisseur">{t("quickActionHub.contact.catFournisseur")}</SelectItem>
              <SelectItem value="partenaire">{t("quickActionHub.contact.catPartenaire")}</SelectItem>
              <SelectItem value="prospect">{t("quickActionHub.contact.catProspect")}</SelectItem>
              <SelectItem value="autre">{t("quickActionHub.contact.catAutre")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}{t("quickActionHub.contact.submit")}</Button>
    </form>
  );
}

function QuickTaskForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("moyenne");
  const [dueDate, setDueDate] = useState("");
  const { t } = useTranslation();

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ title, description, priority, status: "en_attente", dueDate: dueDate || undefined }); }} className="space-y-3 mt-3">
      <div><Label className="text-xs">{t("quickActionHub.task.title")}</Label><Input aria-label={t("quickActionHub.task.title")} value={title} onChange={e => setTitle(e.target.value)} required placeholder={t("quickActionHub.task.phTitle")} /></div>
      <div><Label className="text-xs">{t("quickActionHub.task.description")}</Label><Textarea aria-label={t("quickActionHub.task.description")} value={description} onChange={e => setDescription(e.target.value)} placeholder={t("quickActionHub.task.phDesc")} rows={2} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{t("quickActionHub.task.priority")}</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger aria-label={t("quickActionHub.task.priority")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="basse">{t("quickActionHub.task.prioBasse")}</SelectItem>
              <SelectItem value="moyenne">{t("quickActionHub.task.prioMoyenne")}</SelectItem>
              <SelectItem value="haute">{t("quickActionHub.task.prioHaute")}</SelectItem>
              <SelectItem value="urgente">{t("quickActionHub.task.prioUrgente")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">{t("quickActionHub.task.dueDate")}</Label><Input aria-label={t("quickActionHub.task.dueDate")} type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}{t("quickActionHub.task.submit")}</Button>
    </form>
  );
}

function QuickCallForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [callerName, setCallerName] = useState("");
  const [callerNumber, setCallerNumber] = useState("");
  const [direction, setDirection] = useState("entrant");
  const [notes, setNotes] = useState("");
  const { t } = useTranslation();

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ callerName, callerNumber, direction, notes, status: "answered", duration: 0 }); }} className="space-y-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t("quickActionHub.call.callerName")}</Label><Input aria-label={t("quickActionHub.call.callerName")} value={callerName} onChange={e => setCallerName(e.target.value)} placeholder={t("quickActionHub.call.phCallerName")} /></div>
        <div><Label className="text-xs">{t("quickActionHub.call.callerNumber")}</Label><Input aria-label={t("quickActionHub.call.callerNumber")} value={callerNumber} onChange={e => setCallerNumber(e.target.value)} required placeholder={t("quickActionHub.call.phCallerNumber")} /></div>
      </div>
      <div>
        <Label className="text-xs">{t("quickActionHub.call.direction")}</Label>
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger aria-label={t("quickActionHub.call.direction")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="entrant">{t("quickActionHub.call.dirEntrant")}</SelectItem>
            <SelectItem value="sortant">{t("quickActionHub.call.dirSortant")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label className="text-xs">{t("quickActionHub.call.notes")}</Label><Textarea aria-label={t("quickActionHub.call.notes")} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("quickActionHub.call.phNotes")} rows={2} /></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Phone className="h-4 w-4 mr-2" />}{t("quickActionHub.call.submit")}</Button>
    </form>
  );
}

function QuickMessageForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [senderName, setSenderName] = useState("");
  const [content, setContent] = useState("");
  const [channel, setChannel] = useState("email");
  const { t } = useTranslation();

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ senderName, content, channel, status: "non_lu" }); }} className="space-y-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t("quickActionHub.message.sender")}</Label><Input aria-label={t("quickActionHub.message.sender")} value={senderName} onChange={e => setSenderName(e.target.value)} placeholder={t("quickActionHub.message.phSender")} /></div>
        <div>
          <Label className="text-xs">{t("quickActionHub.message.channel")}</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger aria-label={t("quickActionHub.message.channel")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="email">{t("quickActionHub.message.chEmail")}</SelectItem>
              <SelectItem value="sms">{t("quickActionHub.message.chSms")}</SelectItem>
              <SelectItem value="whatsapp">{t("quickActionHub.message.chWhatsapp")}</SelectItem>
              <SelectItem value="chat">{t("quickActionHub.message.chChat")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Label className="text-xs">{t("quickActionHub.message.content")}</Label><Textarea aria-label={t("quickActionHub.message.content")} value={content} onChange={e => setContent(e.target.value)} required placeholder={t("quickActionHub.message.phContent")} rows={3} /></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}{t("quickActionHub.message.submit")}</Button>
    </form>
  );
}

function QuickEventForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState("reunion");
  const [description, setDescription] = useState("");
  const { t } = useTranslation();

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ title, startDate: startDate ? new Date(startDate).toISOString() : new Date().toISOString(), endDate: endDate ? new Date(endDate).toISOString() : undefined, type, description }); }} className="space-y-3 mt-3">
      <div><Label className="text-xs">{t("quickActionHub.event.title")}</Label><Input aria-label={t("quickActionHub.event.title")} value={title} onChange={e => setTitle(e.target.value)} required placeholder={t("quickActionHub.event.phTitle")} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t("quickActionHub.event.start")}</Label><Input aria-label={t("quickActionHub.event.start")} type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} required /></div>
        <div><Label className="text-xs">{t("quickActionHub.event.end")}</Label><Input aria-label={t("quickActionHub.event.end")} type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
      </div>
      <div>
        <Label className="text-xs">{t("quickActionHub.event.type")}</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger aria-label={t("quickActionHub.event.type")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="reunion">{t("quickActionHub.event.typeReunion")}</SelectItem>
            <SelectItem value="appel">{t("quickActionHub.event.typeAppel")}</SelectItem>
            <SelectItem value="formation">{t("quickActionHub.event.typeFormation")}</SelectItem>
            <SelectItem value="deadline">{t("quickActionHub.event.typeDeadline")}</SelectItem>
            <SelectItem value="autre">{t("quickActionHub.event.typeAutre")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label className="text-xs">{t("quickActionHub.event.description")}</Label><Textarea aria-label={t("quickActionHub.event.description")} value={description} onChange={e => setDescription(e.target.value)} placeholder={t("quickActionHub.event.phDesc")} rows={2} /></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CalendarDays className="h-4 w-4 mr-2" />}{t("quickActionHub.event.submit")}</Button>
    </form>
  );
}

function QuickProjetForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clientName, setClientName] = useState("");
  const [priority, setPriority] = useState("moyenne");
  const [budget, setBudget] = useState("");
  const [endDate, setEndDate] = useState("");
  const { t } = useTranslation();

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSubmit({ title, description, clientName, priority, status: "planifie", budget: budget || undefined, endDate: endDate || undefined, currency: "EUR", progress: 0 });
    }} className="space-y-3 mt-3">
      <div><Label className="text-xs">{t("quickActionHub.projet.title")}</Label><Input aria-label={t("quickActionHub.projet.title")} value={title} onChange={e => setTitle(e.target.value)} required placeholder={t("quickActionHub.projet.phTitle")} /></div>
      <div><Label className="text-xs">{t("quickActionHub.projet.description")}</Label><Textarea aria-label={t("quickActionHub.projet.description")} value={description} onChange={e => setDescription(e.target.value)} placeholder={t("quickActionHub.projet.phDesc")} rows={2} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t("quickActionHub.projet.client")}</Label><Input aria-label={t("quickActionHub.projet.client")} value={clientName} onChange={e => setClientName(e.target.value)} placeholder={t("quickActionHub.projet.phClient")} /></div>
        <div>
          <Label className="text-xs">{t("quickActionHub.projet.priority")}</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger aria-label={t("quickActionHub.projet.priority")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="basse">{t("quickActionHub.projet.prioBasse")}</SelectItem>
              <SelectItem value="moyenne">{t("quickActionHub.projet.prioMoyenne")}</SelectItem>
              <SelectItem value="haute">{t("quickActionHub.projet.prioHaute")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t("quickActionHub.projet.budget")}</Label><Input aria-label={t("quickActionHub.projet.budget")} type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder={t("quickActionHub.projet.phBudget")} /></div>
        <div><Label className="text-xs">{t("quickActionHub.projet.endDate")}</Label><Input aria-label={t("quickActionHub.projet.endDate")} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
      </div>
      <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FolderKanban className="h-4 w-4 mr-2" />}{t("quickActionHub.projet.submit")}
      </Button>
    </form>
  );
}
