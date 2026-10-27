import { useState } from "react";
import { publicProfileSchema, userSchema, ledgerSchema, z, type User } from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { request, refresh, accepted, coins, dateTime, assetUrl } from "../lib/api.ts";
import {
  ActionForm,
  Field,
  PageTitle,
  Notice,
  TeamLink,
  ErrorBox,
  Loading,
} from "../components/ui.tsx";
const ledgerResponse = z.array(ledgerSchema),
  changed = z.object({ changed: z.boolean() });
export function PublicProfilePage({ username }: { username: string }) {
  const { data, error, loading, reload } = useResource(
    `/api/users/${encodeURIComponent(username)}`,
    publicProfileSchema,
  );
  return (
    <>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data && (
        <section className="panel">
          <PageTitle eyebrow={`@${data.username}`} title={data.displayName} />
          {data.avatarUrl && (
            <img
              className="avatar"
              src={assetUrl(data.avatarUrl)}
              alt={`${data.displayName} avatar`}
            />
          )}
          <h2>In the dugout</h2>
          {data.team ? (
            <TeamLink team={data.team} />
          ) : (
            <Notice>This manager has not claimed a club.</Notice>
          )}
        </section>
      )}
    </>
  );
}
export function ProfilePage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const ledger = useResource("/api/users/me/ledger", ledgerResponse),
    [notice, setNotice] = useState("");
  return (
    <>
      <PageTitle eyebrow="YOUR ACCOUNT" title={user.displayName}>
        @{user.username} · {coins(user.coinBalance)} virtual coins
      </PageTitle>
      {notice && <Notice>{notice}</Notice>}
      <div className="report-grid">
        <section className="panel">
          <h2>Manager identity</h2>
          <ActionForm
            onSubmit={async (form) => {
              await request("/api/users/me/profile", userSchema, {
                method: "PATCH",
                body: JSON.stringify({
                  username: form.get("username"),
                  displayName: form.get("displayName"),
                }),
              });
              refresh();
            }}
          >
            <Field
              name="username"
              label="Username"
              value={user.username}
              minLength={3}
              maxLength={30}
            />
            <Field
              name="displayName"
              label="Display name"
              value={user.displayName}
              maxLength={60}
            />
          </ActionForm>
          <p>
            {user.email} · {user.verified ? "Verified" : "Not verified"}
          </p>
          {!user.verified && (
            <ActionForm
              label="Resend verification"
              onSubmit={async () => {
                await request("/api/auth/resend-verification", accepted, { method: "POST" });
                setNotice("A new verification email has been requested.");
              }}
            >
              <span className="muted">Check your inbox for a verification link.</span>
            </ActionForm>
          )}
        </section>
        <section className="panel">
          <h2>Your avatar</h2>
          {user.avatarUrl && (
            <img className="avatar" src={assetUrl(user.avatarUrl)} alt="Your avatar" />
          )}
          <ActionForm
            label="Upload avatar"
            onSubmit={async (form) => {
              await request("/api/users/me/avatar", userSchema, { method: "POST", body: form });
              refresh();
            }}
          >
            <label>
              PNG, JPEG or WebP · up to 2 MB
              <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp" required />
            </label>
          </ActionForm>
          {user.avatarUrl && (
            <ActionForm
              label="Remove avatar"
              onSubmit={async () => {
                await request("/api/users/me/avatar", userSchema, { method: "DELETE" });
                refresh();
              }}
            >
              <span />
            </ActionForm>
          )}
        </section>
        <section className="panel">
          <h2>Change password</h2>
          <ActionForm
            onSubmit={async (form) => {
              await request("/api/users/me/password", changed, {
                method: "POST",
                body: JSON.stringify({
                  currentPassword: form.get("currentPassword"),
                  newPassword: form.get("newPassword"),
                }),
              });
              setNotice("Password changed. Your other sessions have been signed out.");
            }}
          >
            <Field name="currentPassword" type="password" label="Current password" />
            <Field
              name="newPassword"
              type="password"
              label="New password"
              minLength={12}
              maxLength={128}
            />
          </ActionForm>
        </section>
        <section className="panel">
          <h2>Deactivate account</h2>
          <p>Your club becomes available. Settled records and ledger history are retained.</p>
          <ActionForm
            label="Deactivate account"
            onSubmit={async (form) => {
              await request("/api/users/me/deactivate", z.null(), {
                method: "POST",
                body: JSON.stringify({ password: form.get("password") }),
              });
              onLogout();
            }}
          >
            <Field name="password" type="password" label="Confirm your password" />
          </ActionForm>
        </section>
      </div>
      <section className="panel">
        <h2>Wallet history</h2>
        <ErrorBox message={ledger.error} retry={ledger.reload} />
        <div className="table-wrap">
          <table>
            <caption>Your latest 100 wallet entries</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Change</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data?.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.createdAt)}</td>
                  <td>{e.type}</td>
                  <td>
                    {e.amount > 0 ? "+" : ""}
                    {coins(e.amount)}
                  </td>
                  <td>{coins(e.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
