// frontend/src/components/Sidebar.tsx
import { useClerk, useUser } from "@clerk/clerk-react";

type NavItem = { id: string; label: string; group: string; badge?: string };

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", group: "Intelligence" },
  { id: "graph",     label: "Graph View", group: "Intelligence", badge: "HOT" },
  { id: "hierarchy", label: "Hierarchy", group: "Intelligence", badge: "NEW" },
  { id: "explorer",  label: "Node Explorer", group: "Intelligence", badge: "NEW" },
  { id: "analytics", label: "Account Analytics", group: "Intelligence", badge: "NEW" },
  { id: "alerts",    label: "Alerts", group: "Investigations" },
  { id: "circular-alerts", label: "Circular (AML)", group: "Investigations", badge: "NEW" },
  { id: "layering-alerts", label: "Layering (TGN)", group: "Investigations", badge: "NEW" },
  { id: "account",   label: "Accounts", group: "Investigations" },
];

export function Sidebar({
  active,
  onNav,
}: {
  active: string;
  onNav: (id: string) => void;
}) {
  const { signOut } = useClerk();
  const { user } = useUser();

  const groups = [...new Set(NAV.map((n) => n.group))];
  const initials =
    (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "") || "FN";

  return (
    <aside className="w-[244px] shrink-0 h-full border-r border-line bg-ink-900 flex flex-col">
      {/* Brand */}
      <div className="h-14 px-4 flex items-center gap-2.5 border-b border-line">
        <div className="relative">
          <BrandMark />
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-flame-500 glow-flame" />
        </div>
        <div className="leading-tight">
          <div className="font-display font-semibold text-[15px] tracking-tight">
            FlowNet <span className="text-flame-500">AI</span>
          </div>
          <div className="text-[10px] text-ash-400 font-mono tracking-wider">
            FINANCIAL CRIME INTEL
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-auto px-2 pt-4 pb-4 no-scrollbar">
        {groups.map((g) => (
          <div key={g} className="mb-4">
            <div className="px-3 pb-1.5 text-[10px] uppercase tracking-[0.18em] text-ash-500 font-mono">
              {g}
            </div>
            {NAV.filter((n) => n.group === g).map((n) => {
              const isActive = active === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => onNav(n.id)}
                  className={`group w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors mb-0.5 ${
                    isActive
                      ? "bg-flame-500/10 text-ash-100"
                      : "text-ash-300 hover:bg-ink-800 hover:text-ash-100"
                  }`}
                >
                  <span
                    className={`relative w-1.5 h-1.5 rounded-full ${
                      isActive ? "bg-flame-500" : "bg-ash-500"
                    }`}
                  />
                  <span className="flex-1 text-left">{n.label}</span>
                  {n.badge && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-flame-500/15 text-flame-400">
                      {n.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5">
          <div className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-flame-500 to-orchid-500 grid place-items-center font-display font-semibold text-white text-[13px]">
            {initials.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-[12.5px] font-medium truncate">
              {user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Investigator"}
            </div>
            <div className="text-[10px] text-ash-400 font-mono tracking-wider">
              INVESTIGATOR
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="text-ash-400 hover:text-ash-100 p-1 text-[10px] font-mono"
            title="Sign out"
          >
            EXIT
          </button>
        </div>
      </div>
    </aside>
  );
}

function BrandMark() {
  return (
    <svg width={26} height={26} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="flownet-sb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB28A" />
          <stop offset="0.6" stopColor="#FF6D29" />
          <stop offset="1" stopColor="#B23F08" />
        </linearGradient>
      </defs>
      <path d="M16 2 L28 7 V16 C28 23 22 28 16 30 C10 28 4 23 4 16 V7 Z"
        fill="url(#flownet-sb)" opacity="0.18" stroke="url(#flownet-sb)" strokeWidth="1.5" />
      <path d="M16 9 L22 12 V17 C22 20.5 19 23 16 24 C13 23 10 20.5 10 17 V12 Z"
        fill="none" stroke="url(#flownet-sb)" strokeWidth="1.5" />
      <circle cx="16" cy="15" r="1.6" fill="#FF6D29" />
    </svg>
  );
}