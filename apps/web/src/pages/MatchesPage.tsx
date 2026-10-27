import { useNow } from "../hooks/useNow.ts";
import { useRef } from "react";
import { roundSchema, z } from "@ffb/contracts";
import { MARKET_REGISTRY } from "@ffb/football";
import type { Match, User } from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { request, refresh, dateTime } from "../lib/api.ts";
import { ActionForm, TeamLink, PageTitle, Notice, ErrorBox, Loading } from "../components/ui.tsx";
const nullableRound = roundSchema.nullable();
const betResponse = z.object({ betId: z.string(), coinBalance: z.number() });
function MatchCard({ match, user, open }: { match: Match; user: User | null; open: boolean }) {
  const lastRequest = useRef<{ signature: string; requestId: string } | null>(null);
  async function place(form: FormData) {
    const [market, selection] = String(form.get("quote")).split(":");
    const stake = Number(form.get("stake")),
      signature = JSON.stringify({ market, selection, stake });
    if (lastRequest.current?.signature !== signature)
      lastRequest.current = { signature, requestId: crypto.randomUUID() };
    await request("/api/bets", betResponse, {
      method: "POST",
      body: JSON.stringify({
        matchId: match.id,
        market,
        selection,
        stake,
        requestId: lastRequest.current.requestId,
      }),
    });
    lastRequest.current = null;
    refresh();
  }
  const own = user?.teamId === match.homeTeam.id || user?.teamId === match.awayTeam.id;
  return (
    <article className="panel match-card">
      <div className="card-meta">
        <span>{dateTime(match.scheduledAt)}</span>
        <span className="badge">
          {match.status === "RESOLVED" ? "FULL TIME" : open ? "PRE-MATCH" : "BETTING LOCKED"}
        </span>
      </div>
      <div className="fixture">
        <TeamLink team={match.homeTeam} />
        <strong className="score">
          {match.result ? `${match.result.homeScore} : ${match.result.awayScore}` : "vs"}
        </strong>
        <TeamLink team={match.awayTeam} />
      </div>
      <a className="match-center-link" href={`#/matches/${match.id}`}>
        {match.status === "RESOLVED" ? "Read match report" : "Open match center"}{" "}
        <span aria-hidden="true">↗</span>
      </a>
      {open && user && !own && (
        <ActionForm onSubmit={place} label="Place bet">
          <label>
            Market and selection
            <select name="quote">
              {Object.values(MARKET_REGISTRY).map((m) => (
                <optgroup label={m.label} key={m.code}>
                  {match.quotes
                    .filter((q) => q.market === m.code)
                    .map((q) => (
                      <option
                        key={`${q.market}:${q.selection}`}
                        value={`${q.market}:${q.selection}`}
                      >
                        {q.selection} · {Number(q.odds).toFixed(2)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Stake · virtual coins
            <input
              name="stake"
              type="number"
              min={1}
              max={Math.min(1000000, user.coinBalance)}
              step={1}
              defaultValue={10}
              required
            />
          </label>
        </ActionForm>
      )}
      {own && <p className="muted">You manage a club in this fixture.</p>}
    </article>
  );
}
export function MatchesPage({ user }: { user: User | null }) {
  const now = useNow();
  const { data, error, loading, reload } = useResource("/api/rounds/current", nullableRound);
  return (
    <>
      <PageTitle
        eyebrow={data ? `MATCHWEEK ${data.weekNumber} · EUROPE/MADRID` : "THE LEAGUE"}
        title="The weekend starts here."
      >
        Follow your clubs. Find your edge. All with virtual coins.
      </PageTitle>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data ? (
        <>
          <div className="round-banner">
            <strong>{data.status === "OPEN" ? "Betting window open" : "Bets are locked"}</strong>
            <span>Closes {dateTime(data.bettingClosesAt)} · Lineups lock 1h before kickoff</span>
          </div>
          <div className="match-grid">
            {[...data.matches]
              .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
              .map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  user={user}
                  open={
                    data.status === "OPEN" &&
                    now < Date.parse(data.bettingClosesAt) &&
                    now < Date.parse(m.scheduledAt) &&
                    m.status === "SCHEDULED"
                  }
                />
              ))}
          </div>
        </>
      ) : (
        !loading && !error && <Notice>The next round opens Monday at 09:00 Madrid time.</Notice>
      )}
    </>
  );
}
