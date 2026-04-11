import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Phone, Users, CheckSquare, MessageSquare, CalendarDays, FileText, TrendingUp, Zap, Search, Plus, Send, X, Loader2 } from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

type ActionType = "contact" | "tache" | "appel" | "message" | "prospect" | "evenement";

interface QuickActionHubProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: ActionType;
}

export function QuickActionHub({ open, onOpenChange, defaultTab = "contact" }: QuickActionHubProps) {
  const [tab, setTab] = useState<ActionType>(defaultTab);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

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
        throw new Error(e.error || `Erreur ${r.status}`);
      }
      toast({ title: "Succes", description: `${label} cree avec succes` });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
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
            Action Rapide
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ActionType)}>
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="contact" className="text-xs gap-1"><Users className="h-3 w-3" />Contact</TabsTrigger>
            <TabsTrigger value="tache" className="text-xs gap-1"><CheckSquare className="h-3 w-3" />Tache</TabsTrigger>
            <TabsTrigger value="appel" className="text-xs gap-1"><Phone className="h-3 w-3" />Appel</TabsTrigger>
            <TabsTrigger value="message" className="text-xs gap-1"><MessageSquare className="h-3 w-3" />Message</TabsTrigger>
            <TabsTrigger value="prospect" className="text-xs gap-1"><TrendingUp className="h-3 w-3" />Prospect</TabsTrigger>
            <TabsTrigger value="evenement" className="text-xs gap-1"><CalendarDays className="h-3 w-3" />Evenement</TabsTrigger>
          </TabsList>

          <TabsContent value="contact">
            <QuickContactForm onSubmit={(d) => handleSubmit("contacts", d, "Contact")} loading={loading} />
          </TabsContent>
          <TabsContent value="tache">
            <QuickTaskForm onSubmit={(d) => handleSubmit("tasks", d, "Tache")} loading={loading} />
          </TabsContent>
          <TabsContent value="appel">
            <QuickCallForm onSubmit={(d) => handleSubmit("calls", d, "Appel")} loading={loading} />
          </TabsContent>
          <TabsContent value="message">
            <QuickMessageForm onSubmit={(d) => handleSubmit("messages", d, "Message")} loading={loading} />
          </TabsContent>
          <TabsContent value="prospect">
            <QuickProspectForm onSubmit={(d) => handleSubmit("prospects", d, "Prospect")} loading={loading} />
          </TabsContent>
          <TabsContent value="evenement">
            <QuickEventForm onSubmit={(d) => handleSubmit("calendar/events", d, "Evenement")} loading={loading} />
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

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ firstName, lastName, email, phone, company, category }); }} className="space-y-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Prenom *</Label><Input value={firstName} onChange={e => setFirstName(e.target.value)} required placeholder="Jean" /></div>
        <div><Label className="text-xs">Nom *</Label><Input value={lastName} onChange={e => setLastName(e.target.value)} required placeholder="Dupont" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jean@example.fr" /></div>
        <div><Label className="text-xs">Telephone *</Label><Input value={phone} onChange={e => setPhone(e.target.value)} required placeholder="+33 6 12 34 56 78" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Entreprise</Label><Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Inc." /></div>
        <div>
          <Label className="text-xs">Categorie</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="client">Client</SelectItem>
              <SelectItem value="fournisseur">Fournisseur</SelectItem>
              <SelectItem value="partenaire">Partenaire</SelectItem>
              <SelectItem value="prospect">Prospect</SelectItem>
              <SelectItem value="autre">Autre</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}Creer le contact</Button>
    </form>
  );
}

function QuickTaskForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("moyenne");
  const [dueDate, setDueDate] = useState("");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ title, description, priority, status: "a_faire", dueDate: dueDate || undefined }); }} className="space-y-3 mt-3">
      <div><Label className="text-xs">Titre *</Label><Input value={title} onChange={e => setTitle(e.target.value)} required placeholder="Rappeler M. Dupont" /></div>
      <div><Label className="text-xs">Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Details..." rows={2} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Priorite</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="basse">Basse</SelectItem>
              <SelectItem value="moyenne">Moyenne</SelectItem>
              <SelectItem value="haute">Haute</SelectItem>
              <SelectItem value="urgente">Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Echeance</Label><Input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}Creer la tache</Button>
    </form>
  );
}

function QuickCallForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [callerName, setCallerName] = useState("");
  const [callerNumber, setCallerNumber] = useState("");
  const [direction, setDirection] = useState("entrant");
  const [notes, setNotes] = useState("");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ callerName, callerNumber, direction, notes, status: "answered", duration: 0 }); }} className="space-y-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Nom de l'appelant</Label><Input value={callerName} onChange={e => setCallerName(e.target.value)} placeholder="Jean Dupont" /></div>
        <div><Label className="text-xs">Numero *</Label><Input value={callerNumber} onChange={e => setCallerNumber(e.target.value)} required placeholder="+33 6 ..." /></div>
      </div>
      <div>
        <Label className="text-xs">Direction</Label>
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="entrant">Entrant</SelectItem>
            <SelectItem value="sortant">Sortant</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label className="text-xs">Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes de l'appel..." rows={2} /></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Phone className="h-4 w-4 mr-2" />}Enregistrer l'appel</Button>
    </form>
  );
}

function QuickMessageForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [senderName, setSenderName] = useState("");
  const [content, setContent] = useState("");
  const [channel, setChannel] = useState("email");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ senderName, content, channel, status: "non_lu" }); }} className="space-y-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Expediteur</Label><Input value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="M. Dupont" /></div>
        <div>
          <Label className="text-xs">Canal</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="chat">Chat</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Label className="text-xs">Contenu *</Label><Textarea value={content} onChange={e => setContent(e.target.value)} required placeholder="Contenu du message..." rows={3} /></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}Enregistrer le message</Button>
    </form>
  );
}

function QuickProspectForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [title, setTitle] = useState("");
  const [contactName, setContactName] = useState("");
  const [company, setCompany] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState("site_web");
  const [stage, setStage] = useState("nouveau");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ title, contactName, company, value: value ? parseFloat(value) : 0, source, stage, probability: 25 }); }} className="space-y-3 mt-3">
      <div><Label className="text-xs">Titre du prospect *</Label><Input value={title} onChange={e => setTitle(e.target.value)} required placeholder="Projet renovation bureaux" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Nom du contact</Label><Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Jean Dupont" /></div>
        <div><Label className="text-xs">Entreprise</Label><Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Inc." /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><Label className="text-xs">Valeur (EUR)</Label><Input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="10000" /></div>
        <div>
          <Label className="text-xs">Source</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="site_web">Site web</SelectItem>
              <SelectItem value="recommandation">Recommandation</SelectItem>
              <SelectItem value="appel_froid">Appel froid</SelectItem>
              <SelectItem value="salon">Salon</SelectItem>
              <SelectItem value="reseaux_sociaux">Reseaux sociaux</SelectItem>
              <SelectItem value="autre">Autre</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Etape</Label>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nouveau">Nouveau</SelectItem>
              <SelectItem value="qualification">Qualification</SelectItem>
              <SelectItem value="proposition">Proposition</SelectItem>
              <SelectItem value="negociation">Negociation</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TrendingUp className="h-4 w-4 mr-2" />}Creer le prospect</Button>
    </form>
  );
}

function QuickEventForm({ onSubmit, loading }: { onSubmit: (d: any) => void; loading: boolean }) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState("reunion");
  const [description, setDescription] = useState("");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ title, startDate: startDate ? new Date(startDate).toISOString() : new Date().toISOString(), endDate: endDate ? new Date(endDate).toISOString() : undefined, type, description }); }} className="space-y-3 mt-3">
      <div><Label className="text-xs">Titre *</Label><Input value={title} onChange={e => setTitle(e.target.value)} required placeholder="Reunion commerciale" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Debut *</Label><Input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} required /></div>
        <div><Label className="text-xs">Fin</Label><Input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
      </div>
      <div>
        <Label className="text-xs">Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="reunion">Reunion</SelectItem>
            <SelectItem value="appel">Appel</SelectItem>
            <SelectItem value="formation">Formation</SelectItem>
            <SelectItem value="deadline">Deadline</SelectItem>
            <SelectItem value="autre">Autre</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label className="text-xs">Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Details..." rows={2} /></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CalendarDays className="h-4 w-4 mr-2" />}Creer l'evenement</Button>
    </form>
  );
}
