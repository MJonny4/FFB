import { useState } from "react";
import {
  teamSchema,
  teamDetailSchema,
  matchSchema,
  standingSchema,
  z,
  type User,
  type Match,
  type TeamDetail,
} from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { useNow } from "../hooks/useNow.ts";
import { request, success, refresh, dateTime } from "../lib/api.ts";
import { ActionForm, PageTitle, Crest, ErrorBox, Loading, Notice } from "../components/ui.tsx";
import { LineupEditor, LineupPitch } from "./LineupEditor.tsx";
import "./clubs.css";

const teamsSchema = z.array(teamSchema),
  historySchema = z.array(matchSchema),
  standingsSchema = z.array(standingSchema);

export function TeamsPage() {
  const { data, error, loading, reload } = useResource("/api/teams", teamsSchema);
  const [available, setAvailable] = useState(false);
  const clubs = data?.filter((team) => !available || !team.manager);
  return (
    <div className="club-page">
      <PageTitle eyebrow="The fictional football league" title="The clubs">
        Twenty identities. One place on the touchline for each manager.
      </PageTitle>
      <div className="tabs" aria-label="Club availability">
        <button aria-pressed={!available} onClick={() => setAvailable(false)}>
          All clubs{data ? ` · ${data.length}` : ""}
        </button>
        <button aria-pressed={available} onClick={() => setAvailable(true)}>
          Available to manage{data ? ` · ${data.filter((team) => !team.manager).length}` : ""}
        </button>
      </div>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {clubs?.length === 0 && (
        <Notice>
          {available
            ? "Every club has a manager. Follow the league while a place opens up."
            : "The clubs are being prepared. Check back soon."}
        </Notice>
      )}
      <div className="club-directory">
        {clubs?.map((team) => (
          <a className="club-directory-row" href={`#/teams/${team.id}`} key={team.id}>
            <Crest team={team} />
            <div className="club-directory-identity">
              <h2>{team.name}</h2>
              <p>
                {team.city} · Est. {team.foundedYear}
              </p>
              <small>
                {team.manager ? `Managed by ${team.manager.displayName}` : "Available to manage"}
              </small>
            </div>
            <div className="club-directory-rating">
              <strong>{team.strengthRating.toFixed(1)}</strong>
              <small>Overall</small>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function ClubFixtures({ matches }: { matches: Match[] }) {
  return matches.length ? (
    <div className="club-fixtures">
      {matches.map((match) => (
        <a className="club-fixture" key={match.id} href={`#/matches/${match.id}`}>
          <time>{dateTime(match.scheduledAt)}</time>
          <span className="club-fixture-teams">
            <span>{match.homeTeam.shortName}</span>
            <strong>
              {match.result ? `${match.result.homeScore}–${match.result.awayScore}` : "vs"}
            </strong>
            <span>{match.awayTeam.shortName}</span>
          </span>
          <small>{match.result ? "Match report" : "Match centre"}</small>
        </a>
      ))}
    </div>
  ) : (
    <Notice>No fixtures scheduled yet.</Notice>
  );
}

function Squad({ team }: { team: TeamDetail }) {
  return (
    <section className="club-squad" aria-labelledby="squad-heading">
      <div className="section-heading">
        <h2 id="squad-heading">The squad</h2>
        <span className="muted">{team.squad.length} players</span>
      </div>
      <div className="table-wrap" tabIndex={0} aria-label="Squad table, scroll for all attributes">
        <table className="squad-table">
          <caption>Player ratings and positions</caption>
          <thead>
            <tr>
              {["Shirt", "Player", "Nation", "Position", "Overall", "Skills"].map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.squad.map((player) => (
              <tr key={player.id}>
                <td>{player.shirtNumber}</td>
                <th scope="row">
                  <div className="player-name">
                    <img
                      className="portrait"
                      src="/players/default-player.png"
                      alt=""
                      width={32}
                      height={32}
                    />
                    <span>
                      {player.firstName} {player.lastName}
                    </span>
                  </div>
                </th>
                <td>
                  <img
                    className="flag"
                    src={`/flags/${player.nationalityCode.toLowerCase()}.svg`}
                    alt={player.nationalityCode}
                    width={24}
                    height={18}
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = "/flags/unknown.svg";
                    }}
                  />
                </td>
                <td>
                  {player.primaryPosition}
                  <small className="secondary-positions">
                    {player.secondaryPositions.join(", ")}
                  </small>
                </td>
                <td className="table-points">{player.overall}</td>
                <td>
                  <details>
                    <summary>
                      Attributes
                      <span className="sr-only">
                        {" "}
                        for {player.firstName} {player.lastName}
                      </span>
                    </summary>
                    <dl className="attributes">
                      {Object.entries(player.attributes).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {team.squad.length === 0 && <Notice>The squad has not been announced yet.</Notice>}
    </section>
  );
}

export function TeamPage({
  id,
  user,
  manager = false,
}: {
  id: string;
  user: User | null;
  manager?: boolean;
}) {
  const owned = user?.teamId === id;
  const permitted = !manager || owned;
  const { data, error, loading, reload } = useResource(
    permitted ? (manager ? "/api/teams/me" : `/api/teams/${encodeURIComponent(id)}`) : null,
    teamDetailSchema,
  );
  const history = useResource(
    permitted ? `/api/teams/${encodeURIComponent(id)}/history` : null,
    historySchema,
  );
  const standings = useResource(permitted ? "/api/standings" : null, standingsSchema);
  const now = useNow();
  const standing = standings.data?.find((entry) => entry.team.id === data?.id);
  const upcoming = history.data
    ?.filter((match) => match.status === "SCHEDULED")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const next = upcoming?.[0];
  const locked = upcoming?.some((match) => now >= Date.parse(match.lineupLocksAt)) ?? false;
  const ownLoadedClub = !!data && user?.teamId === data.id;
  if (!permitted)
    return (
      <Notice>
        Manager Room is only available for your own club.{" "}
        <a href={`#/teams/${encodeURIComponent(id)}`}>Open public view</a>.
      </Notice>
    );
  return (
    <div className={`club-page ${manager ? "manager-room" : "club-public"}`}>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data && (
        <>
          <div className="club-heading">
            <Crest team={data} />
            <PageTitle
              eyebrow={`${data.city} · Est. ${data.foundedYear}`}
              title={manager ? "Manager Room" : data.name}
            >
              {manager ? `${data.name} · ` : ""}
              {data.stadiumName}
            </PageTitle>
          </div>
          {ownLoadedClub && (
            <nav className="club-lenses" aria-label="Club view">
              <a href={`#/teams/${data.id}`} aria-current={!manager ? "page" : undefined}>
                Public view
              </a>
              <a href="#/my-team" aria-current={manager ? "page" : undefined}>
                Manager Room
              </a>
            </nav>
          )}
          {manager && ownLoadedClub ? (
            <>
              <section className="manager-next" aria-labelledby="next-fixture-heading">
                <div>
                  <h2 id="next-fixture-heading">
                    {locked ? "Your XI is locked" : "Prepare for the next fixture"}
                  </h2>
                  {next ? (
                    <>
                      <a href={`#/matches/${next.id}`}>
                        {next.homeTeam.name} vs {next.awayTeam.name}
                      </a>
                      <p>
                        {locked
                          ? "The published XI stays in place until the fixture finishes."
                          : `Publish by ${dateTime(next.lineupLocksAt)}.`}
                      </p>
                      <small>Kickoff {dateTime(next.scheduledAt)}</small>
                    </>
                  ) : history.loading ? (
                    <Loading />
                  ) : history.error ? (
                    <p>Fixture details are unavailable. Retry to check your publishing deadline.</p>
                  ) : (
                    <p>No upcoming fixture. Prepare your draft for the next round.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    document
                      .getElementById("lineup-editor-heading")
                      ?.scrollIntoView({ block: "start" });
                    document
                      .querySelector<HTMLSelectElement>(".manager-editor select")
                      ?.focus({ preventScroll: true });
                  }}
                >
                  Review starting XI
                </button>
              </section>
              <ErrorBox message={history.error} retry={history.reload} />
              <LineupEditor key={data.id} team={data} locked={locked} />
            </>
          ) : (
            <>
              <div className="club-manager-line">
                {data.manager ? (
                  <p>
                    Managed by{" "}
                    <a href={`#/managers/${data.manager.username}`}>{data.manager.displayName}</a>
                  </p>
                ) : user && !user.teamId ? (
                  <ActionForm
                    label="Become club manager"
                    onSubmit={async () => {
                      await request(`/api/teams/${data.id}/claim`, success, { method: "POST" });
                      refresh();
                    }}
                  >
                    <p>Take charge of this club. Managers cannot bet on their own fixtures.</p>
                  </ActionForm>
                ) : (
                  <p>
                    This club is available to manage.
                    {!user && (
                      <>
                        {" "}
                        <a href="#/signup">Join the league</a> to take charge.
                      </>
                    )}
                  </p>
                )}
              </div>
              <section className="club-season" aria-labelledby="season-heading">
                <div className="section-heading">
                  <h2 id="season-heading">Season at a glance</h2>
                  <a href="#/standings">League table</a>
                </div>
                <ErrorBox message={standings.error} retry={standings.reload} />
                {standings.loading ? (
                  <Loading />
                ) : (
                  <dl className="club-record">
                    <div>
                      <dt>Position</dt>
                      <dd>{standing?.position ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Points</dt>
                      <dd>{standing?.points ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Played</dt>
                      <dd>{standing?.played ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Goals for / against</dt>
                      <dd>{standing ? `${standing.goalsFor} / ${standing.goalsAgainst}` : "—"}</dd>
                    </div>
                    <div>
                      <dt>Recent form</dt>
                      <dd className="club-form">
                        {standing?.form.length
                          ? standing.form.map((result, index) => (
                              <span
                                key={index}
                                title={result === "W" ? "Win" : result === "D" ? "Draw" : "Loss"}
                              >
                                {result}
                              </span>
                            ))
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                )}
              </section>
            </>
          )}
          <div className="club-overview">
            <section className="published-lineup" aria-labelledby="published-heading">
              <div className="section-heading">
                <h2 id="published-heading">Official starting XI</h2>
                <span>{data.official.formation}</span>
              </div>
              <LineupPitch team={data} lineup={data.official} />
            </section>
            <section className="club-match-history" aria-labelledby="fixtures-heading">
              <h2 id="fixtures-heading">Fixtures & results</h2>
              <ErrorBox message={history.error} retry={history.reload} />
              {history.loading && <Loading />}
              {history.data && <ClubFixtures matches={history.data} />}
            </section>
          </div>
          <Squad team={data} />
        </>
      )}
    </div>
  );
}
