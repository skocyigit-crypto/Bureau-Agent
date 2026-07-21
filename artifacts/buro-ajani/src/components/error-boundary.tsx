import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);

    // Apres un deploiement, les noms de fichiers JS changent (hash de contenu).
    // Un onglet ouvert AVANT le deploiement reference des chunks qui n'existent
    // plus: le chargement paresseux d'une route echoue et tombe ici. C'est
    // exactement le symptome "la page se ferme et demande de recharger". On
    // recharge alors automatiquement UNE fois (garde sessionStorage pour ne pas
    // boucler si le vrai probleme est autre chose) afin de recuperer la version
    // a jour sans que l'utilisateur ait a le faire manuellement.
    const msg = error?.message || "";
    const isChunkError = /chunk|dynamically imported|Failed to fetch|Importing a module script failed|error loading/i.test(msg);
    if (isChunkError && !sessionStorage.getItem("chunk-reload-done")) {
      sessionStorage.setItem("chunk-reload-done", "1");
      window.location.reload();
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1729] via-[#1a2744] to-[#0f1729] p-6">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Une erreur inattendue s'est produite
              </h2>
              <p className="text-white/60 text-sm">
                L'application a rencontre un probleme. Vous pouvez reessayer ou recharger la page.
              </p>
              {this.state.error?.message && (
                // Le message reel est affiche (et non seulement journalise en
                // console) pour qu'un utilisateur non technique puisse le
                // signaler par capture d'ecran. Sans lui, chaque incident
                // ressemble a "l'appli plante" sans cause identifiable.
                <p className="mt-3 text-[11px] text-red-300/80 font-mono break-words bg-red-500/10 rounded-md px-3 py-2 border border-red-500/20">
                  {this.state.error.message}
                </p>
              )}
            </div>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={this.handleRetry} className="border-white/20 text-white hover:bg-white/10">
                Reessayer
              </Button>
              <Button onClick={this.handleReload} className="bg-amber-500 hover:bg-amber-600 text-black">
                <RefreshCw className="w-4 h-4 mr-2" />
                Recharger la page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
