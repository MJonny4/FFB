import { useEffect, useRef, useState } from "react";
import { matchCenterSchema, eventSchema, z, type MatchCenter } from "@ffb/contracts";
import { formatMatchClock } from "@ffb/football";
import { useResource } from "../hooks/useResource.ts";
import { dateTime, request } from "../lib/api.ts";
import { TeamLink, ErrorBox, Loading, Notice } from "../components/ui.tsx";
import { LivePitch } from "../components/LivePitch.tsx";
import "./match-centre.css";
const eventPage = z.object({ events: z.array(eventSchema), nextSequence: z.number().nullable() });
function Report({ data }: { data: MatchCenter }) {
  const [history, setHistory] = useState<z.infer<typeof eventSchema>[] | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const eventNode = useRef<HTMLDivElement>(null),
    seen = useRef<number | null>(null);
  const m = data.match,
    live = data.live;
  const latest = [...data.events].reverse().find((event) => event.important) ?? null;
  useEffect(() => {
    const sequence = latest?.sequence ?? 0;
    const isNew = seen.current !== null && sequence > seen.current;
    seen.current = sequence;
    if (
      !isNew ||
      !latest ||
      live?.phase !== "LIVE" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animation = eventNode.current?.animate(
      [
        { transform: `translateY(${latest.type === "GOAL" ? 16 : 6}px)`, opacity: 0.45 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: latest.type === "GOAL" ? 600 : 180, easing: "cubic-bezier(.16,1,.3,1)" },
    );
    return () => animation?.cancel();
  }, [latest, live?.phase]);
  async function loadHistory() {
    if (busy) return;
    setBusy(true);
    setError("");
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
      setError(e instanceof Error ? e.message : "Unable to load events. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const score =
    m.result ??
    (live ? { homeScore: live.home.stats.goals, awayScore: live.away.stats.goals } : null);
  const phase =
    m.status === "RESOLVED" || live?.phase === "FINISHED"
      ? "Full time"
      : live?.phase === "HALFTIME"
        ? "Half time"
        : live?.phase === "LIVE"
          ? "Live"
          : "Pre-match";
  const timeline = [
    ...new Map(
      [...(history ?? []), ...data.events].map((event) => [event.sequence, event]),
    ).values(),
  ]
    .filter((event) => event.important)
    .sort((a, b) => b.sequence - a.sequence);
  return (
    <>
      <header className="match-heading">
        <div>
          <h1>Match centre</h1>
          <p>
            Matchweek {m.weekNumber} · {dateTime(m.scheduledAt)} · {m.homeTeam.stadiumName}
          </p>
        </div>
        <a href="#/matches">All fixtures</a>
      </header>
      <section className="broadcast" aria-label="Match score and pitch">
        <div className="scoreboard">
          <TeamLink team={m.homeTeam} />
          <div className="scoreboard-result">
            <span className={`match-phase ${phase === "Live" ? "is-live" : ""}`}>
              {phase}
              {live?.phase === "LIVE"
                ? ` · ${formatMatchClock(live.second, live.period, live.phase)}`
                : ""}
            </span>
            <strong
              className="broadcast-score"
              aria-label={
                score
                  ? `${m.homeTeam.name} ${score.homeScore}, ${m.awayTeam.name} ${score.awayScore}`
                  : "Kickoff pending"
              }
            >
              {score ? `${score.homeScore} – ${score.awayScore}` : "v"}
            </strong>
            <span className="muted">
              {data.formations.home} · {data.formations.away}
            </span>
          </div>
          <TeamLink team={m.awayTeam} />
        </div>
        <div className="pitch-and-event">
          <LivePitch data={data} />
          <aside className="broadcast-desk">
            <h2>{phase === "Full time" ? "Final word" : "From the touchline"}</h2>
            <div
              ref={eventNode}
              className={`latest-event ${latest?.type === "GOAL" ? "goal-event" : ""}`}
              role="status"
              aria-atomic="true"
            >
              {latest ? (
                <>
                  <span className="event-minute">{Math.ceil(latest.second / 60)}′</span>
                  <strong>{latest.type.replaceAll("_", " ").toLowerCase()}</strong>
                  <p>{latest.text}</p>
                </>
              ) : (
                <p>The teams are preparing. Match commentary begins at kickoff.</p>
              )}
            </div>
            <dl className="match-facts">
              <div>
                <dt>Home</dt>
                <dd>
                  {m.homeTeam.shortName} · {data.formations.home}
                </dd>
              </div>
              <div>
                <dt>Away</dt>
                <dd>
                  {m.awayTeam.shortName} · {data.formations.away}
                </dd>
              </div>
              {live && (
                <div>
                  <dt>Possession</dt>
                  <dd>
                    {live.possession === "HOME" ? m.homeTeam.shortName : m.awayTeam.shortName}
                  </dd>
                </div>
              )}
            </dl>
          </aside>
        </div>
      </section>
      {!live && (
        <Notice>
          Players take the pitch at kickoff. Betting closes {dateTime(m.bettingClosesAt)}; lineups
          lock {dateTime(m.lineupLocksAt)}.
        </Notice>
      )}
      {live && (
        <>
          <div className="report-grid match-report">
            <section className="panel">
              <h2>Balance of play</h2>
              <div className="statistics-teams">
                <span>{m.homeTeam.shortName}</span>
                <span>{m.awayTeam.shortName}</span>
              </div>
              {(
                [
                  "possessionSeconds",
                  "shots",
                  "shotsOnTarget",
                  "saves",
                  "corners",
                  "fouls",
                  "offsides",
                  "yellows",
                  "reds",
                ] as const
              ).map((key) => {
                const home = live.home.stats[key],
                  away = live.away.stats[key],
                  total = home + away;
                const possession = key === "possessionSeconds";
                const share = total ? (home / total) * 100 : 50;
                const label = possession
                  ? "Possession"
                  : key === "yellows"
                    ? "Yellow cards"
                    : key === "reds"
                      ? "Red cards"
                      : key.replace(/([A-Z])/g, " $1");
                return (
                  <div className="match-stat" key={key}>
                    <div className="stat-row">
                      <strong>{possession ? `${total ? Math.round(share) : 0}%` : home}</strong>
                      <span>{label}</span>
                      <strong>
                        {possession ? `${total ? 100 - Math.round(share) : 0}%` : away}
                      </strong>
                    </div>
                    <div className="stat-balance" aria-hidden="true">
                      <span style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })}
            </section>
            <section className="panel">
              <h2>Match timeline</h2>
              <ErrorBox message={error} />
              {!timeline.length && <p className="muted">The story starts at kickoff.</p>}
              <ol className="timeline">
                {timeline.map((event) => (
                  <li key={event.sequence}>
                    <time>{Math.ceil(event.second / 60)}′</time>
                    <span>
                      <b>{event.type.replaceAll("_", " ").toLowerCase()}</b>
                      <span>{event.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {history === null && (
                <button disabled={busy} onClick={() => void loadHistory()}>
                  {busy ? "Loading…" : "Load full match timeline"}
                </button>
              )}
            </section>
          </div>
          <div className="report-grid match-squads">
            {(["home", "away"] as const).map((side) => (
              <section className="panel" key={side}>
                <h2>{m[side === "home" ? "homeTeam" : "awayTeam"].name}</h2>
                <p className="muted">Matchday squad · energy remaining</p>
                <ol className="match-players">
                  {live[side].players.map((player) => (
                    <li key={player.id}>
                      <span className="shirt-number">{player.shirtNumber}</span>
                      <span className="player-description">
                        <strong>{player.name}</strong>
                        <small>
                          {player.status.toLowerCase()}
                          {player.goals ? ` · ${player.goals} goals` : ""}
                          {player.yellows ? ` · ${player.yellows} yellow cards` : ""}
                          {player.injured ? " · injured" : ""}
                        </small>
                      </span>
                      <span>{Math.round(player.energy)}%</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </>
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
