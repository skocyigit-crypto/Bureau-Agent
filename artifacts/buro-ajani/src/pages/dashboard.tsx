import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Users, CheckSquare, MessageSquare, ArrowUpRight, ArrowDownRight, PhoneIncoming, PhoneOutgoing, PhoneMissed } from "lucide-react";
import { useGetDashboardSummary, useGetCallAnalytics, useGetRecentActivity, useGetTopContacts } from "@workspace/api-client-react";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({ query: { queryKey: ["dashboardSummary"] } });
  const { data: recentActivity, isLoading: isLoadingActivity } = useGetRecentActivity({ limit: 5 }, { query: { queryKey: ["recentActivity"] } });
  const { data: topContacts, isLoading: isLoadingContacts } = useGetTopContacts({ limit: 4 }, { query: { queryKey: ["topContacts"] } });

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-muted-foreground mt-1">Vue d'ensemble de l'activité du bureau aujourd'hui.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Appels Aujourd'hui</CardTitle>
            <Phone className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
              <>
                <div className="text-2xl font-bold">{summary?.totalCallsToday || 0}</div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {summary?.callsTrend && summary.callsTrend > 0 ? (
                    <span className="text-emerald-500 flex items-center"><ArrowUpRight className="w-3 h-3 mr-1" />{summary.callsTrend}%</span>
                  ) : (
                    <span className="text-destructive flex items-center"><ArrowDownRight className="w-3 h-3 mr-1" />{Math.abs(summary?.callsTrend || 0)}%</span>
                  )}
                  depuis la semaine dernière
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contacts</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{summary?.totalContacts || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tâches en attente</CardTitle>
            <CheckSquare className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{summary?.pendingTasks || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Messages non lus</CardTitle>
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{summary?.unreadMessages || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Activité Récente</CardTitle>
            <CardDescription>Les derniers événements enregistrés par le secrétariat.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingActivity ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {recentActivity?.activities?.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-4">
                    <div className="bg-muted p-2 rounded-full mt-0.5">
                      {activity.type === 'appel' && <Phone className="w-4 h-4 text-primary" />}
                      {activity.type === 'contact' && <Users className="w-4 h-4 text-blue-500" />}
                      {activity.type === 'tache' && <CheckSquare className="w-4 h-4 text-emerald-500" />}
                      {activity.type === 'message' && <MessageSquare className="w-4 h-4 text-amber-500" />}
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{activity.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(activity.timestamp).toLocaleString('fr-FR', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                ))}
                {!recentActivity?.activities?.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucune activité récente.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Contacts Fréquents</CardTitle>
            <CardDescription>Contacts avec le plus d'interactions.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingContacts ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {topContacts?.contacts?.map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center text-sm font-medium text-secondary">
                        {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-none">{contact.firstName} {contact.lastName}</p>
                        <p className="text-xs text-muted-foreground mt-1">{contact.company || 'Indépendant'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{contact.totalCalls} appels</div>
                    </div>
                  </div>
                ))}
                {!topContacts?.contacts?.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucun contact trouvé.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}