import { useLayoutEffect, useRef } from "react";
import { standingSchema, leaderboardSchema, z, type User } from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { coins } from "../lib/api.ts";
import { PageTitle, Crest, ErrorBox, Loading, Notice } from "../components/ui.tsx";
const standingsSchema = z.array(standingSchema),
  rankingSchema = z.array(leaderboardSchema);
export function StandingsPage({ user }: { user: User | null }) {
  const { data, error, loading, reload } = useResource("/api/standings", standingsSchema);
  const body = useRef<HTMLTableSectionElement>(null);
  const positions = useRef(new Map<string, { position: number; top: number }>());
  useLayoutEffect(() => {
    if (!data || !body.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations: Animation[] = [];
    const next = new Map<string, { position: number; top: number }>();
    for (const row of body.current.rows) {
      const id = row.dataset.club!;
      const position = data.find((entry) => entry.team.id === id)!.position;
      const top = row.offsetTop;
      const previous = positions.current.get(id);
      next.set(id, { position, top });
      if (previous && previous.position !== position && !reduced.matches)
        animations.push(
          row.animate(
            [{ transform: `translateY(${previous.top - top}px)` }, { transform: "translateY(0)" }],
            { duration: 300, easing: "cubic-bezier(.16,1,.3,1)" },
          ),
        );
    }
    positions.current = next;
    const cancel = () => animations.forEach((animation) => animation.cancel());
    reduced.addEventListener("change", cancel);
    return () => {
      cancel();
      reduced.removeEventListener("change", cancel);
    };
  }, [data]);
  return (
    <>
      <PageTitle eyebrow="Current season · 38 matchweeks" title="League table">
        Three points for a win. Twenty clubs with something to prove.
      </PageTitle>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      <div
        className="table-wrap standings-wrap"
        role="region"
        aria-label="League standings"
        tabIndex={0}
      >
        <table>
          <caption>
            League standings · current 38-round season
            <span className="table-scroll-hint">Scroll for match stats and form</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Pos</th>
              <th scope="col">Club</th>
              {["Pts", "P", "W", "D", "L", "GF", "GA", "GD", "Form"].map((c) => (
                <th scope="col" key={c}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={body}>
            {data?.map((e) => (
              <tr
                key={e.team.id}
                data-club={e.team.id}
                className={`club-standing ${user?.teamId === e.team.id ? "owned-standing" : ""}`}
              >
                <td>{e.position}</td>
                <th scope="row">
                  <a
                    className="standing-link team-link"
                    href={`#/teams/${e.team.id}`}
                    aria-label={`${e.team.name}, position ${e.position}, ${e.points} points. Public club profile`}
                  >
                    <Crest team={e.team} />
                    <span>
                      {e.team.name}
                      {user?.teamId === e.team.id && (
                        <small className="owned-label">Your club</small>
                      )}
                    </span>
                  </a>
                </th>
                <td className="table-points">{e.points}</td>
                <td>{e.played}</td>
                <td>{e.wins}</td>
                <td>{e.draws}</td>
                <td>{e.losses}</td>
                <td>{e.goalsFor}</td>
                <td>{e.goalsAgainst}</td>
                <td>{e.goalDifference}</td>
                <td>
                  <span className="form-results">
                    {e.form.length
                      ? e.form.map((result, i) => (
                          <span
                            key={i}
                            className={`form-result form-${result.toLowerCase()}`}
                            title={result === "W" ? "Win" : result === "D" ? "Draw" : "Loss"}
                          >
                            {result}
                          </span>
                        ))
                      : "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.length === 0 && (
        <Notice>The league table will appear when the clubs are ready.</Notice>
      )}
      <Notice>Tied clubs: points → goal difference → goals scored → wins → club name.</Notice>
    </>
  );
}
export function LeaderboardPage() {
  const { data, error, loading, reload } = useResource("/api/leaderboard", rankingSchema);
  return (
    <>
      <PageTitle eyebrow="Virtual betting · ranked by net profit" title="Manager rankings">
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
                <td className={e.netProfit > 0 ? "positive" : ""}>{coins(e.netProfit)}</td>
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
