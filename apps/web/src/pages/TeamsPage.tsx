import { teamSchema, teamDetailSchema, matchSchema, z, type User } from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { request, success, refresh, dateTime } from "../lib/api.ts";
import { ActionForm, PageTitle, Crest, ErrorBox, Loading, Notice } from "../components/ui.tsx";
import { LineupEditor } from "./LineupEditor.tsx";
const teamsSchema = z.array(teamSchema),
  historySchema = z.array(matchSchema);
export function TeamsPage() {
  const { data, error, loading, reload } = useResource("/api/teams", teamsSchema);
  return (
    <>
      <PageTitle eyebrow="20 CLUBS · ONE LEAGUE" title="Find your colours.">
        Original clubs. Full squads. A place on the touchline waiting for you.
      </PageTitle>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      <div className="club-grid">
        {data?.map((t) => (
          <a
            className="panel club-card"
            href={`#/teams/${t.id}`}
            key={t.id}
            style={{ borderTopColor: t.primaryColor }}
          >
            <Crest team={t} />
            <h2>{t.name}</h2>
            <p>
              {t.city} · est. {t.foundedYear}
            </p>
            <div className="card-meta">
              <span>OVR {t.strengthRating.toFixed(1)}</span>
              <span className="badge">{t.manager ? "MANAGED" : "AVAILABLE"}</span>
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
export function TeamPage({ id, user }: { id: string; user: User | null }) {
  const { data, error, loading, reload } = useResource(
    `/api/teams/${encodeURIComponent(id)}`,
    teamDetailSchema,
  );
  const history = useResource(`/api/teams/${encodeURIComponent(id)}/history`, historySchema);
  return (
    <>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data && (
        <>
          <div className="club-heading">
            <Crest team={data} />
            <PageTitle
              eyebrow={`${data.city.toUpperCase()} · EST. ${data.foundedYear}`}
              title={data.name}
            >
              {data.stadiumName} · overall {data.strengthRating.toFixed(1)}
            </PageTitle>
          </div>
          {data.manager ? (
            <p>
              Manager:{" "}
              <a href={`#/managers/${data.manager.username}`}>{data.manager.displayName}</a>
            </p>
          ) : user && !user.teamId ? (
            <ActionForm
              onSubmit={async () => {
                await request(`/api/teams/${data.id}/claim`, success, { method: "POST" });
                refresh();
              }}
              label="Become club manager"
            >
              <Notice>
                Take charge of the starting XI. Managers cannot bet on their own club.
              </Notice>
            </ActionForm>
          ) : (
            <Notice>This club is available to manage.</Notice>
          )}
          {user?.teamId === data.id && (
            <LineupEditor key={JSON.stringify(data.draft ?? data.official)} team={data} />
          )}
          <section className="panel">
            <h2>Official starting XI · {data.official.formation}</h2>
            <div className="lineup-grid">
              {data.official.assignments.map((a) => {
                const p = data.squad.find((s) => s.id === a.playerId);
                return p ? (
                  <div key={a.slotKey} className="lineup-player">
                    <span className="badge">{a.slotKey}</span>
                    <strong>
                      {p.firstName} {p.lastName}
                    </strong>
                    <span>{p.overall} OVR</span>
                  </div>
                ) : null;
              })}
            </div>
          </section>
          <section className="panel">
            <h2>
              The squad <span className="muted">23 players</span>
            </h2>
            <div className="table-wrap">
              <table>
                <caption>Player ratings and positions</caption>
                <thead>
                  <tr>
                    {["#", "Player", "Nation", "Position", "OVR", "Skills"].map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.squad.map((p) => (
                    <tr key={p.id}>
                      <td>{p.shirtNumber}</td>
                      <th scope="row">
                        <div className="player-name">
                          <img
                            className="portrait"
                            src="/players/default-player.png"
                            alt=""
                            width={32}
                            height={32}
                          />
                          {p.firstName} {p.lastName}
                        </div>
                      </th>
                      <td>
                        <img
                          className="flag"
                          src={`/flags/${p.nationalityCode.toLowerCase()}.svg`}
                          alt={p.nationalityCode}
                          width={24}
                          height={18}
                        />
                      </td>
                      <td>
                        {p.primaryPosition}
                        <small className="muted"> {p.secondaryPositions.join(", ")}</small>
                      </td>
                      <td className="table-points">{p.overall}</td>
                      <td>
                        <details>
                          <summary>Attributes</summary>
                          <dl className="attributes">
                            {Object.entries(p.attributes).map(([key, value]) => (
                              <div key={key}>
                                <dt>{key}</dt>
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
          </section>
          <section className="panel">
            <h2>Fixtures & results</h2>
            <ErrorBox message={history.error} retry={history.reload} />
            {history.data?.map((m) => (
              <a className="history-row" key={m.id} href={`#/matches/${m.id}`}>
                <time>{dateTime(m.scheduledAt)}</time>
                <span>
                  {m.homeTeam.shortName}{" "}
                  {m.result ? `${m.result.homeScore}–${m.result.awayScore}` : "vs"}{" "}
                  {m.awayTeam.shortName}
                </span>
                <span>↗</span>
              </a>
            ))}
            {history.data?.length === 0 && <Notice>No fixtures scheduled yet.</Notice>}
          </section>
        </>
      )}
    </>
  );
}
