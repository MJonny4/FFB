import { standingSchema, leaderboardSchema, z } from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { coins } from "../lib/api.ts";
import { PageTitle, TeamLink, ErrorBox, Loading, Notice } from "../components/ui.tsx";
const standingsSchema = z.array(standingSchema),
  rankingSchema = z.array(leaderboardSchema);
export function StandingsPage() {
  const { data, error, loading, reload } = useResource("/api/standings", standingsSchema);
  return (
    <>
      <PageTitle eyebrow="THE LEAGUE" title="The race for the top.">
        Three points for a win. Twenty clubs with something to prove.
      </PageTitle>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      <div className="table-wrap panel">
        <table>
          <caption>League standings · current 38-round season</caption>
          <thead>
            <tr>
              <th>Pos</th>
              <th scope="col">Club</th>
              {["P", "W", "D", "L", "GF", "GA", "GD", "Pts", "Form"].map((c) => (
                <th scope="col" key={c}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((e) => (
              <tr key={e.team.id}>
                <td>{e.position}</td>
                <th scope="row">
                  <TeamLink team={e.team} />
                </th>
                <td>{e.played}</td>
                <td>{e.wins}</td>
                <td>{e.draws}</td>
                <td>{e.losses}</td>
                <td>{e.goalsFor}</td>
                <td>{e.goalsAgainst}</td>
                <td>{e.goalDifference}</td>
                <td className="table-points">{e.points}</td>
                <td>{e.form.join(" ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notice>Tied clubs: points → goal difference → goals scored → wins → club name.</Notice>
    </>
  );
}
export function LeaderboardPage() {
  const { data, error, loading, reload } = useResource("/api/leaderboard", rankingSchema);
  return (
    <>
      <PageTitle eyebrow="THE MANAGERS" title="Football instincts, ranked.">
        Net profit leads the table. The first ten settled bets are provisional.
      </PageTitle>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data?.length === 0 && <Notice>The first manager has yet to join.</Notice>}
      <div className="table-wrap panel">
        <table>
          <caption>Virtual betting leaderboard</caption>
          <thead>
            <tr>
              {[
                "Rank",
                "Manager",
                "Coins",
                "Bets",
                "W / L",
                "Pending",
                "Profit",
                "ROI",
                "Hit rate",
              ].map((c) => (
                <th scope="col" key={c}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((e) => (
              <tr key={e.username}>
                <td>{e.rank}</td>
                <th scope="row">
                  <a href={`#/managers/${e.username}`}>{e.displayName}</a>
                  {e.provisional && <small className="muted"> · provisional</small>}
                </th>
                <td>{coins(e.coinBalance)}</td>
                <td>{e.settledBets}</td>
                <td>
                  {e.wins} / {e.losses}
                </td>
                <td>{e.pendingBets}</td>
                <td className={e.netProfit >= 0 ? "positive" : ""}>{coins(e.netProfit)}</td>
                <td>{e.roiPercent === null ? "—" : `${e.roiPercent.toFixed(1)}%`}</td>
                <td>{e.hitRatePercent === null ? "—" : `${e.hitRatePercent.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
