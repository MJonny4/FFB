import { useState } from "react";
import { teamSchema, userSchema, z, type User } from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { request, accepted, refresh } from "../lib/api.ts";
import { ActionForm, Field, PageTitle, Notice, Crest } from "../components/ui.tsx";
import "./accounts.css";
const authResponse = z.object({ user: userSchema }),
  teamsResponse = z.array(teamSchema);
export function AuthPage({
  mode = "login",
  token,
  onUser,
}: {
  mode?: string;
  token?: string;
  onUser: (user: User) => void;
}) {
  const [view, setView] = useState(mode);
  const teams = useResource("/api/teams", teamsResponse);
  const requiresToken = view === "verify-email" || view === "reset-password";
  async function submit(form: FormData) {
    const email = String(form.get("email") ?? ""),
      password = String(form.get("password") ?? "");
    if (view === "forgot-password") {
      await request("/api/auth/forgot-password", accepted, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      return;
    }
    if (view === "verify-email") {
      await request("/api/auth/verify-email", z.object({ verified: z.boolean() }), {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      refresh();
      return;
    }
    const payload =
      view === "signup"
        ? {
            email,
            password,
            username: String(form.get("username")),
            displayName: String(form.get("displayName")),
          }
        : view === "reset-password"
          ? { token, password }
          : { email, password };
    const response = await request(`/api/auth/${view}`, authResponse, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    onUser(response.user);
    window.location.hash = "/matches";
  }
  return (
    <div className="auth-layout">
      <section className="auth-form-surface">
        <PageTitle
          eyebrow="FFB · The Touchline"
          title={
            view === "signup"
              ? "Join the league"
              : view === "forgot-password"
                ? "Reset your password"
                : view === "verify-email"
                  ? "Verify your email"
                  : view === "reset-password"
                    ? "Choose a new password"
                    : "Sign in"
          }
        >
          {view === "signup"
            ? "Create your manager identity. All stakes are virtual coins."
            : view === "login"
              ? "Your club, starting XI and wallet are waiting."
              : view === "forgot-password"
                ? "Enter your account email to request a reset link."
                : view === "verify-email"
                  ? "Confirm your email to complete your account."
                  : "Use at least 12 characters for your new password."}
        </PageTitle>
        {["login", "signup"].includes(view) && (
          <div className="tabs" aria-label="Account access">
            <button aria-pressed={view === "login"} onClick={() => setView("login")}>
              Sign in
            </button>
            <button aria-pressed={view === "signup"} onClick={() => setView("signup")}>
              Create account
            </button>
          </div>
        )}
        {requiresToken && !token ? (
          <Notice>
            This link is incomplete.{" "}
            {view === "reset-password" ? (
              <a href="#/forgot-password">Request a new reset link</a>
            ) : (
              <a href="#/profile">Sign in and request a verification email</a>
            )}
            .
          </Notice>
        ) : (
          <ActionForm
            key={view}
            onSubmit={submit}
            label={
              view === "verify-email"
                ? "Verify email"
                : view === "forgot-password"
                  ? "Send reset link"
                  : view === "signup"
                    ? "Create account"
                    : view === "reset-password"
                      ? "Save new password"
                      : "Sign in"
            }
            successMessage={
              view === "forgot-password"
                ? "If that email matches an account, a password reset link has been sent. Check your inbox."
                : view === "verify-email"
                  ? "Your email is verified. Return to fixtures to follow the league."
                  : "Signed in successfully."
            }
          >
            {view === "signup" && (
              <>
                <Field name="displayName" label="Display name" maxLength={60} />
                <label>
                  Username
                  <input
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    minLength={3}
                    maxLength={30}
                    pattern="[a-z][a-z0-9_]{2,29}"
                    aria-describedby="username-hint"
                    required
                  />
                  <small id="username-hint">
                    3–30 lowercase letters, numbers or underscores. Start with a letter.
                  </small>
                </label>
              </>
            )}
            {!["verify-email", "reset-password"].includes(view) && (
              <Field name="email" label="Email" type="email" />
            )}
            {!["verify-email", "forgot-password"].includes(view) && (
              <Field
                name="password"
                label={view === "login" ? "Password" : "Password · at least 12 characters"}
                type="password"
                minLength={view === "login" ? 1 : 12}
                maxLength={128}
              />
            )}
            {view === "verify-email" && (
              <p className="muted">Verify the address used when you joined FFB.</p>
            )}
          </ActionForm>
        )}
        <div className="auth-secondary">
          <button
            className="text-button"
            onClick={() => setView(view === "login" ? "forgot-password" : "login")}
          >
            {view === "login" ? "Forgot password?" : "Return to sign in"}
          </button>
          <a href="#/matches">Browse fixtures</a>
        </div>
      </section>
      <aside className="auth-league" aria-labelledby="auth-league-heading">
        <h2 id="auth-league-heading">A league of your own</h2>
        <p>
          Twenty original clubs. Choose yours, publish a starting XI and follow the match from the
          touchline.
        </p>
        {teams.data && (
          <div className="auth-clubs">
            {teams.data.slice(0, 6).map((team) => (
              <a href={`#/teams/${team.id}`} key={team.id}>
                <Crest team={team} />
                <span>{team.shortName}</span>
              </a>
            ))}
          </div>
        )}
        <p className="muted">
          Bet virtual coins on other clubs. Every accepted stake and return stays in your wallet
          history.
        </p>
        <a className="button-link" href="#/teams">
          Meet the clubs
        </a>
      </aside>
    </div>
  );
}
