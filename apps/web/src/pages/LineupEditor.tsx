import { useState } from "react";
import {
  FORMATION_TEMPLATES,
  FORMATIONS,
  calculateLineupRatings,
  type Formation,
} from "@ffb/football";
import type { TeamDetail } from "@ffb/contracts";
import { request, success, refresh } from "../lib/api.ts";
import { ErrorBox } from "../components/ui.tsx";
export function LineupEditor({ team }: { team: TeamDetail }) {
  const initial = team.draft ?? team.official;
  const [formation, setFormation] = useState<Formation>(initial.formation),
    [assignments, setAssignments] = useState(initial.assignments),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  function chooseFormation(value: Formation) {
    setFormation(value);
    const alternative = team.alternatives.find((a) => a.formation === value);
    setAssignments(
      alternative?.assignments ??
        FORMATION_TEMPLATES[value].map((s) => ({
          slotKey: s.key,
          playerId: team.official.assignments.find((a) => a.slotKey === s.key)?.playerId ?? "",
        })),
    );
    setSaved(false);
  }
  const select = (slotKey: string, playerId: string) => {
    setAssignments((previous) =>
      previous.map((a) => (a.slotKey === slotKey ? { slotKey, playerId } : a)),
    );
    setSaved(false);
  };
  async function save(publish: boolean) {
    setBusy(true);
    setError("");
    try {
      const squad = team.squad;
      calculateLineupRatings(
        formation,
        assignments.map((a) => {
          const player = squad.find((p) => p.id === a.playerId);
          if (!player) throw new Error("Fill every position before saving");
          return { slotKey: a.slotKey, player };
        }),
      );
      await request("/api/teams/me/draft", success, {
        method: "PUT",
        body: JSON.stringify({ formation, assignments }),
      });
      if (publish) await request("/api/teams/me/publish", success, { method: "POST" });
      setSaved(true);
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save lineup");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE DUGOUT</span>
          <h2>Build your starting XI</h2>
        </div>
        <label>
          Formation
          <select value={formation} onChange={(e) => chooseFormation(e.target.value as Formation)}>
            {FORMATIONS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">
        Drafts stay private. Publish before the one-hour deadline to set the official lineup and
        update future odds.
      </p>
      <div className="editor-grid">
        {FORMATION_TEMPLATES[formation].map((slot) => (
          <label key={slot.key}>
            <span>
              {slot.key} · {slot.position}
            </span>
            <select
              value={assignments.find((a) => a.slotKey === slot.key)?.playerId ?? ""}
              onChange={(e) => select(slot.key, e.target.value)}
            >
              <option value="">Choose player</option>
              {team.squad
                .filter((p) =>
                  slot.position === "GK" ? p.primaryPosition === "GK" : p.primaryPosition !== "GK",
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.shirtNumber} · {p.firstName} {p.lastName} · {p.primaryPosition} {p.overall}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <ErrorBox message={error} />
      {saved && (
        <p className="positive" role="status">
          Lineup saved.
        </p>
      )}
      <div className="button-row">
        <button disabled={busy} onClick={() => void save(false)}>
          Save draft
        </button>
        <button className="primary" disabled={busy} onClick={() => void save(true)}>
          Save & publish official XI
        </button>
      </div>
    </section>
  );
}
