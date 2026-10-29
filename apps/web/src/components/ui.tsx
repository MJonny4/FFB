import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Team } from "@ffb/contracts";
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice" role="status">
      {children}
    </p>
  );
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return message ? (
    <div className="error" role="alert">
      {message} {retry && <button onClick={retry}>Retry</button>}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <p role="status" className="muted">
      Loading the league…
    </p>
  );
}
export function Crest({ team }: { team: Pick<Team, "name" | "crestImageUrl"> }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === team.crestImageUrl || !team.crestImageUrl)
    return (
      <span
        className="crest crest-fallback"
        role="img"
        aria-label={`${team.name} crest unavailable`}
      >
        {team.name.slice(0, 2)}
      </span>
    );
  return (
    <img
      onError={() => setFailedUrl(team.crestImageUrl)}
      className="crest"
      src={team.crestImageUrl}
      alt={`${team.name} crest`}
      width="44"
      height="44"
    />
  );
}
export function TeamLink({ team }: { team: Team }) {
  return (
    <a className="team-link" href={`#/teams/${team.id}`}>
      <Crest team={team} />
      <span>{team.name}</span>
    </a>
  );
}
export function PageTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-title">
      <h1>{title}</h1>
      <span className="page-meta">{eyebrow}</span>
      {children && <p>{children}</p>}
    </header>
  );
}
export function ActionForm({
  onSubmit,
  children,
  label = "Save",
  className = "",
  successMessage = "Saved successfully.",
}: {
  onSubmit: (form: FormData) => Promise<void>;
  children: ReactNode;
  label?: string;
  className?: string;
  successMessage?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setDone(false);
    try {
      await onSubmit(form);
      setDone(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to complete request");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form className={`form ${className}`} onSubmit={submit}>
      {children}
      <ErrorBox message={error} />
      {done && (
        <span role="status" className="positive">
          {successMessage}
        </span>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Working…" : label}
      </button>
    </form>
  );
}
export function Field({
  label,
  name,
  type = "text",
  value,
  minLength,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={
          type === "password"
            ? name === "newPassword" || (minLength ?? 0) >= 12
              ? "new-password"
              : "current-password"
            : name
        }
      />
    </label>
  );
}
