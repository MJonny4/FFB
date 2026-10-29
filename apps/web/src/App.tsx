import { useEffect, useRef, useState } from "react";
import { userSchema, z, type User } from "@ffb/contracts";
import { request, refresh } from "./lib/api.ts";
import { useLive } from "./hooks/useLive.ts";
import { AuthPage } from "./pages/AuthPage.tsx";
import { MatchesPage } from "./pages/MatchesPage.tsx";
import { BetsPage } from "./pages/BetsPage.tsx";
import { StandingsPage, LeaderboardPage } from "./pages/TablesPage.tsx";
import { TeamsPage, TeamPage } from "./pages/TeamsPage.tsx";
import { MatchPage } from "./pages/MatchPage.tsx";
import { ProfilePage, PublicProfilePage } from "./pages/ProfilePage.tsx";
import {
  CalendarDays,
  Ticket,
  ListOrdered,
  Trophy,
  Shield,
  ClipboardList,
  Menu,
  X,
  LogOut,
  UserRound,
} from "lucide-react";
import { Wallet } from "./components/Wallet.tsx";
import { Notice } from "./components/ui.tsx";
const navigation = [
  ["matches", "Fixtures", CalendarDays],
  ["standings", "League table", ListOrdered],
  ["teams", "The clubs", Shield],
  ["leaderboard", "Manager rankings", Trophy],
  ["bets", "My bets", Ticket],
  ["my-team", "Manager Room", ClipboardList],
] as const;
function route() {
  return (window.location.hash.slice(1) || "/matches").split("?")[0]!.split("/").filter(Boolean);
}
export default function App() {
  const [path, setPath] = useState(route),
    [user, setUser] = useState<User | null>(null),
    [restored, setRestored] = useState(false),
    [authError, setAuthError] = useState(""),
    [menuOpen, setMenuOpen] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const sessionRevision = useRef(0);
  useEffect(() => {
    const status = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) refresh();
    };
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    return () => {
      window.removeEventListener("online", status);
      window.removeEventListener("offline", status);
    };
  }, []);
  useEffect(() => {
    const change = () => {
      setPath(route());
      setMenuOpen(false);
      requestAnimationFrame(() => document.getElementById("main-content")?.focus());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    let active = true;
    const load = () => {
      const revision = ++sessionRevision.current;
      void request("/api/auth/session", userSchema.nullable())
        .then((u) => {
          if (active && revision === sessionRevision.current) {
            setUser(u);
            setAuthError("");
          }
        })
        .catch((error) => {
          if (!active || revision !== sessionRevision.current) return;
          if (error instanceof Error && error.message === "Please sign in") setUser(null);
          else if (active)
            setAuthError("Account service unavailable. Your last confirmed state remains visible.");
        })
        .finally(() => {
          if (active) setRestored(true);
        });
    };
    const accepted = (event: Event) => {
      const receipt = (event as CustomEvent<{ userId: string; coinBalance: number }>).detail;
      sessionRevision.current++;
      setUser((previous) =>
        previous?.id === receipt.userId
          ? { ...previous, coinBalance: receipt.coinBalance }
          : previous,
      );
    };
    load();
    window.addEventListener("ffb:bet-accepted", accepted);
    window.addEventListener("ffb:refresh", load);
    return () => {
      active = false;
      window.removeEventListener("ffb:refresh", load);
      window.removeEventListener("ffb:bet-accepted", accepted);
    };
  }, []);
  const page = path[0] ?? "matches",
    id = path[1],
    connected = useLive(user?.id, page === "matches" ? id : undefined);
  function acceptUser(next: User | null) {
    sessionRevision.current++;
    setUser(next);
    setAuthError("");
  }
  async function logout() {
    try {
      await request("/api/auth/logout", z.null(), { method: "POST" });
      acceptUser(null);
    } catch {
      setAuthError("Sign-out failed. Please try again.");
    }
  }
  const auth = ["login", "signup", "forgot-password", "verify-email", "reset-password"].includes(
    page,
  );
  let content;
  if (auth)
    content = (
      <AuthPage
        key={page}
        mode={page}
        token={new URLSearchParams(window.location.hash.split("?")[1]).get("token") ?? undefined}
        onUser={acceptUser}
      />
    );
  else if (page === "matches")
    content = id ? (
      <MatchPage key={id} id={id} />
    ) : (
      <MatchesPage key={user?.id ?? "visitor"} user={user} />
    );
  else if (page === "standings") content = <StandingsPage user={user} />;
  else if (page === "leaderboard") content = <LeaderboardPage />;
  else if (page === "teams")
    content = id ? <TeamPage key={`public:${id}`} id={id} user={user} /> : <TeamsPage />;
  else if (page === "managers" && id) content = <PublicProfilePage username={id} />;
  else if (!restored) content = <Notice>Restoring your session…</Notice>;
  else if (!user) content = <AuthPage onUser={acceptUser} />;
  else if (page === "bets") content = <BetsPage key={user.id} />;
  else if (page === "profile")
    content = <ProfilePage key={user.id} user={user} onLogout={() => acceptUser(null)} />;
  else if (page === "my-team")
    content = user.teamId ? (
      <TeamPage key={`manager:${user.teamId}`} id={user.teamId} user={user} manager />
    ) : (
      <>
        <Notice>Choose an available club to take your place on the touchline.</Notice>
        <TeamsPage />
      </>
    );
  else
    content = (
      <Notice>
        Page not found. <a href="#/matches">Return to fixtures</a>.
      </Notice>
    );
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className={`sidebar ${menuOpen ? "menu-open" : ""}`}>
        <a className="brand" href="#/matches" aria-label="FFB · The Touchline, fixtures">
          <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
            <path
              d="M5 34V6h30M5 20h22M18 34V20M27 6v14"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
            />
          </svg>
          <span>
            FFB<span className="brand-sub">The Touchline</span>
          </span>
        </a>
        <button
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
        <p className="league-label">Fictional football league</p>
        <nav
          id="main-navigation"
          aria-label="Main navigation"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setMenuOpen(false);
              document.querySelector<HTMLButtonElement>(".menu-toggle")?.focus();
            }
          }}
        >
          {navigation.map(([href, label, Icon]) => (
            <a
              href={`#/${href}`}
              key={href}
              className={page === href ? "active" : ""}
              aria-current={page === href ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
              {label}
            </a>
          ))}
          {user && (
            <a href="#/profile" aria-current={page === "profile" ? "page" : undefined}>
              <UserRound size={18} aria-hidden="true" />
              Profile & wallet
            </a>
          )}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Football.
            <br />
            Your call.
          </p>
          <small>
            Original clubs. Virtual stakes.
            <br />
            No real money.
          </small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="scope-label">
            <span>{page === "my-team" ? "Manager Room" : "Public Matchday"}</span>
            <small className={`connection ${connected ? "online" : ""}`}>
              {!online ? "Offline" : connected ? "Live updates" : "Matchday updates"}
            </small>
          </div>
          <div className="account">
            {user ? (
              <>
                <Wallet key={user.id} balance={user.coinBalance} />
                <a className="account-name" href="#/profile">
                  {user.displayName}
                </a>
                <button className="icon-button" onClick={() => void logout()} aria-label="Sign out">
                  <LogOut size={18} aria-hidden="true" />
                </button>
              </>
            ) : (
              <a className="primary button-link" href="#/login">
                Join the league
              </a>
            )}
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {!online && (
            <Notice>
              You’re offline. Last confirmed data stays visible. We’ll reconnect when you’re back
              online.
            </Notice>
          )}
          {authError && <Notice>{authError}</Notice>}
          {content}
        </main>
        <footer>
          <span>FFB · The Touchline. Fictional football, real decisions.</span>
          <span>Virtual coins only · Europe/Madrid</span>
        </footer>
      </div>
    </div>
  );
}
