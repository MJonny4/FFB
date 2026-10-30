import { MARKET_REGISTRY, calculatePayout } from "@ffb/football";
import { useNow } from "../hooks/useNow.ts";
import { betSchema, roundSchema, z } from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { request, refresh, dateTime, coins } from "../lib/api.ts";
import { ActionForm, PageTitle, ErrorBox, Loading, Notice } from "../components/ui.tsx";
import "./accounts.css";
const betsSchema = z.array(betSchema),
  roundResponse = roundSchema.nullable(),
  balanceResponse = z.object({ coinBalance: z.number() });
export function BetsPage() {
  const now = useNow();
  const { data, error, loading, reload } = useResource("/api/bets", betsSchema),
    round = useResource("/api/rounds/current", roundResponse);
  const open = round.data?.status === "OPEN" && now < Date.parse(round.data.bettingClosesAt);
  return (
    <>
      <PageTitle eyebrow="Virtual betting history" title="My bets">
        Accepted odds stay yours, even when a lineup changes.
      </PageTitle>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data?.length === 0 && (
        <Notice>
          No bets yet. <a href="#/matches">Explore this week’s fixtures</a> to make your first call.
        </Notice>
      )}
      <ErrorBox message={round.error} retry={round.reload} />
      <div className="bet-history">
        {data?.map((b) => (
          <article key={b.id} className="bet-row">
            <div>
              <a className="fixture-name" href={`#/matches/${b.matchId}`}>
                {b.homeTeamName} v {b.awayTeamName}
              </a>
              <h2>
                {MARKET_REGISTRY[b.market].label} ·{" "}
                {b.selection === "HOME"
                  ? `${b.homeTeamName} to win`
                  : b.selection === "AWAY"
                    ? `${b.awayTeamName} to win`
                    : b.selection === "DRAW"
                      ? "Draw"
                      : b.selection === "OTHER"
                        ? "Any other score"
                        : b.selection}
              </h2>
              <p className="muted">
                {dateTime(b.createdAt)} · odds {Number(b.oddsTaken).toFixed(4)}
              </p>
            </div>
            <div className="bet-outcome">
              <span className={`badge ${b.status === "WON" ? "positive" : ""}`}>{b.status}</span>
              <strong>Stake: {coins(b.stake)} coins</strong>
              {b.payout !== null ? (
                <span>Return: {coins(b.payout)} coins</span>
              ) : (
                b.status === "PENDING" && (
                  <span>Possible return: {coins(calculatePayout(b.stake, b.oddsTaken))} coins</span>
                )
              )}
              {b.status === "PENDING" &&
                open &&
                round.data?.matches.some(
                  (match) =>
                    match.id === b.matchId &&
                    match.status === "SCHEDULED" &&
                    now < Date.parse(match.scheduledAt),
                ) && (
                  <ActionForm
                    label="Cancel & refund"
                    successMessage="Bet cancelled. Your stake has been refunded."
                    onSubmit={async () => {
                      await request(`/api/bets/${b.id}`, balanceResponse, { method: "DELETE" });
                      refresh();
                    }}
                  >
                    <span className="muted">Refund closes with betting.</span>
                  </ActionForm>
                )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
