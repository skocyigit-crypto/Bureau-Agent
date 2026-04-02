import { useState } from "react";
import { useListMessages, useUpdateMessage, useCreateMessage, getListMessagesQueryKey, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { MessageSquare, Voicemail, FileText, Bell, Search, Filter, MoreHorizontal, MailOpen, Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const formSchema = z.object({
  contactId: z.string().transform(v => v === "none" ? null : parseInt(v)).optional().nullable(),
  phoneNumber: z.string().min(1, "Le numéro est requis"),
  content: z.string().min(1, "Le message est requis"),
  type: z.enum(["messagerie_vocale", "note", "rappel"]),
  priority: z.enum(["haute", "moyenne", "basse"]),
});

export default function Messages() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [readFilter, setReadFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data, isLoading } = useListMessages(
    { read: readFilter === "all" ? undefined : readFilter === "read" },
    { query: { queryKey: getListMessagesQueryKey({ read: readFilter === "all" ? undefined : readFilter === "read" }) } }
  );

  const { data: contactsData } = useListContacts({ limit: 100 }, { query: { queryKey: ["contacts", "all"] } });

  const updateMessage = useUpdateMessage();
  const createMessage = useCreateMessage();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: null as any,
      phoneNumber: "",
      content: "",
      type: "note",
      priority: "moyenne",
    }
  });

  const handleReadToggle = (id: number, isRead: boolean) => {
    updateMessage.mutate({ id, data: { isRead } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["dashboardSummary"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
    });
  };

  const onSubmit = (values: any) => {
    createMessage.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Message enregistré" });
        setIsDialogOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible d'enregistrer le message", variant: "destructive" });
      }
    });
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'messagerie_vocale': return <Voicemail className="w-4 h-4 text-amber-500" />;
      case 'note': return <FileText className="w-4 h-4 text-blue-500" />;
      case 'rappel': return <Bell className="w-4 h-4 text-emerald-500" />;
      default: return <MessageSquare className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'haute': return <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Haute</Badge>;
      case 'moyenne': return <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-amber-500/20 text-amber-700">Moyenne</Badge>;
      case 'basse': return null; 
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Messages & Notes</h1>
          <p className="text-muted-foreground mt-1">Consultez les messages vocaux et notes laissés par les appelants.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau Message
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Enregistrer un message</DialogTitle>
                <DialogDescription>Ajoutez une note, un rappel ou consignez un message vocal.</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="type" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="note">Note</SelectItem>
                            <SelectItem value="messagerie_vocale">Message vocal</SelectItem>
                            <SelectItem value="rappel">Rappel</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="priority" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priorité</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="haute">Haute</SelectItem>
                            <SelectItem value="moyenne">Moyenne</SelectItem>
                            <SelectItem value="basse">Basse</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Numéro de téléphone</FormLabel>
                      <FormControl><Input placeholder="+33 6..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="contactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Associer à un contact (Optionnel)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Choisir un contact..."/></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">Aucun</SelectItem>
                          {contactsData?.contacts.map(c => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.firstName} {c.lastName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="content" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contenu du message</FormLabel>
                      <FormControl><Textarea className="resize-none h-24" placeholder="Saisissez le contenu..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <DialogFooter>
                    <Button type="submit" disabled={createMessage.isPending}>Enregistrer</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="flex-1 w-full sm:max-w-sm" />
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={readFilter} onValueChange={setReadFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="État de lecture" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les messages</SelectItem>
              <SelectItem value="unread">Non lus</SelectItem>
              <SelectItem value="read">Lus</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>De</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-1/2">Contenu</TableHead>
              <TableHead>Reçu le</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="w-6 h-6 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32 mb-1" /><Skeleton className="h-3 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.messages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  Aucun message trouvé.
                </TableCell>
              </TableRow>
            ) : (
              data?.messages.map((message) => (
                <TableRow key={message.id} className={`hover:bg-muted/30 transition-colors ${!message.isRead ? 'bg-primary/5' : ''}`}>
                  <TableCell>
                    <div className="flex items-center justify-center p-2 bg-background border border-border rounded-full shadow-sm">
                      {getTypeIcon(message.type)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className={`font-medium ${!message.isRead ? 'text-foreground font-bold' : 'text-foreground'}`}>
                      {message.contactId ? (
                        <Link href={`/contacts/${message.contactId}`} className="hover:underline hover:text-primary transition-colors">
                          {message.contactName || "Inconnu"}
                        </Link>
                      ) : (
                        message.contactName || "Inconnu"
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{message.phoneNumber}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-sm capitalize">{message.type.replace('_', ' ')}</span>
                      {getPriorityBadge(message.priority)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className={`text-sm line-clamp-2 ${!message.isRead ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {message.content}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">
                      {format(new Date(message.createdAt), "d MMM yyyy", { locale: fr })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(message.createdAt), "HH:mm", { locale: fr })}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Ouvrir le menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleReadToggle(message.id, !message.isRead)}>
                          {message.isRead ? (
                            <><Mail className="w-4 h-4 mr-2" /> Marquer comme non lu</>
                          ) : (
                            <><MailOpen className="w-4 h-4 mr-2" /> Marquer comme lu</>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}