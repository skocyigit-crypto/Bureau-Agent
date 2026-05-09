import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, Send, Plus, Trash2, Wrench, CheckCircle2, AlertCircle, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const API = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

interface Conversation { id: number; title: string; updatedAt: string; }
interface Message {
  id: number; role: "user" | "assistant" | "tool_call" | "tool_result";
  content: string; toolName?: string | null; toolArgs?: any; toolResult?: any;
  createdAt: string;
}

interface StepEvent {
  type: "step"; toolName: string; toolArgs?: any; toolResult?: any;
}

function ToolStep({ name, args, result }: { name: string; args?: any; result?: any }) {
  const done = result !== undefined;
  const failed = done && result && typeof result === "object" && "error" in result;
  const Icon = !done ? Loader2 : failed ? AlertCircle : CheckCircle2;
  const color = !done ? "text-blue-500" : failed ? "text-red-500" : "text-emerald-500";
  return (
    <div className="flex items-start gap-2 py-1.5 px-3 rounded-md bg-muted/40 text-xs">
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${color} ${!done ? "animate-spin" : ""}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Wrench className="h-3 w-3 text-muted-foreground" />
          <code className="font-mono text-[11px]">{name}</code>
        </div>
        {args && Object.keys(args).length > 0 && (
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
            {JSON.stringify(args).slice(0, 160)}
          </div>
        )}
        {done && (
          <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
            {failed ? `Erreur: ${result.error}` : (typeof result === "string" ? result : JSON.stringify(result).slice(0, 240))}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "tool_call" || msg.role === "tool_result") return null;
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-2">
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
        <Sparkles className="h-4 w-4 text-white" />
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
        {msg.content}
      </div>
    </div>
  );
}

export default function AsistanPage() {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [liveSteps, setLiveSteps] = useState<StepEvent[]>([]);
  const [liveText, setLiveText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/assistant/conversations`, { credentials: "include" });
      if (!r.ok) return;
      const d = await r.json();
      setConversations(d.conversations ?? []);
    } catch {}
  }, []);

  const loadConversation = useCallback(async (id: number) => {
    setActiveId(id);
    setMessages([]);
    setLiveSteps([]);
    setLiveText(null);
    try {
      const r = await fetch(`${API}/api/assistant/conversations/${id}`, { credentials: "include" });
      if (!r.ok) return;
      const d = await r.json();
      setMessages(d.messages ?? []);
    } catch {}
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveSteps, liveText]);

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
    setLiveSteps([]);
    setLiveText(null);
  };

  const deleteConversation = async (id: number) => {
    if (!confirm("Supprimer cette conversation ?")) return;
    try {
      await fetch(`${API}/api/assistant/conversations/${id}`, { method: "DELETE", credentials: "include" });
      if (activeId === id) newConversation();
      loadConversations();
    } catch {}
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setStreaming(true);
    setLiveSteps([]);
    setLiveText(null);

    // Append user message optimistically
    const tempUserMsg: Message = {
      id: -Date.now(), role: "user", content: text, createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    let assignedConvId = activeId;

    try {
      const res = await fetch(`${API}/api/assistant/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId ?? undefined, message: text }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Erreur reseau" }));
        toast({ title: "Echec", description: err.error ?? "Echec de la requete", variant: "destructive" });
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          let event = "message";
          let dataLines: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
          }
          let data: any;
          try { data = JSON.parse(dataLines.join("\n")); } catch { continue; }

          if (event === "init") {
            assignedConvId = data.conversationId;
            setActiveId(data.conversationId);
          } else if (event === "step") {
            setLiveSteps(prev => {
              const last = prev[prev.length - 1];
              // If step has result and matches last open step, complete it
              if (data.toolResult !== undefined && last && last.toolName === data.toolName && last.toolResult === undefined) {
                return [...prev.slice(0, -1), data];
              }
              return [...prev, data];
            });
          } else if (event === "text") {
            setLiveText(data.text);
          } else if (event === "done") {
            // refresh full thread to get persisted IDs
            if (assignedConvId) {
              const cr = await fetch(`${API}/api/assistant/conversations/${assignedConvId}`, { credentials: "include" });
              if (cr.ok) {
                const d = await cr.json();
                setMessages(d.messages ?? []);
              }
            }
            setLiveSteps([]);
            setLiveText(null);
            loadConversations();
          } else if (event === "error") {
            toast({ title: "Erreur", description: data.error ?? "Erreur de l'assistant", variant: "destructive" });
          } else if (event === "close") {
            // server signaled stream end
          }
        }
      }
    } catch (err: any) {
      toast({ title: "Connexion perdue", description: err?.message ?? "", variant: "destructive" });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-3 p-3">
      {/* Sidebar */}
      <div className="w-64 shrink-0 hidden md:flex flex-col gap-2">
        <Button onClick={newConversation} className="w-full justify-start" variant="default" data-testid="button-new-conversation">
          <Plus className="h-4 w-4 mr-2" /> Nouvelle conversation
        </Button>
        <ScrollArea className="flex-1 rounded-md border bg-card/50">
          <div className="p-2 space-y-1">
            {conversations.length === 0 && (
              <div className="text-xs text-muted-foreground p-3 text-center">Aucune conversation pour l'instant.</div>
            )}
            {conversations.map(c => (
              <div key={c.id} className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-accent ${activeId === c.id ? "bg-accent" : ""}`} onClick={() => loadConversation(c.id)} data-testid={`conv-${c.id}`}>
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs flex-1 truncate">{c.title}</span>
                <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }} className="opacity-0 group-hover:opacity-100 transition" data-testid={`del-conv-${c.id}`}>
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main panel */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Assistant Universel</h2>
            <p className="text-xs text-muted-foreground">Donne-lui une mission. Il peut creer, lister, envoyer des e-mails/SMS, planifier, generer des images.</p>
          </div>
        </div>

        <ScrollArea className="flex-1" ref={scrollRef as any}>
          <div className="p-4 space-y-3 max-w-3xl mx-auto">
            {messages.length === 0 && liveSteps.length === 0 && !liveText && (
              <div className="text-center py-12 space-y-3">
                <div className="text-sm text-muted-foreground">Que puis-je faire pour vous ?</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-xl mx-auto text-xs">
                  {[
                    "Resume mon activite de la semaine",
                    "Cree une tache 'Rappeler M. Dupont' demain 10h",
                    "Liste mes 5 derniers prospects",
                    "Envoie un SMS a +33612345678 : 'Notre rendez-vous est confirme.'",
                  ].map(s => (
                    <button key={s} onClick={() => setInput(s)} className="text-left p-2 rounded-md border bg-muted/30 hover:bg-muted transition">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
            {liveSteps.length > 0 && (
              <div className="space-y-1.5 ml-10">
                {liveSteps.map((s, i) => <ToolStep key={i} name={s.toolName} args={s.toolArgs} result={s.toolResult} />)}
              </div>
            )}
            {liveText && (
              <div className="flex justify-start gap-2">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">{liveText}</div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-3 border-t bg-card">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={streaming ? "L'assistant travaille..." : "Demandez n'importe quoi (Entree pour envoyer, Maj+Entree pour saut de ligne)"}
              disabled={streaming}
              rows={2}
              className="resize-none"
              data-testid="input-assistant-message"
            />
            <Button onClick={send} disabled={streaming || !input.trim()} size="lg" data-testid="button-send-assistant">
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
