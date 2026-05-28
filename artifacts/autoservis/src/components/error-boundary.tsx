import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Neočekávaná chyba aplikace:", error, info.componentStack);
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

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Něco se pokazilo</h1>
            <p className="text-sm text-muted-foreground">
              Tuto stránku se nepodařilo zobrazit. Zkuste akci zopakovat nebo se vraťte na úvodní obrazovku.
            </p>
          </div>
          {this.state.error?.message && (
            <pre className="text-left text-xs bg-muted rounded-md p-3 overflow-auto max-h-32 text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-2 justify-center pt-2">
            <Button onClick={this.handleReset} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />Zkusit znovu
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
