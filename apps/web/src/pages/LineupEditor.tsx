import { useRef, useState } from "react";
import {
  FORMATION_TEMPLATES,
  FORMATION_PITCH_ROWS,
  FORMATIONS,
  type Formation,
} from "@ffb/football";
import type { LineupInput, TeamDetail } from "@ffb/contracts";
import { request, success, refresh } from "../lib/api.ts";
import { inspectLineup } from "../lib/lineup.ts";
import { ErrorBox } from "../components/ui.tsx";

export function LineupPitch({
  team,
  lineup,
  editable = false,
}: {
  team: TeamDetail;
  lineup: LineupInput;
  editable?: boolean;
}) {
  return (
    <div
      className="lineup-pitch"
      aria-label={`${lineup.formation} ${editable ? "draft" : "published"} formation`}
    >
      <div className="lineup-pitch-markings" aria-hidden="true">
        <span />
      </div>
      {FORMATION_PITCH_ROWS[lineup.formation].map((row, index) => (
        <div className="lineup-pitch-row" key={index}>
          {row.map((slotKey) => {
            const assignment = lineup.assignments.find((entry) => entry.slotKey === slotKey);
            const player = team.squad.find((entry) => entry.id === assignment?.playerId);
            const label = (
              <>
                <span className="shirt-number">{player?.shirtNumber ?? "—"}</span>
                <span className="pitch-player-name">{player?.lastName ?? "Select player"}</span>
                <small>{slotKey}</small>
              </>
            );
            const name = player ? `${player.firstName} ${player.lastName}` : "No player selected";
            return editable ? (
              <button
                className="pitch-player"
                key={slotKey}
                type="button"
                title={`${slotKey}: ${name}`}
                aria-label={`Edit ${slotKey}: ${name}`}
                onClick={() => document.getElementById(`slot-${team.id}-${slotKey}`)?.focus()}
              >
                {label}
              </button>
            ) : (
              <div className="pitch-player" key={slotKey} title={`${slotKey}: ${name}`}>
                {label}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function LineupEditor({ team, locked = false }: { team: TeamDetail; locked?: boolean }) {
  const initial = team.draft ?? team.official;
  const [formation, setFormation] = useState<Formation>(initial.formation),
    [assignments, setAssignments] = useState(initial.assignments),
    [savedLineup, setSavedLineup] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const submitting = useRef(false);
  const lineup = { formation, assignments };
  const preparation = inspectLineup(team.squad, lineup);
  const official = inspectLineup(team.squad, team.official);
  const dirty = JSON.stringify(lineup) !== JSON.stringify(savedLineup);
  const matchesPublished = JSON.stringify(lineup) === JSON.stringify(team.official);
  function chooseFormation(value: Formation) {
    setFormation(value);
    const alternative = team.alternatives.find((entry) => entry.formation === value);
    setAssignments(
      alternative?.assignments ??
        FORMATION_TEMPLATES[value].map((slot) => ({
          slotKey: slot.key,
          playerId: assignments.find((entry) => entry.slotKey === slot.key)?.playerId ?? "",
        })),
    );
    setMessage("");
  }
  function select(slotKey: string, playerId: string) {
    setAssignments((previous) =>
      previous.map((entry) => (entry.slotKey === slotKey ? { slotKey, playerId } : entry)),
    );
    setMessage("");
  }
  async function save(publish: boolean) {
    if (submitting.current || (publish && locked)) return;
    if (preparation.error) {
      setError(preparation.error);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("/api/teams/me/draft", success, {
        method: "PUT",
        body: JSON.stringify(lineup),
      });
      setSavedLineup(lineup);
      if (publish) {
        try {
          await request("/api/teams/me/publish", success, { method: "POST" });
        } catch (failure) {
          setMessage("Draft saved privately. Your published XI is unchanged.");
          throw failure;
        }
      }
      setMessage(
        publish
          ? "Starting XI published. Future match odds have been updated."
          : "Draft saved privately. Your published XI is unchanged.",
      );
      refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to save lineup. Please try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="manager-editor" aria-labelledby="lineup-editor-heading">
      <div className="section-heading">
        <div>
          <h2 id="lineup-editor-heading">Build your starting XI</h2>
          <p className="muted">
            {dirty
              ? "Unsaved changes"
              : matchesPublished
                ? "Your draft matches the published XI"
                : "Private draft · not yet published"}
          </p>
        </div>
        <label>
          Formation
          <select
            value={formation}
            disabled={busy}
            onChange={(event) => chooseFormation(event.target.value as Formation)}
          >
            {FORMATIONS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="manager-workspace">
        <div className="tactics-preview">
          <LineupPitch team={team} lineup={lineup} editable />
          <div className="preparation-summary">
            <h3>Draft readiness</h3>
            {preparation.ratings ? (
              <>
                <p>
                  <strong>{preparation.ratings.overall.toFixed(1)}</strong> overall ·{" "}
                  {official.ratings
                    ? `${preparation.ratings.overall - official.ratings.overall >= 0 ? "+" : ""}${(preparation.ratings.overall - official.ratings.overall).toFixed(1)} vs published XI`
                    : "11 positions filled"}
                </p>
                <dl className="unit-ratings">
                  {(
                    [
                      ["Attack", "attack"],
                      ["Midfield", "midfield"],
                      ["Defense", "defense"],
                      ["Goalkeeper", "goalkeeper"],
                    ] as const
                  ).map(([label, key]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{preparation.ratings![key].toFixed(1)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="muted">
                  {
                    preparation.ratings.assignments.filter((entry) => entry.positionPenalty > 0)
                      .length
                  }{" "}
                  players outside their natural positions. Ratings include position penalties.
                </p>
              </>
            ) : (
              <p role="status">{preparation.error}</p>
            )}
          </div>
        </div>
        <div className="selection-list">
          <div className="selection-heading">
            <h3>Starting positions</h3>
            <span className="muted">Shirt · player · rating</span>
          </div>
          {FORMATION_TEMPLATES[formation].map((slot) => {
            const selected =
              assignments.find((entry) => entry.slotKey === slot.key)?.playerId ?? "";
            return (
              <label className="selection-row" key={slot.key}>
                <span>
                  {slot.key}
                  <small>{slot.position}</small>
                </span>
                <select
                  id={`slot-${team.id}-${slot.key}`}
                  aria-label={`${slot.key} player`}
                  value={selected}
                  disabled={busy}
                  onChange={(event) => select(slot.key, event.target.value)}
                >
                  <option value="">Choose player</option>
                  {team.squad
                    .filter((player) =>
                      slot.position === "GK"
                        ? player.primaryPosition === "GK"
                        : player.primaryPosition !== "GK",
                    )
                    .map((player) => (
                      <option
                        key={player.id}
                        value={player.id}
                        disabled={
                          player.id !== selected &&
                          assignments.some((entry) => entry.playerId === player.id)
                        }
                      >
                        {player.shirtNumber} · {player.firstName} {player.lastName} ·{" "}
                        {player.primaryPosition} {player.overall}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </div>
      </div>
      <div className="lineup-save-bar">
        <div>
          <p>
            {locked
              ? "Publishing is locked until your fixture finishes."
              : "Publish to make this XI official."}
          </p>
          <small className="muted">
            You can keep preparing and save a private draft at any time.
          </small>
        </div>
        <div className="button-row">
          <button disabled={busy || !!preparation.error} onClick={() => void save(false)}>
            {busy ? "Saving…" : "Save draft"}
          </button>
          <button
            className="primary"
            disabled={busy || locked || !!preparation.error}
            onClick={() => void save(true)}
          >
            Save & publish official XI
          </button>
        </div>
      </div>
      <ErrorBox message={error} />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
