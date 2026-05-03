import { useState, useEffect, useCallback, useRef } from "react";
import { StickyNote, Plus, Trash2, Pin, PinOff, Search, RefreshCw, Edit, X, Check, Download, Copy, Printer, CheckSquare, Square, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const COLORS = [
  { key: "default", bg: "bg-card", border: "border-border", label: "Défaut" },
  { key: "yellow", bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800/50", label: "Jaune" },
  { key: "blue", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800/50", label: "Bleu" },
  { key: "green", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800/50", label: "Vert" },
  { key: "pink", bg: "bg-pink-50 dark:bg-pink-950/30", border: "border-pink-200 dark:border-pink-800/50", label: "Rose" },
  { key: "violet", bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-800/50", label: "Violet" },
  { key: "orange", bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800/50", label: "Orange" },
];

function getColor(key: string) {
  return COLORS.find(c => c.key === key) || COLORS[0];
}

function fmtDate(d: string) {
  const now = new Date();
  const dt = new Date(d);
  const diff = Math.floor((now.getTime() - dt.getTime()) / 1000);
  if (diff < 60) return "À l'instant";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  return dt.toLocaleDateString("fr-FR");
}

interface Note {
  id: number; title?: string; content: string; color: string;
  pinned: boolean; tags?: string[]; createdAt: string; updatedAt: string;
}

export default function NotesInternesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", color: "default", tags: "" });
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/notes-internes`, { credentials: "include" });
      if (!r.ok) throw new Error();
      setNotes(await r.json());
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les notes.", variant: "destructive" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if ((creating || editing) && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [creating, editing]);

  function startCreate() {
    setEditing(null);
    setForm({ title: "", content: "", color: "default", tags: "" });
    setCreating(true);
  }

  function startEdit(n: Note) {
    if (selectMode) { toggleSelect(n.id); return; }
    setCreating(false);
    setEditing(n);
    setForm({ title: n.title || "", content: n.content, color: n.color, tags: (n.tags || []).join(", ") });
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(n => n.id)));
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function save() {
    if (!form.content.trim()) { toast({ title: "Contenu requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = {
        title: form.title || null,
        content: form.content,
        color: form.color,
        tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      };
      const url = editing ? `${BASE}/api/notes-internes/${editing.id}` : `${BASE}/api/notes-internes`;
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      if (!r.ok) { toast({ title: "Erreur", variant: "destructive" }); return; }
      toast({ title: editing ? "Note modifiée" : "Note créée" });
      setCreating(false); setEditing(null);
      load();
    } finally { setSaving(false); }
  }

  async function duplicate(id: number) {
    try {
      const res = await fetch(`${BASE}/api/notes-internes/${id}/duplicate`, { method: "POST", credentials: "include" });
      if (res.ok) load();
    } catch { /* ignore */ }
  }

  async function remove(id: number) {
    if (!confirm("Supprimer cette note ?")) return;
    await fetch(`${BASE}/api/notes-internes/${id}`, { method: "DELETE", credentials: "include" });
    load();
  }

  async function togglePin(n: Note) {
    await fetch(`${BASE}/api/notes-internes/${n.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ pinned: !n.pinned }),
    });
    load();
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Supprimer ${selectedIds.size} note(s) ?`)) return;
    const ids = Array.from(selectedIds);
    const res = await fetch(`${BASE}/api/bulk/notes-internes/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
    if (res.ok) { toast({ title: `${ids.length} note(s) supprimée(s)` }); exitSelectMode(); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const handleBulkColor = async (color: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const res = await fetch(`${BASE}/api/bulk/notes-internes/color`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids, color }) });
    if (res.ok) { toast({ title: `${ids.length} note(s) mise(s) à jour` }); exitSelectMode(); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const filtered = notes.filter(n => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (n.title?.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || (n.tags || []).some(t => t.toLowerCase().includes(q)));
  });

  const pinned = filtered.filter(n => n.pinned);
  const unpinned = filtered.filter(n => !n.pinned);

  function NoteCard({ n }: { n: Note }) {
    const col = getColor(n.color);
    const isEditingThis = editing?.id === n.id;
    const isSelected = selectedIds.has(n.id);
    return (
      <div
        className={`rounded-xl border p-4 flex flex-col gap-2 transition-shadow hover:shadow-md cursor-pointer ${col.bg} ${col.border} ${isEditingThis ? "ring-2 ring-primary" : ""} ${isSelected ? "ring-2 ring-blue-500" : ""}`}
        onClick={() => selectMode ? toggleSelect(n.id) : undefined}
      >
        {selectMode && (
          <div className="flex items-center gap-2 mb-1">
            {isSelected ? <CheckSquare className="w-4 h-4 text-blue-500 shrink-0" /> : <Square className="w-4 h-4 text-muted-foreground shrink-0" />}
          </div>
        )}
        {isEditingThis && !selectMode ? (
          <>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Titre (optionnel)" className="text-sm font-medium bg-transparent border-none shadow-none px-0 h-7" />
            <Textarea ref={textareaRef} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={4} className="text-sm bg-transparent border-none shadow-none px-0 resize-none" />
            <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="Tags : urgente, idée, réunion" className="text-xs bg-transparent border-none shadow-none px-0 h-6" />
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLORS.map(c => (
                <button key={c.key} onClick={() => setForm(f => ({ ...f, color: c.key }))} className={`w-5 h-5 rounded-full border-2 ${c.bg.split(" ")[0] || "bg-white"} ${form.color === c.key ? "border-primary ring-1 ring-primary" : "border-transparent"}`} title={c.label} />
              ))}
              <div className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(null)}><X className="w-3 h-3" /></Button>
              <Button size="icon" className="h-6 w-6" disabled={saving} onClick={save}><Check className="w-3 h-3" /></Button>
            </div>
          </>
        ) : (
          <>
            {n.title && <p className="text-sm font-semibold leading-tight">{n.title}</p>}
            <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">{n.content}</p>
            {(n.tags || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {n.tags!.map(t => <Badge key={t} variant="secondary" className="text-xs px-1.5 py-0">{t}</Badge>)}
              </div>
            )}
            <div className="flex items-center justify-between mt-auto">
              <span className="text-xs text-muted-foreground">{fmtDate(n.updatedAt)}</span>
              {!selectMode && (
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => togglePin(n)} title={n.pinned ? "Désépingler" : "Épingler"}>
                    {n.pinned ? <PinOff className="w-3 h-3 text-amber-500" /> : <Pin className="w-3 h-3" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEdit(n)} title="Modifier">
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => duplicate(n.id)} title="Dupliquer">
                    <Copy className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => remove(n.id)} title="Supprimer">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><StickyNote className="w-6 h-6 text-amber-500" />Notes Internes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{notes.length} note{notes.length !== 1 ? "s" : ""} · {pinned.length} épinglée{pinned.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Actualiser</Button>
          <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/notes-internes/export/csv`} download>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />CSV</Button>
          </a>
          <Button variant="outline" size="sm" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button
            variant={selectMode ? "secondary" : "outline"}
            size="sm"
            onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); setEditing(null); }}
            title="Mode sélection"
          >
            <CheckSquare className="w-4 h-4 mr-2" />{selectMode ? "Quitter la sélection" : "Sélectionner"}
          </Button>
          {!selectMode && <Button size="sm" onClick={startCreate}><Plus className="w-4 h-4 mr-2" />Nouvelle note</Button>}
        </div>
      </div>

      {selectMode && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg flex-wrap">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={toggleSelectAll}>
            {selectedIds.size === filtered.length && filtered.length > 0 ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
            {selectedIds.size === filtered.length && filtered.length > 0 ? "Tout désélectionner" : "Tout sélectionner"}
          </Button>
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{selectedIds.size} note(s) sélectionnée(s)</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"><Palette className="w-3 h-3" />Couleur</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Changer la couleur</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COLORS.map(c => (
                    <DropdownMenuItem key={c.key} onClick={() => handleBulkColor(c.key)} className="cursor-pointer">{c.label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="destructive" className="gap-1 h-7 text-xs" onClick={handleBulkDelete}><Trash2 className="w-3 h-3" />Supprimer</Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={exitSelectMode}>Annuler</Button>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Rechercher dans les notes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {creating && (
        <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800/50 rounded-xl p-4 space-y-2 ring-2 ring-primary">
          <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Titre (optionnel)" className="bg-transparent border-none shadow-none px-0 font-medium" />
          <Textarea ref={textareaRef} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="Écrivez votre note ici..." rows={4} className="bg-transparent border-none shadow-none px-0 resize-none" />
          <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="Tags : urgente, idée, réunion (séparés par virgule)" className="text-xs bg-transparent border-none shadow-none px-0 h-6" />
          <div className="flex items-center gap-1.5 flex-wrap">
            {COLORS.map(c => (
              <button key={c.key} onClick={() => setForm(f => ({ ...f, color: c.key }))} className={`w-5 h-5 rounded-full border-2 ${c.bg.split(" ")[0] || "bg-white"} ${form.color === c.key ? "border-primary ring-1 ring-primary" : "border-transparent"}`} title={c.label} />
            ))}
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setCreating(false)}>Annuler</Button>
            <Button size="sm" disabled={saving} onClick={save}>{saving ? "Enregistrement..." : "Créer"}</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl break-inside-avoid" />)}
        </div>
      ) : filtered.length === 0 && !creating ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <StickyNote className="w-12 h-12 opacity-20" />
          <p className="font-medium">{search ? "Aucune note trouvée" : "Aucune note pour l'instant"}</p>
          {!search && <Button onClick={startCreate}><Plus className="w-4 h-4 mr-2" />Créer la première note</Button>}
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5"><Pin className="w-3 h-3" />Épinglées</p>
              <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {pinned.map(n => <div key={n.id} className="break-inside-avoid"><NoteCard n={n} /></div>)}
              </div>
            </div>
          )}
          {unpinned.length > 0 && (
            <div>
              {pinned.length > 0 && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Autres notes</p>}
              <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {unpinned.map(n => <div key={n.id} className="break-inside-avoid"><NoteCard n={n} /></div>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
