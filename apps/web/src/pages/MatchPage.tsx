import { useState } from "react";
import { matchCenterSchema, eventSchema, z, type MatchCenter } from "@ffb/contracts";
import { formatMatchClock } from "@ffb/football";
import { useResource } from "../hooks/useResource.ts";
import { dateTime, request } from "../lib/api.ts";
import { PageTitle, TeamLink, ErrorBox, Loading, Notice } from "../components/ui.tsx";
import { LivePitch } from "../components/LivePitch.tsx";
const eventPage = z.object({ events: z.array(eventSchema), nextSequence: z.number().nullable() });
function Report({ data }: { data: MatchCenter }) {
  const [history, setHistory] = useState<z.infer<typeof eventSchema>[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const m = data.match,
    live = data.live;
  async function loadHistory() {
    setBusy(true);
    try {
      let cursor: number | null = 0;
      const events = [];
      while (cursor !== null) {
        const page: z.infer<typeof eventPage> = await request(
          `/api/matches/${m.id}/events?afterSequence=${cursor}`,
          eventPage,
        );
        events.push(...page.events);
        cursor = page.nextSequence;
      }
      setHistory(events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load events");
    } finally {
      setBusy(false);
    }
  }
  const score =
    m.result ??
    (live ? { homeScore: live.home.stats.goals, awayScore: live.away.stats.goals } : null);
  return (
    <>
      <PageTitle
        eyebrow={`MATCHWEEK ${m.weekNumber} · ${live ? formatMatchClock(live.second, live.period, live.phase) : "PRE-MATCH"}`}
        title={m.status === "RESOLVED" ? "The final whistle." : "At the heart of the match."}
      >
        {dateTime(m.scheduledAt)} · {m.homeTeam.stadiumName}
      </PageTitle>
      <section className="panel">
        <div className="fixture match-headline">
          <TeamLink team={m.homeTeam} />
          <strong className="score">
            {score ? `${score.homeScore} : ${score.awayScore}` : "vs"}
          </strong>
          <TeamLink team={m.awayTeam} />
        </div>
        <LivePitch data={data} />
        {!live && (
          <Notice>
            Players take the pitch at kickoff. Betting closes {dateTime(m.bettingClosesAt)}; lineups
            lock {dateTime(m.lineupLocksAt)}.
          </Notice>
        )}
      </section>
      {live && (
        <div className="report-grid">
          <section className="panel">
            <h2>Match statistics</h2>
            {(
              [
                "shots",
                "shotsOnTarget",
                "saves",
                "corners",
                "fouls",
                "offsides",
                "yellows",
                "reds",
              ] as const
            ).map((key) => (
              <div className="stat-row" key={key}>
                <strong>{live.home.stats[key]}</strong>
                <span>{key.replace(/([A-Z])/g, " $1")}</span>
                <strong>{live.away.stats[key]}</strong>
              </div>
            ))}
            <div className="stat-row">
              <strong>
                {Math.round(
                  (live.home.stats.possessionSeconds /
                    Math.max(
                      1,
                      live.home.stats.possessionSeconds + live.away.stats.possessionSeconds,
                    )) *
                    100,
                )}
                %
              </strong>
              <span>Possession</span>
              <strong>
                {Math.round(
                  (live.away.stats.possessionSeconds /
                    Math.max(
                      1,
                      live.home.stats.possessionSeconds + live.away.stats.possessionSeconds,
                    )) *
                    100,
                )}
                %
              </strong>
            </div>
          </section>
          <section className="panel">
            <h2>The story of the match</h2>
            <ErrorBox message={error} />
            <ol className="timeline">
              {(history.length ? history : data.events)
                .filter((e) => e.important)
                .slice()
                .reverse()
                .map((e) => (
                  <li key={e.sequence}>
                    <time>{Math.ceil(e.second / 60)}′</time>
                    <span>
                      <b>{e.type.replaceAll("_", " ")}</b>
                      <br />
                      {e.text}
                    </span>
                  </li>
                ))}
            </ol>
            {history.length === 0 && (
              <button disabled={busy} onClick={() => void loadHistory()}>
                {busy ? "Loading…" : "Load full match timeline"}
              </button>
            )}
          </section>
        </div>
      )}
      {live && (
        <div className="report-grid">
          {(["home", "away"] as const).map((side) => (
            <section className="panel" key={side}>
              <h2>{m[side === "home" ? "homeTeam" : "awayTeam"].shortName} · matchday squad</h2>
              {live[side].players.map((p) => (
                <div key={p.id} className="history-row">
                  <span>
                    {p.shirtNumber} · {p.name}
                  </span>
                  <span>
                    {p.status} {p.goals ? `⚽ ${p.goals}` : ""} {p.yellows ? "🟨" : ""}
                  </span>
                  <span>{Math.round(p.energy)}%</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
export function MatchPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useResource(
    `/api/matches/${encodeURIComponent(id)}/live`,
    matchCenterSchema,
  );
  return (
    <>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data && <Report data={data} />}
    </>
  );
}
