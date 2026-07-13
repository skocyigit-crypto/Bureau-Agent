import { useState, useEffect, useMemo, useRef } from "react";
import {
  useListWhatsappConversations,
  useGetWhatsappConversation,
  useSendWhatsappMessage,
  useGenerateWhatsappDraft,
  useUpdateWhatsappConversation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  MessageCircle,
  Search,
  Send,
  Sparkles,
  Loader2,
  CheckCheck,
  Archive,
  ArchiveRestore,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { QueryErrorAlert } from "@/components/safe-component";
import { cn } from "@/lib/utils";

// Clés de cache sémantiques (préfixe commun) pour que l'invalidation temps réel
// SSE — QUERY_MAP `whatsapp -> [["whatsapp-conversations"]]` dans
// use-realtime-sync.tsx — rafraîchisse à la fois la liste et le fil ouvert.
// Les clés générées par orval sont basées sur l'URL et n'ont pas de préfixe
// commun entre liste et détail, donc on les surcharge ici.
const WA_ROOT_KEY = ["whatsapp-conversations"] as const;
const waListKey = (params: unknown) => [...WA_ROOT_KEY, "list", params] as const;
const waDetailKey = (id: number) => [...WA_ROOT_KEY, "detail", id] as const;

type StatusFilter = "open" | "closed" | "all";

function initials(name: string | null | undefined, phone: string): string {
  const src = (name ?? "").trim() || phone;
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  try {
    return format(new Date(d), "d MMM HH:mm", { locale: fr });
  } catch {
    return "";
  }
}

export default function WhatsappInbox() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composer, setComposer] = useState("");
  const lastDraftRef = useRef<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const listParams = useMemo(
    () => ({
      status: statusFilter,
      search: debouncedSearch || undefined,
      limit: 100,
      offset: 0,
    }),
    [statusFilter, debouncedSearch],
  );

  const {
    data: listData,
    isLoading: listLoading,
    error: listError,
  } = useListWhatsappConversations(listParams, {
    query: { queryKey: waListKey(listParams) },
  });

  const conversations = listData?.conversations ?? [];

  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
  } = useGetWhatsappConversation(selectedId ?? 0, {
    query: {
      queryKey: waDetailKey(selectedId ?? 0),
      enabled: selectedId !== null,
    },
  });

  const sendMutation = useSendWhatsappMessage();
  const draftMutation = useGenerateWhatsappDraft();
  const updateMutation = useUpdateWhatsappConversation();

  const conv = detail?.conversation;
  const messages = detail?.messages ?? [];

  // Pré-remplit le composer avec le brouillon IA dès qu'il devient "ready"
  // (sans écraser une saisie de l'utilisateur en cours).
  useEffect(() => {
    if (!conv) return;
    if (conv.draftStatus === "ready" && conv.draftReply) {
      const key = `${conv.id}:${conv.draftReply}`;
      if (lastDraftRef.current !== key && composer.trim() === "") {
        setComposer(conv.draftReply);
        lastDraftRef.current = key;
      }
    }
  }, [conv?.id, conv?.draftStatus, conv?.draftReply]); // eslint-disable-line react-hooks/exhaustive-deps

  // Réinitialise le composer en changeant de conversation.
  useEffect(() => {
    setComposer("");
    lastDraftRef.current = null;
  }, [selectedId]);

  // Auto-scroll vers le dernier message.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedId]);

  const invalidate = (_id: number | null) => {
    // Le préfixe racine couvre liste + détail (toutes paramétrisations).
    queryClient.invalidateQueries({ queryKey: WA_ROOT_KEY });
  };

  const handleSend = () => {
    if (!conv || composer.trim() === "") return;
    sendMutation.mutate(
      { id: conv.id, data: { text: composer.trim() } },
      {
        onSuccess: () => {
          setComposer("");
          lastDraftRef.current = null;
          invalidate(conv.id);
          toast({ title: "Message envoyé", description: "Votre réponse a été transmise au client." });
        },
        onError: (e: any) => {
          toast({
            title: "Échec de l'envoi",
            description: e?.message || "Le message n'a pas pu être envoyé.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleGenerateDraft = () => {
    if (!conv) return;
    draftMutation.mutate(
      { id: conv.id },
      {
        onSuccess: () => {
          invalidate(conv.id);
          toast({ title: "Brouillon en préparation", description: "L'IA rédige une suggestion de réponse…" });
        },
        onError: (e: any) => {
          toast({ title: "Erreur", description: e?.message || "Impossible de générer un brouillon.", variant: "destructive" });
        },
      },
    );
  };

  const handleToggleStatus = () => {
    if (!conv) return;
    const next = conv.status === "open" ? "closed" : "open";
    updateMutation.mutate(
      { id: conv.id, data: { status: next } },
      {
        onSuccess: () => {
          invalidate(conv.id);
          toast({ title: next === "closed" ? "Conversation archivée" : "Conversation rouverte" });
        },
      },
    );
  };

  const draftBusy = conv?.draftStatus === "generating" || draftMutation.isPending;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600">
          <MessageCircle className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Boîte WhatsApp clients</h1>
          <p className="text-sm text-muted-foreground">
            Les messages de vos clients arrivent ici. L'IA prépare une réponse — vous validez avant l'envoi.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] gap-4 flex-1 min-h-0">
        {/* Liste des conversations */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
          <div className="p-3 border-b space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un client…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-whatsapp-search"
              />
            </div>
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="open" data-testid="tab-whatsapp-open">Ouvertes</TabsTrigger>
                <TabsTrigger value="closed" data-testid="tab-whatsapp-closed">Archivées</TabsTrigger>
                <TabsTrigger value="all" data-testid="tab-whatsapp-all">Toutes</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-y-auto">
            {listError ? (
              <div className="p-4">
                <QueryErrorAlert error={listError} />
              </div>
            ) : listLoading ? (
              <div className="p-3 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
                <MessageCircle className="w-10 h-10 mb-3 opacity-40" />
                <p className="font-medium">Aucune conversation</p>
                <p className="text-sm">Les nouveaux messages clients apparaîtront ici.</p>
              </div>
            ) : (
              <ul>
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "w-full text-left px-3 py-3 flex gap-3 border-b hover:bg-muted/50 transition-colors",
                        selectedId === c.id && "bg-muted",
                      )}
                      data-testid={`conversation-${c.id}`}
                    >
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-700 font-semibold text-sm shrink-0">
                        {initials(c.customerName, c.customerPhone)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {c.customerName || c.customerPhone}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {fmtTime(c.lastMessageAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-sm text-muted-foreground truncate">
                            {c.lastDirection === "outbound" && (
                              <CheckCheck className="inline w-3.5 h-3.5 mr-1 text-emerald-500" />
                            )}
                            {c.lastMessagePreview || "—"}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {c.draftStatus === "ready" && (
                              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                            )}
                            {c.unreadCount > 0 && (
                              <Badge className="bg-emerald-500 hover:bg-emerald-500 h-5 min-w-5 px-1.5 justify-center">
                                {c.unreadCount}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Fil + composer */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
          {selectedId === null ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
              <MessageCircle className="w-12 h-12 mb-3 opacity-30" />
              <p className="font-medium">Sélectionnez une conversation</p>
              <p className="text-sm">Choisissez un client à gauche pour voir l'échange.</p>
            </div>
          ) : detailError ? (
            <div className="p-4">
              <QueryErrorAlert error={detailError} />
            </div>
          ) : detailLoading || !conv ? (
            <div className="p-4 space-y-4">
              <Skeleton className="h-12 w-1/2" />
              <Skeleton className="h-16 w-2/3" />
              <Skeleton className="h-16 w-2/3 ml-auto" />
            </div>
          ) : (
            <>
              {/* En-tête */}
              <div className="flex items-center justify-between gap-3 p-3 border-b">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-700 font-semibold text-sm shrink-0">
                    {initials(conv.customerName, conv.customerPhone)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{conv.customerName || conv.customerPhone}</div>
                    <div className="text-xs text-muted-foreground truncate">{conv.customerPhone}</div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleStatus}
                  disabled={updateMutation.isPending}
                  data-testid="button-toggle-status"
                >
                  {conv.status === "open" ? (
                    <><Archive className="w-4 h-4 mr-1.5" /> Archiver</>
                  ) : (
                    <><ArchiveRestore className="w-4 h-4 mr-1.5" /> Rouvrir</>
                  )}
                </Button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
                {messages.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">Aucun message.</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words shadow-sm",
                          m.direction === "outbound"
                            ? "bg-emerald-500 text-white rounded-br-sm"
                            : "bg-white border rounded-bl-sm",
                        )}
                        data-testid={`message-${m.id}`}
                      >
                        {m.body || (m.mediaUrls.length > 0 ? "📎 Pièce jointe" : "")}
                        <div
                          className={cn(
                            "text-[10px] mt-1 text-right",
                            m.direction === "outbound" ? "text-emerald-50/80" : "text-muted-foreground",
                          )}
                        >
                          {fmtTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Composer */}
              <div className="border-t p-3 space-y-2">
                {conv.draftStatus === "generating" && (
                  <div className="flex items-center gap-2 text-xs text-amber-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> L'IA prépare une suggestion…
                  </div>
                )}
                {conv.draftStatus === "failed" && conv.draftError && (
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5" /> {conv.draftError}
                  </div>
                )}
                {conv.draftStatus === "ready" && (
                  <div className="flex items-center gap-2 text-xs text-emerald-600">
                    <Sparkles className="w-3.5 h-3.5" /> Suggestion IA pré-remplie — relisez avant d'envoyer.
                  </div>
                )}
                <Textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Écrivez votre réponse ou validez la suggestion de l'IA…"
                  rows={3}
                  className="resize-none"
                  data-testid="input-composer"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateDraft}
                    disabled={draftBusy}
                    data-testid="button-generate-draft"
                  >
                    {draftBusy ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-1.5" />
                    )}
                    Suggérer une réponse
                  </Button>
                  <Button
                    onClick={handleSend}
                    disabled={sendMutation.isPending || composer.trim() === ""}
                    className="bg-emerald-500 hover:bg-emerald-600"
                    data-testid="button-send"
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-1.5" />
                    )}
                    Envoyer
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
