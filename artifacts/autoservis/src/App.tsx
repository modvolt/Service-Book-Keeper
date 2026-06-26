import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGetAuthStatus, getGetAuthStatusQueryKey } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { Spinner } from "@/components/ui/spinner";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import VehiclesList from "@/pages/vehicles/index";
import VehicleDetail from "@/pages/vehicles/detail";
import VehicleNew from "@/pages/vehicles/new";
import WorkOrdersList from "@/pages/work-orders/index";
import WorkOrderNew from "@/pages/work-orders/new";
import WorkOrderDetail from "@/pages/work-orders/detail";
import MaterialsPage from "@/pages/materials/index";
import CalendarPage from "@/pages/calendar";
import SettingsPage from "@/pages/settings";
import TpScanPage from "@/pages/tp-scan";
import AlertsPage from "@/pages/alerts";
import StatisticsPage from "@/pages/statistics";
import GdprPage from "@/pages/gdpr";
import TrashPage from "@/pages/trash";
import AuditLogPage from "@/pages/audit-log";
import FleetPage from "@/pages/fleet";
import SkenMaterialuPage from "@/pages/sken-materialu/index";
import QrStitkyPage from "@/pages/sken-materialu/qr-stitky";
import ScannerProfilPage from "@/pages/scanner-profil";
import { useScanHandoff } from "@/hooks/use-scan-handoff";

const queryClient = new QueryClient();

const SCANNER_ALLOWED_PREFIXES = ["/sken-materialu", "/nacteni-vozu", "/nacteni-tp", "/scanner-profil"];

function Router() {
  const [location] = useLocation();
  const { data: authStatus } = useGetAuthStatus({
    query: { queryKey: getGetAuthStatusQueryKey(), staleTime: 60_000 } as any,
  });
  const isScanner = authStatus?.role === "scanner";

  // Live phone -> PC scan handoff: this session listens for scan results.
  useScanHandoff();

  // Scanner role: redirect any disallowed route to /sken-materialu
  if (isScanner && !SCANNER_ALLOWED_PREFIXES.some((prefix) => location === prefix || location.startsWith(prefix + "/"))) {
    return <Redirect to="/sken-materialu" />;
  }

  return (
    <Layout>
      <ErrorBoundary key={location}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/vehicles" component={VehiclesList} />
        <Route path="/vozovy-park" component={FleetPage} />
        <Route path="/vehicles/new" component={VehicleNew} />
        <Route path="/vehicles/:id" component={VehicleDetail} />
        <Route path="/work-orders" component={WorkOrdersList} />
        <Route path="/work-orders/new" component={WorkOrderNew} />
        <Route path="/work-orders/:id" component={WorkOrderDetail} />
        <Route path="/sklad" component={MaterialsPage} />
        <Route path="/kalendar" component={CalendarPage} />
        <Route path="/nastaveni" component={SettingsPage} />
        <Route path="/nacteni-vozu" component={TpScanPage} />
        {/* Alias for old bookmarks/links */}
        <Route path="/nacteni-tp" component={TpScanPage} />
        <Route path="/po-terminu" component={AlertsPage} />
        <Route path="/statistiky" component={StatisticsPage} />
        <Route path="/gdpr" component={GdprPage} />
        <Route path="/kos" component={TrashPage} />
        <Route path="/audit-log" component={AuditLogPage} />
        <Route path="/sken-materialu" component={SkenMaterialuPage} />
        <Route path="/sken-materialu/qr-stitky" component={QrStitkyPage} />
        <Route path="/scanner-profil" component={ScannerProfilPage} />
        <Route component={NotFound} />
      </Switch>
      </ErrorBoundary>
    </Layout>
  );
}

function AuthGate() {
  const [location] = useLocation();
  const { data, isLoading, isError } = useGetAuthStatus({
    query: { queryKey: getGetAuthStatusQueryKey(), retry: false, staleTime: 60_000 },
  });

  // Password reset is reachable via an emailed link without an active session.
  if (location === "/reset-hesla") {
    return <ResetPasswordPage />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (isError || !data?.authenticated) {
    return <LoginPage />;
  }

  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary recover>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthGate />
          </WouterRouter>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
