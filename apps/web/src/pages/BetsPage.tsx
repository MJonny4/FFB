import { useNow } from "../hooks/useNow.ts";
import { betSchema, roundSchema, z } from "@ffb/contracts";
import { useResource } from "../hooks/useResource.ts";
import { request, refresh, dateTime, coins } from "../lib/api.ts";
import { ActionForm, PageTitle, ErrorBox, Loading, Notice } from "../components/ui.tsx";
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
      <PageTitle eyebrow="YOUR VIRTUAL COINS" title="Every call counts.">
        Accepted odds stay yours, even when a lineup changes.
      </PageTitle>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data?.length === 0 && (
        <Notice>No bets yet. Explore this week’s fixtures to make your first call.</Notice>
      )}
      <div className="stack">
        {data?.map((b) => (
          <article key={b.id} className="panel bet-row">
            <div>
              <a href={`#/matches/${b.matchId}`}>View fixture ↗</a>
              <h2>
                {b.market.replaceAll("_", " ")} · {b.selection}
              </h2>
              <p className="muted">
                {dateTime(b.createdAt)} · odds {Number(b.oddsTaken).toFixed(2)}
              </p>
            </div>
            <div className="bet-outcome">
              <span className={`badge ${b.status === "WON" ? "positive" : ""}`}>{b.status}</span>
              <strong>{coins(b.stake)} coins</strong>
              {b.payout !== null && <span>Return: {coins(b.payout)}</span>}
              {b.status === "PENDING" && open && (
                <ActionForm
                  label="Cancel & refund"
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
