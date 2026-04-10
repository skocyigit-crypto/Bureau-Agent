import { useState } from "react";
import { PhoneIncoming } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSimulateCall } from "@/components/layout";

export function TabAppels() {
  const [callRingDuration, setCallRingDuration] = useState("30");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const { simulateIncomingCall } = useSimulateCall();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneIncoming className="w-5 h-5" />
            Gestion des appels entrants
          </CardTitle>
          <CardDescription>Configurez le comportement des appels entrants.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Duree de sonnerie</Label>
              <p className="text-xs text-muted-foreground">Temps avant bascule en appel manque</p>
            </div>
            <Select value={callRingDuration} onValueChange={setCallRingDuration}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 secondes</SelectItem>
                <SelectItem value="30">30 secondes</SelectItem>
                <SelectItem value="45">45 secondes</SelectItem>
                <SelectItem value="60">60 secondes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Son de sonnerie</Label>
              <p className="text-xs text-muted-foreground">Jouer un son lors d'un appel entrant</p>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Identification automatique</Label>
              <p className="text-xs text-muted-foreground">Rechercher le contact correspondant au numero</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Enregistrement automatique</Label>
              <p className="text-xs text-muted-foreground">Enregistrer automatiquement chaque appel dans l'historique</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div>
            <Label className="mb-2 block">Tester l'experience d'appel</Label>
            <p className="text-xs text-muted-foreground mb-3">Simulez un appel entrant pour tester l'interface.</p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => simulateIncomingCall()} className="gap-2">
                <PhoneIncoming className="w-4 h-4" />
                Simuler un appel
              </Button>
              <Input placeholder="+33 1 XX XX XX XX" className="w-48" id="custom-phone" />
              <Button
                variant="secondary"
                onClick={() => {
                  const input = document.getElementById("custom-phone") as HTMLInputElement;
                  if (input?.value) simulateIncomingCall(input.value);
                }}
              >
                Appeler ce numero
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Intelligence IA pour les appels</CardTitle>
          <CardDescription>Fonctionnalites IA appliquees aux appels.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Analyse de sentiment en temps reel</Label>
              <p className="text-xs text-muted-foreground">L'IA analyse le ton de la conversation</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Suggestions contextuelles pendant l'appel</Label>
              <p className="text-xs text-muted-foreground">Afficher des suggestions basees sur l'historique du contact</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Resume automatique post-appel</Label>
              <p className="text-xs text-muted-foreground">Generer un resume IA apres chaque appel</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Detection des rappels necessaires</Label>
              <p className="text-xs text-muted-foreground">L'IA detecte si un rappel est necessaire et cree la tache</p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
