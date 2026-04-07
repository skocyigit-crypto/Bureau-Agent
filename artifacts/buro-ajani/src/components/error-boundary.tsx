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
