import { createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { Phone, Users, CheckSquare, MessageSquare, BarChart, Bell, Search, LayoutDashboard, Settings, PhoneIncoming, FileText, Puzzle } from "lucide-react";
import { AiAssistantButton } from "@/components/ai-assistant";
import { AiHealthBadge, RecognitionProvider } from "@/components/ai-recognition-panel";
import { IncomingCallOverlay, useIncomingCall } from "@/components/incoming-call-overlay";
import { WorkspaceUserProvider, UserProfileButton, WorkspaceUserSidebarInfo } from "@/components/workspace-user";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarTrigger, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarFooter } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useGetNotifications } from "@workspace/api-client-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type IncomingCallContextType = { simulateIncomingCall: (phone?: string) => void };
const IncomingCallContext = createContext<IncomingCallContextType>({ simulateIncomingCall: () => {} });
export const useSimulateCall = () => useContext(IncomingCallContext);

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: notifsData } = useGetNotifications({ query: { queryKey: ["notifications"] } });

  const incomingCall = useIncomingCall();

  const navigation = [
    { name: "Tableau de bord", href: "/", icon: LayoutDashboard },
    { name: "Appels", href: "/appels", icon: Phone },
    { name: "Contacts", href: "/contacts", icon: Users },
    { name: "Tâches", href: "/taches", icon: CheckSquare },
    { name: "Messages", href: "/messages", icon: MessageSquare },
    { name: "Rapports", href: "/rapports", icon: FileText },
    { name: "Logiciels", href: "/logiciels", icon: Puzzle },
    { name: "Analyse", href: "/analyse", icon: BarChart },
    { name: "Parametres", href: "/parametres", icon: Settings },
  ];

  return (
    <IncomingCallContext.Provider value={{ simulateIncomingCall: incomingCall.simulateIncomingCall }}>
    <WorkspaceUserProvider>
    <RecognitionProvider>
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-3 px-2 py-1">
              <div className="bg-primary text-primary-foreground rounded-md p-1.5 flex items-center justify-center">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sidebar-foreground font-semibold text-base leading-none">Agent de Bureau</h1>
                <p className="text-sidebar-foreground/60 text-xs mt-1">Paris HQ</p>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Menu Principal</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigation.map((item) => (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton 
                        asChild 
                        isActive={location === item.href}
                        tooltip={item.name}
                      >
                        <Link href={item.href} className="flex items-center gap-3">
                          <item.icon className="w-4 h-4" />
                          <span>{item.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-0">
            <WorkspaceUserSidebarInfo />
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 lg:px-6 sticky top-0 z-10">
            <div className="flex items-center gap-4">
              <SidebarTrigger />
              <div className="relative w-64 hidden md:block">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Rechercher..."
                  className="w-full bg-muted/50 border-none pl-9 h-9"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                    onClick={() => incomingCall.simulateIncomingCall()}
                  >
                    <PhoneIncoming className="w-5 h-5" />
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Simuler un appel entrant</TooltipContent>
              </Tooltip>
              <AiHealthBadge />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted outline-none">
                    <Bell className="w-5 h-5" />
                    {notifsData && notifsData.unreadCount > 0 && (
                      <span className="absolute top-0 right-0 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center rounded-full border border-card">
                        {notifsData.unreadCount}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifsData?.notifications && notifsData.notifications.length > 0 ? (
                     notifsData.notifications.map(notif => (
                       <DropdownMenuItem key={notif.id} className={`flex flex-col items-start gap-1 p-3 cursor-pointer ${!notif.isRead ? 'bg-muted/50' : ''}`}>
                          <div className="flex items-center justify-between w-full">
                            <span className="font-medium text-sm">{notif.title}</span>
                            {!notif.isRead && <div className="w-2 h-2 rounded-full bg-primary"></div>}
                          </div>
                          <span className="text-xs text-muted-foreground line-clamp-2">{notif.description}</span>
                       </DropdownMenuItem>
                     ))
                  ) : (
                    <div className="p-4 text-center text-sm text-muted-foreground">Aucune notification</div>
                  )}
                  {notifsData?.notifications && notifsData.notifications.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="justify-center text-primary text-sm font-medium">Tout marquer comme lu</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              
              <UserProfileButton />
            </div>
          </header>
          
          <main className="flex-1 p-4 lg:p-8 overflow-auto">
            <div className="mx-auto max-w-6xl">
              {children}
            </div>
          </main>
        </div>
        <AiAssistantButton />
      </div>
    </SidebarProvider>
    </RecognitionProvider>
    </WorkspaceUserProvider>
    <IncomingCallOverlay
      isVisible={incomingCall.isVisible}
      callData={incomingCall.callData}
      onClose={incomingCall.closeCall}
    />
    </IncomingCallContext.Provider>
  );
}
