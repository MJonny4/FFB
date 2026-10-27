import { useEffect, useState } from "react";
import { userSchema, z, type User } from "@ffb/contracts";
import { request, coins, refresh } from "./lib/api.ts";
import { useLive } from "./hooks/useLive.ts";
import { AuthPage } from "./pages/AuthPage.tsx";
import { MatchesPage } from "./pages/MatchesPage.tsx";
import { BetsPage } from "./pages/BetsPage.tsx";
import { StandingsPage, LeaderboardPage } from "./pages/TablesPage.tsx";
import { TeamsPage, TeamPage } from "./pages/TeamsPage.tsx";
import { MatchPage } from "./pages/MatchPage.tsx";
import { ProfilePage, PublicProfilePage } from "./pages/ProfilePage.tsx";
import { Notice } from "./components/ui.tsx";
const navigation = [
  ["matches", "Fixtures", "◉"],
  ["bets", "My bets", "◇"],
  ["standings", "League table", "▤"],
  ["leaderboard", "Leaderboard", "↗"],
  ["teams", "The clubs", "⚑"],
  ["my-team", "My club", "♜"],
] as const;
function route() {
  return (window.location.hash.slice(1) || "/matches").split("?")[0]!.split("/").filter(Boolean);
}
export default function App() {
  const [path, setPath] = useState(route),
    [user, setUser] = useState<User | null>(null),
    [restored, setRestored] = useState(false),
    [authError, setAuthError] = useState("");
  useEffect(() => {
    const change = () => setPath(route());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    let active = true;
    const load = () => {
      void request("/api/auth/session", userSchema.nullable())
        .then((u) => {
          if (active) {
            setUser(u);
            setAuthError("");
          }
        })
        .catch((error) => {
          if (active && error instanceof Error && error.message === "Please sign in") setUser(null);
          else if (active)
            setAuthError("Account service unavailable. Your last confirmed state remains visible.");
        })
        .finally(() => {
          if (active) setRestored(true);
        });
    };
    load();
    window.addEventListener("ffb:refresh", load);
    return () => {
      active = false;
      window.removeEventListener("ffb:refresh", load);
    };
  }, []);
  const page = path[0] ?? "matches",
    id = path[1],
    connected = useLive(user?.id, page === "matches" ? id : undefined);
  async function logout() {
    try {
      await request("/api/auth/logout", z.null(), { method: "POST" });
      setUser(null);
      refresh();
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
        onUser={setUser}
      />
    );
  else if (page === "matches")
    content = id ? <MatchPage key={id} id={id} /> : <MatchesPage user={user} />;
  else if (page === "standings") content = <StandingsPage />;
  else if (page === "leaderboard") content = <LeaderboardPage />;
  else if (page === "teams")
    content = id ? <TeamPage key={id} id={id} user={user} /> : <TeamsPage />;
  else if (page === "managers" && id) content = <PublicProfilePage username={id} />;
  else if (!restored) content = <Notice>Restoring your session…</Notice>;
  else if (!user) content = <AuthPage onUser={setUser} />;
  else if (page === "bets") content = <BetsPage />;
  else if (page === "profile")
    content = <ProfilePage key={user.id} user={user} onLogout={() => setUser(null)} />;
  else if (page === "my-team")
    content = user.teamId ? (
      <TeamPage id={user.teamId} user={user} />
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
      <aside className="sidebar">
        <a className="brand" href="#/matches">
          <span className="brand-mark">F</span>
          <span>
            FFB<span className="brand-sub">FOOTBALL. YOUR CALL.</span>
          </span>
        </a>
        <div className="league-label">
          THE LEAGUE <span>2026</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(([href, label, icon]) => (
            <a
              href={`#/${href}`}
              key={href}
              className={page === href ? "active" : ""}
              aria-current={page === href ? "page" : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="badge">SIMULATED FOOTBALL</span>
          <p>
            Real instincts.
            <br />
            Virtual stakes.
          </p>
          <small>No real money. Just the game.</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className={`connection ${connected ? "online" : ""}`}>
            {connected ? "Live connection" : "HTTP snapshots"}
          </span>
          <span className="topbar-season">FICTIONAL FOOTBALL LEAGUE</span>
          <div className="account">
            {user ? (
              <>
                <a className="wallet" href="#/profile">
                  ◈ {coins(user.coinBalance)} <small>coins</small>
                </a>
                <a href="#/profile">{user.displayName}</a>
                <button onClick={() => void logout()}>Sign out</button>
              </>
            ) : (
              <a className="primary button-link" href="#/login">
                Join the league
              </a>
            )}
          </div>
        </header>
        <main id="main-content">
          {authError && <Notice>{authError}</Notice>}
          {content}
        </main>
        <footer>
          FFB · Fictional clubs. Virtual currency. Football that keeps moving.{" "}
          <span>All times Europe/Madrid</span>
        </footer>
      </div>
    </div>
  );
}
