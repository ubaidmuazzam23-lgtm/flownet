// frontend/src/App.tsx
import { useState } from "react";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import Login from "./screens/Login";
import Alerts from "./screens/Alerts";
import Account from "./screens/Account";
import GraphView from "./screens/GraphView";
import Hierarchy from "./screens/Hierarchy";
import NodeExplorer from "./screens/NodeExplorer";
import CircularAlerts from "./screens/CircularAlerts";
import LayeringAlerts from "./screens/LayeringAlerts";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";

type Route = "dashboard" | "alerts" | "account" | "graph" | "hierarchy" | "explorer" | "circular-alerts" | "layering-alerts";

export default function App() {
  const [route, setRoute] = useState<Route>("alerts");

  function renderScreen() {
    switch (route) {
      case "alerts": return <Alerts />;
      case "account": return <Account />;
      case "graph": return <GraphView />;
      case "hierarchy": return <Hierarchy />;
      case "explorer": return <NodeExplorer />;
      case "circular-alerts": return <CircularAlerts />;
      case "layering-alerts": return <LayeringAlerts />;
      default:
        return (
          <div className="flex-1 grid place-items-center text-ash-400">
            <div className="text-center">
              <div className="font-display text-2xl text-ash-200">{route.toUpperCase()}</div>
              <div className="text-[12px] font-mono text-ash-500 mt-2">Screen arrives in a later slice</div>
            </div>
          </div>
        );
    }
  }

  return (
    <>
      <SignedOut><Login /></SignedOut>
      <SignedIn>
        <div className="flex h-screen w-screen overflow-hidden bg-ink-900 text-ash-100">
          <Sidebar active={route} onNav={(r) => setRoute(r as Route)} />
          <div className="flex-1 flex flex-col min-w-0">
            <TopBar screenLabel={route} />
            {renderScreen()}
          </div>
        </div>
      </SignedIn>
    </>
  );
}