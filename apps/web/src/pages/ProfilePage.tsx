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
import "./accounts.css";
const ledgerResponse = z.array(ledgerSchema),
  changed = z.object({ changed: z.boolean() });
const ledgerNames = {
  TOPUP: "Weekly coins",
  STAKE: "Bet placed",
  REFUND: "Bet refunded",
  PAYOUT: "Bet return",
};

function Avatar({
  name,
  url,
  revision = 0,
}: {
  name: string;
  url: string | null;
  revision?: number;
}) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? (
    <img
      className="avatar"
      src={`${assetUrl(url)}${revision ? `?v=${revision}` : ""}`}
      alt={`${name} avatar`}
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="avatar avatar-fallback" role="img" aria-label={`${name}, no avatar`}>
      {Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?"}
    </span>
  );
}

export function PublicProfilePage({ username }: { username: string }) {
  const { data, error, loading, reload } = useResource(
    `/api/users/${encodeURIComponent(username)}`,
    publicProfileSchema,
  );
  return (
    <div className="public-manager-page">
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data && (
        <>
          <div className="profile-identity">
            <Avatar key={data.avatarUrl} name={data.displayName} url={data.avatarUrl} />
            <PageTitle eyebrow={`@${data.username}`} title={data.displayName}>
              Manager profile
            </PageTitle>
          </div>
          <section className="public-manager-club">
            <h2>In the dugout</h2>
            {data.team ? (
              <>
                <TeamLink team={data.team} />
                <p className="muted">
                  {data.team.stadiumName} · {data.team.city}
                </p>
                <a className="button-link" href={`#/teams/${data.team.id}`}>
                  View club
                </a>
              </>
            ) : (
              <Notice>This manager has not claimed a club.</Notice>
            )}
          </section>
          <a href="#/leaderboard">Back to the leaderboard</a>
        </>
      )}
    </div>
  );
}

export function ProfilePage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const ledger = useResource("/api/users/me/ledger", ledgerResponse);
  const [view, setView] = useState<"wallet" | "settings">("wallet");
  const [avatarRevision, setAvatarRevision] = useState(0);
  return (
    <div className="account-page">
      <div className="profile-identity">
        <Avatar
          key={`${user.avatarUrl}:${avatarRevision}`}
          name={user.displayName}
          url={user.avatarUrl}
          revision={avatarRevision}
        />
        <PageTitle eyebrow={`@${user.username}`} title={user.displayName}>
          Your profile & wallet
        </PageTitle>
      </div>
      <div className="tabs" aria-label="Profile sections">
        <button aria-pressed={view === "wallet"} onClick={() => setView("wallet")}>
          Wallet
        </button>
        <button aria-pressed={view === "settings"} onClick={() => setView("settings")}>
          Account settings
        </button>
        <a href={`#/managers/${user.username}`}>Public profile</a>
      </div>
      {view === "wallet" ? (
        <section className="wallet-history" aria-labelledby="wallet-heading">
          <div className="section-heading">
            <div>
              <h2 id="wallet-heading">Wallet history</h2>
              <p className="muted">Every change, recorded in virtual coins.</p>
            </div>
            <div className="wallet-total">
              <strong>{coins(user.coinBalance)}</strong>
              <span>Confirmed balance</span>
            </div>
          </div>
          <ErrorBox message={ledger.error} retry={ledger.reload} />
          {ledger.loading && <Loading />}
          {ledger.data?.length === 0 && (
            <Notice>No wallet entries yet. Your coin history will appear here.</Notice>
          )}
          {ledger.data && ledger.data.length > 0 && (
            <div
              className="table-wrap"
              tabIndex={0}
              aria-label="Wallet history, scroll for all entries"
            >
              <table className="ledger-table">
                <caption>
                  Latest {ledger.data.length} wallet{" "}
                  {ledger.data.length === 1 ? "entry" : "entries"} · maximum 100
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Transaction</th>
                    <th scope="col">Change</th>
                    <th scope="col">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.map((entry) => (
                    <tr key={entry.id}>
                      <td>{dateTime(entry.createdAt)}</td>
                      <th scope="row">{ledgerNames[entry.type]}</th>
                      <td>
                        {entry.amount > 0 ? "+" : ""}
                        {coins(entry.amount)}
                      </td>
                      <td>{coins(entry.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="account-note">
            Virtual currency only. Coins cannot be deposited, bought or withdrawn.
          </p>
        </section>
      ) : (
        <div className="account-settings">
          <section className="account-section">
            <div>
              <h2>Manager identity</h2>
              <p>Your name and username appear on your club and public profile.</p>
              <p className="account-email">
                {user.email}
                <br />
                {user.verified ? "Email verified" : "Email not verified"}
              </p>
            </div>
            <div className="account-section-controls">
              <ActionForm
                successMessage="Your public manager identity has been updated."
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
              {!user.verified && (
                <ActionForm
                  label="Resend verification"
                  successMessage="A verification email has been requested. Check your inbox."
                  onSubmit={async () => {
                    await request("/api/auth/resend-verification", accepted, { method: "POST" });
                  }}
                >
                  <p className="muted">Verify your email address to keep your account ready.</p>
                </ActionForm>
              )}
            </div>
          </section>
          <section className="account-section">
            <div>
              <h2>Your avatar</h2>
              <p>A square crop appears on your public manager profile.</p>
              <Avatar
                key={`${user.avatarUrl}:${avatarRevision}:settings`}
                name={user.displayName}
                url={user.avatarUrl}
                revision={avatarRevision}
              />
            </div>
            <div className="account-section-controls">
              <ActionForm
                label="Upload avatar"
                successMessage="Your avatar has been updated."
                onSubmit={async (form) => {
                  await request("/api/users/me/avatar", userSchema, { method: "POST", body: form });
                  setAvatarRevision(Date.now());
                  refresh();
                }}
              >
                <label>
                  PNG, JPEG or WebP · up to 2 MB
                  <input
                    type="file"
                    name="avatar"
                    accept="image/png,image/jpeg,image/webp"
                    required
                  />
                </label>
              </ActionForm>
              {user.avatarUrl && (
                <ActionForm
                  label="Remove avatar"
                  successMessage="Your avatar has been removed."
                  onSubmit={async () => {
                    await request("/api/users/me/avatar", userSchema, { method: "DELETE" });
                    refresh();
                  }}
                >
                  <span className="muted">Your initial will appear in its place.</span>
                </ActionForm>
              )}
            </div>
          </section>
          <section className="account-section">
            <div>
              <h2>Change password</h2>
              <p>Use at least 12 characters. Your other sessions will be signed out.</p>
            </div>
            <div className="account-section-controls">
              <ActionForm
                label="Change password"
                successMessage="Password changed. Your other sessions have been signed out."
                onSubmit={async (form) => {
                  await request("/api/users/me/password", changed, {
                    method: "POST",
                    body: JSON.stringify({
                      currentPassword: form.get("currentPassword"),
                      newPassword: form.get("newPassword"),
                    }),
                  });
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
            </div>
          </section>
          <section className="account-section danger-section">
            <div>
              <h2>Deactivate account</h2>
              <p>Your club becomes available. Settled records and ledger history are retained.</p>
            </div>
            <div className="account-section-controls">
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
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
