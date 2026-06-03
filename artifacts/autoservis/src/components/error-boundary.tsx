import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw, Home, RefreshCw } from "lucide-react";
import { recoverFromStaleVersion, clearCachesAndReload } from "@/lib/app-reload";

type Props = {
  children: ReactNode;
  // When true, the first crash triggers a one-shot clean reload (clears caches +
  // unregisters the service worker). Used at the top level to recover from a
  // stale PWA version after a deploy. Leave off for per-route boundaries.
  recover?: boolean;
};
type State = { hasError: boolean; error: Error | null; recovering: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, recovering: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Neočekávaná chyba aplikace:", error, info.componentStack);
    // After a new deploy the old service worker can serve stale chunks, which
    // makes React throw on reconcile. Try a single clean reload to pick up the
    // fresh build; if it was already attempted this session, show the UI below.
    if (this.props.recover && recoverFromStaleVersion()) {
      this.setState({ recovering: true });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.assign(import.meta.env.BASE_URL);
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.recovering) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 p-6 text-center">
          <RefreshCw className="h-7 w-7 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Aktualizuji aplikaci na novou verzi…</p>
        </div>
      );
    }

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Něco se pokazilo</h1>
            <p className="text-sm text-muted-foreground">
              Tuto stránku se nepodařilo zobrazit. Zkuste akci zopakovat, obnovte aplikaci na nejnovější verzi, nebo se vraťte na úvodní obrazovku.
            </p>
          </div>
          {this.state.error?.message && (
            <pre className="text-left text-xs bg-muted rounded-md p-3 overflow-auto max-h-32 text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            <Button onClick={this.handleReset} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />Zkusit znovu
            </Button>
            <Button onClick={() => void clearCachesAndReload()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />Obnovit aplikaci
            </Button>
            <Button onClick={this.handleHome}>
              <Home className="h-4 w-4 mr-2" />Na úvod
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
