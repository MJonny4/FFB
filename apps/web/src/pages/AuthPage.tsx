import { useState } from "react";
import { userSchema, z } from "@ffb/contracts";
import type { User } from "@ffb/contracts";
import { request, accepted, refresh } from "../lib/api.ts";
import { ActionForm, Field, PageTitle, Notice } from "../components/ui.tsx";
const authResponse = z.object({ user: userSchema });
export function AuthPage({
  mode = "login",
  token,
  onUser,
}: {
  mode?: string;
  token?: string;
  onUser: (u: User) => void;
}) {
  const [view, setView] = useState(mode);
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
    <div className="auth-grid">
      <section className="auth-story">
        <span className="eyebrow">THE FICTIONAL FOOTBALL LEAGUE</span>
        <h1>
          Your club.
          <br />
          Your call.
        </h1>
        <p>
          Twenty clubs. A league that never stops. Build your starting XI, follow every match and
          put your football instincts to the test.
        </p>
        <div className="auth-stats">
          <div>
            <strong>20</strong>
            <span>original clubs</span>
          </div>
          <div>
            <strong>460</strong>
            <span>players</span>
          </div>
          <div>
            <strong>100%</strong>
            <span>virtual coins</span>
          </div>
        </div>
        <p className="muted">A simulation for the love of the game. No real money.</p>
      </section>
      <section className="panel">
        <PageTitle
          eyebrow="WELCOME TO FFB"
          title={
            view === "signup"
              ? "Join the league"
              : view === "forgot-password"
                ? "Reset your password"
                : view === "verify-email"
                  ? "Verify your email"
                  : view === "reset-password"
                    ? "Choose a new password"
                    : "Back in the game"
          }
        />
        {["login", "signup"].includes(view) && (
          <div className="tabs">
            <button aria-pressed={view === "login"} onClick={() => setView("login")}>
              Sign in
            </button>
            <button aria-pressed={view === "signup"} onClick={() => setView("signup")}>
              Create account
            </button>
          </div>
        )}
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
                  : "Continue"
          }
        >
          {view === "signup" && (
            <>
              <Field name="displayName" label="Display name" maxLength={60} />
              <Field name="username" label="Username" minLength={3} maxLength={30} />
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
          {view === "forgot-password" && (
            <Notice>If an account matches, a reset link will be sent.</Notice>
          )}
        </ActionForm>
        <button
          className="text-button"
          onClick={() => setView(view === "login" ? "forgot-password" : "login")}
        >
          {view === "login" ? "Forgot password?" : "Return to sign in"}
        </button>
      </section>
    </div>
  );
}
