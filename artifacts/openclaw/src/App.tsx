import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setApiKeyGetter } from "@workspace/api-client-react";

import { Shell } from "@/components/layout/Shell";
import Home from "@/pages/Home";
import Agents from "@/pages/Agents";
import AgentWorkspace from "@/pages/AgentWorkspace";
import VPS from "@/pages/VPS";
import Network from "@/pages/Network";
import Activity from "@/pages/Activity";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";

setApiKeyGetter(() => localStorage.getItem("openclaw_api_key"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/agents" component={Agents} />
        <Route path="/agents/:id" component={AgentWorkspace} />
        <Route path="/vps" component={VPS} />
        <Route path="/network" component={Network} />
        <Route path="/activity" component={Activity} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
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
