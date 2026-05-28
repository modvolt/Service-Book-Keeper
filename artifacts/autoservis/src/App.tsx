import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
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

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/vehicles" component={VehiclesList} />
        <Route path="/vehicles/new" component={VehicleNew} />
        <Route path="/vehicles/:id" component={VehicleDetail} />
        <Route path="/work-orders" component={WorkOrdersList} />
        <Route path="/work-orders/new" component={WorkOrderNew} />
        <Route path="/work-orders/:id" component={WorkOrderDetail} />
        <Route path="/sklad" component={MaterialsPage} />
        <Route path="/kalendar" component={CalendarPage} />
        <Route path="/nastaveni" component={SettingsPage} />
        <Route path="/nacteni-tp" component={TpScanPage} />
        <Route path="/po-terminu" component={AlertsPage} />
        <Route path="/statistiky" component={StatisticsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
