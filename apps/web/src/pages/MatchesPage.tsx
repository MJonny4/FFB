import { useRef, useState } from "react";
import { ArrowUpRight, Check, Ticket, X } from "lucide-react";
import { roundSchema, betSchema, betReceiptSchema, z, type Match, type User } from "@ffb/contracts";
import { MARKET_REGISTRY, calculatePayout } from "@ffb/football";
import { useNow } from "../hooks/useNow.ts";
import { useResource } from "../hooks/useResource.ts";
import { request, refresh, dateTime, coins } from "../lib/api.ts";
import { TeamLink, PageTitle, Notice, ErrorBox, Loading } from "../components/ui.tsx";
import "./matchday.css";
const nullableRound = roundSchema.nullable();
const betsSchema = z.array(betSchema);
type Selection = {
  matchId: string;
  market: Match["quotes"][number]["market"];
  selection: string;
  odds: string;
};
const selectionName = (selection: string, match: Match) =>
  selection === "HOME"
    ? `${match.homeTeam.name} to win`
    : selection === "AWAY"
      ? `${match.awayTeam.name} to win`
      : selection === "DRAW"
        ? "Draw"
        : selection === "OTHER"
          ? "Any other score"
          : selection.toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function MatchesPage({ user }: { user: User | null }) {
  const now = useNow();
  const { data, error, loading, reload } = useResource("/api/rounds/current", nullableRound);
  const bets = useResource(user ? "/api/bets" : null, betsSchema);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [stake, setStake] = useState("10");
  const [busy, setBusy] = useState(false);
  const [betError, setBetError] = useState("");
  const [receipt, setReceipt] = useState<
    (z.infer<typeof betReceiptSchema> & { fixture: string; choice: string }) | null
  >(null);
  const [filter, setFilter] = useState("all");
  const pending = useRef(false);
  const [lastRequest, setLastRequest] = useState<{ signature: string; requestId: string } | null>(
    null,
  );
  const slip = useRef<HTMLElement>(null);
  const match = data?.matches.find((m) => m.id === selection?.matchId);
  const open = (m: Match) =>
    data?.status === "OPEN" &&
    now < Date.parse(data.bettingClosesAt) &&
    now < Date.parse(m.scheduledAt) &&
    m.status === "SCHEDULED";
  const quote = match?.quotes.find(
    (q) => q.market === selection?.market && q.selection === selection.selection,
  );
  const changed = !!(quote && selection && quote.odds !== selection.odds);
  const own = !!(
    match &&
    user &&
    [match.homeTeam.id, match.awayTeam.id].includes(user.teamId ?? "")
  );
  const amount = Number(stake);
  const valid = Number.isSafeInteger(amount) && amount >= 1 && amount <= 1_000_000;
  const possible = valid && selection ? calculatePayout(amount, selection.odds) : 0;
  const signature = selection
    ? JSON.stringify({
        matchId: selection.matchId,
        market: selection.market,
        selection: selection.selection,
        stake: amount,
      })
    : "";
  const retrying = !!betError && lastRequest?.signature === signature;
  function choose(m: Match, q: Match["quotes"][number]) {
    if (pending.current) return;
    setSelection({ matchId: m.id, ...q });
    setReceipt(null);
    setBetError("");
    requestAnimationFrame(() => {
      slip.current?.focus({ preventScroll: true });
      if (window.innerWidth <= 900) slip.current?.scrollIntoView({ block: "start" });
    });
  }
  async function place(event: React.FormEvent) {
    event.preventDefault();
    if (
      pending.current ||
      !selection ||
      !match ||
      !user ||
      !valid ||
      (!retrying && (!open(match) || own || changed || amount > user.coinBalance))
    )
      return;
    pending.current = true;
    setBusy(true);
    setBetError("");
    const attempt =
      lastRequest?.signature === signature
        ? lastRequest
        : { signature, requestId: crypto.randomUUID() };
    setLastRequest(attempt);
    try {
      const result = await request("/api/bets", betReceiptSchema, {
        method: "POST",
        body: JSON.stringify({
          matchId: match.id,
          market: selection.market,
          selection: selection.selection,
          stake: amount,
          expectedOdds: selection.odds,
          requestId: attempt.requestId,
        }),
      });
      setReceipt({
        ...result,
        fixture: `${match.homeTeam.name} v ${match.awayTeam.name}`,
        choice: selectionName(result.selection, match),
      });
      setSelection(null);
      setLastRequest(null);
      window.dispatchEvent(
        new CustomEvent("ffb:bet-accepted", {
          detail: { userId: user.id, coinBalance: result.coinBalance },
        }),
      );
      refresh();
    } catch (e) {
      setBetError(
        e instanceof Error
          ? e.message
          : "Your bet could not be confirmed. Retry to check the same request.",
      );
      reload();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const matches = [...(data?.matches ?? [])]
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .filter(
      (m) =>
        filter === "all" ||
        (filter === "open"
          ? open(m)
          : filter === "results"
            ? m.status === "RESOLVED"
            : m.status !== "RESOLVED" && now >= Date.parse(m.scheduledAt)),
    );
  return (
    <>
      <PageTitle
        eyebrow={
          data
            ? `Matchweek ${data.weekNumber} · ${data.matches.length} fixtures`
            : "Fictional football league"
        }
        title="Matchday"
      >
        Every club. Every call. Follow the league from the touchline.
      </PageTitle>
      <ErrorBox message={error} retry={reload} />
      {loading && <Loading />}
      {data ? (
        <>
          <div className="round-banner">
            <strong>
              {data.status === "OPEN" && now < Date.parse(data.bettingClosesAt)
                ? "Betting window open"
                : "Betting window closed"}
            </strong>
            <span>
              {data.status === "SETTLED"
                ? "Round settled"
                : `Closes ${dateTime(data.bettingClosesAt)}`}{" "}
              · Madrid time
            </span>
          </div>
          <div className="matchday-layout">
            <section className="fixtures-section" aria-label="Fixtures">
              <div className="tabs fixture-tabs" aria-label="Filter fixtures">
                {[
                  ["all", "All fixtures"],
                  ["open", "Open for bets"],
                  ["live", "Under way"],
                  ["results", "Results"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value!)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="fixture-list">
                {matches.map((m) => {
                  const isOwn = user && [m.homeTeam.id, m.awayTeam.id].includes(user.teamId ?? "");
                  const active = (bets.data ?? []).filter(
                    (b) => b.matchId === m.id && b.status === "PENDING",
                  );
                  return (
                    <article className="fixture-row" key={m.id}>
                      <div className="fixture-row-meta">
                        <time>{dateTime(m.scheduledAt)}</time>
                        <span
                          className={
                            m.status !== "RESOLVED" && now >= Date.parse(m.scheduledAt)
                              ? "live-label"
                              : ""
                          }
                        >
                          {m.status === "RESOLVED"
                            ? "Full time"
                            : now >= Date.parse(m.scheduledAt)
                              ? "Match under way"
                              : "Pre-match"}
                        </span>
                      </div>
                      <div className="fixture-teams">
                        <TeamLink team={m.homeTeam} />
                        <strong className="fixture-score">
                          {m.result ? `${m.result.homeScore} – ${m.result.awayScore}` : "v"}
                        </strong>
                        <TeamLink team={m.awayTeam} />
                      </div>
                      <div className="fixture-actions">
                        <a className="match-center-link" href={`#/matches/${m.id}`}>
                          {m.status === "RESOLVED" ? "Match report" : "Match centre"}
                          <ArrowUpRight size={16} aria-hidden="true" />
                        </a>
                        {open(m) && !isOwn ? (
                          <div
                            className="odds-row"
                            aria-label={`Match result odds for ${m.homeTeam.name} versus ${m.awayTeam.name}`}
                          >
                            {m.quotes
                              .filter((q) => q.market === "MATCH_RESULT")
                              .sort(
                                (a, b) =>
                                  ["HOME", "DRAW", "AWAY"].indexOf(a.selection) -
                                  ["HOME", "DRAW", "AWAY"].indexOf(b.selection),
                              )
                              .map((q) => (
                                <button
                                  key={q.selection}
                                  disabled={busy}
                                  aria-pressed={
                                    selection?.matchId === m.id &&
                                    selection.market === q.market &&
                                    selection.selection === q.selection
                                  }
                                  aria-label={`${selectionName(q.selection, m)}, odds ${Number(q.odds).toFixed(2)}`}
                                  onClick={() => choose(m, q)}
                                >
                                  <span>
                                    {q.selection === "HOME"
                                      ? "1"
                                      : q.selection === "AWAY"
                                        ? "2"
                                        : "X"}
                                  </span>
                                  <strong>{Number(q.odds).toFixed(2)}</strong>
                                </button>
                              ))}
                            <button
                              className="more-markets"
                              disabled={busy || !m.quotes.length}
                              onClick={() => {
                                const q = m.quotes[0];
                                if (q) choose(m, q);
                              }}
                            >
                              All markets
                            </button>
                          </div>
                        ) : (
                          <span className="muted">
                            {isOwn
                              ? "Your club · betting unavailable"
                              : m.status === "RESOLVED"
                                ? "Result confirmed"
                                : "Bets locked"}
                          </span>
                        )}
                      </div>
                      {active.length > 0 && (
                        <a className="active-bet" href="#/bets">
                          <Ticket size={14} aria-hidden="true" />
                          {active.length} active {active.length === 1 ? "bet" : "bets"} ·{" "}
                          {coins(active.reduce((sum, b) => sum + b.stake, 0))} coins staked
                        </a>
                      )}
                    </article>
                  );
                })}
                {!matches.length && <Notice>No fixtures in this view. Try All fixtures.</Notice>}
              </div>
            </section>
            <aside
              className={`bet-slip ${selection || receipt ? "has-selection" : ""}`}
              ref={slip}
              tabIndex={-1}
              aria-label="Bet slip"
            >
              <div className="section-heading">
                <h2>{receipt ? "Bet accepted" : "Your bet slip"}</h2>
                {selection && (
                  <button
                    className="icon-button"
                    aria-label="Clear selection"
                    disabled={busy}
                    onClick={() => setSelection(null)}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
              {receipt ? (
                <div className="bet-receipt" role="status">
                  <Check size={22} aria-hidden="true" />
                  <h3>{receipt.fixture}</h3>
                  <p>
                    {MARKET_REGISTRY[receipt.market].label}
                    <br />
                    <strong>{receipt.choice}</strong>
                  </p>
                  <dl>
                    <div>
                      <dt>Stake</dt>
                      <dd>{coins(receipt.stake)} coins</dd>
                    </div>
                    <div>
                      <dt>Accepted odds</dt>
                      <dd>{Number(receipt.oddsTaken).toFixed(4)}</dd>
                    </div>
                    <div>
                      <dt>Possible return</dt>
                      <dd>{coins(receipt.potentialPayout)} coins</dd>
                    </div>
                    <div>
                      <dt>Confirmed wallet balance</dt>
                      <dd>{coins(receipt.coinBalance)} coins</dd>
                    </div>
                  </dl>
                  <small>Receipt {receipt.betId}</small>
                  <a className="button-link" href="#/bets">
                    View my bets
                  </a>
                </div>
              ) : selection && match ? (
                <form className="form" onSubmit={place}>
                  <p className="slip-fixture">
                    {match.homeTeam.name}
                    <span>v {match.awayTeam.name}</span>
                  </p>
                  <label>
                    Market & selection
                    <select
                      value={`${selection.market}:${selection.selection}`}
                      disabled={busy}
                      onChange={(e) => {
                        const q = match.quotes.find(
                          (q) => `${q.market}:${q.selection}` === e.target.value,
                        );
                        if (q) setSelection({ matchId: match.id, ...q });
                        setBetError("");
                      }}
                    >
                      {Object.values(MARKET_REGISTRY).map((m) => (
                        <optgroup label={m.label} key={m.code}>
                          {match.quotes
                            .filter((q) => q.market === m.code)
                            .map((q) => (
                              <option key={q.selection} value={`${q.market}:${q.selection}`}>
                                {selectionName(q.selection, match)} · {Number(q.odds).toFixed(2)}
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
                      inputMode="numeric"
                      min={1}
                      max={1_000_000}
                      step={1}
                      value={stake}
                      disabled={busy}
                      onChange={(e) => setStake(e.target.value)}
                      required
                    />
                  </label>
                  <dl className="slip-totals">
                    <div>
                      <dt>Odds</dt>
                      <dd>{Number(selection.odds).toFixed(4)}</dd>
                    </div>
                    <div>
                      <dt>Possible return</dt>
                      <dd>{coins(possible)} coins</dd>
                    </div>
                    <div>
                      <dt>Balance after bet</dt>
                      <dd>
                        {user && valid && amount <= user.coinBalance
                          ? `${coins(user.coinBalance - amount)} coins`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  {changed && (
                    <Notice>
                      Odds changed to {Number(quote!.odds).toFixed(4)}.{" "}
                      <button
                        type="button"
                        onClick={() => setSelection({ ...selection, odds: quote!.odds })}
                      >
                        Review new odds
                      </button>
                    </Notice>
                  )}
                  {!open(match) && <Notice>Betting has closed for this fixture.</Notice>}
                  {own && <Notice>Managers cannot bet on their own club.</Notice>}
                  {user && amount > user.coinBalance && (
                    <Notice>Not enough coins. Available balance: {coins(user.coinBalance)}.</Notice>
                  )}
                  <ErrorBox message={betError} />
                  {retrying && (
                    <p className="muted">
                      Retry checks the same request. It cannot place that bet twice.
                    </p>
                  )}
                  {user ? (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !valid ||
                        (!retrying && (amount > user.coinBalance || !open(match) || own || changed))
                      }
                    >
                      {busy
                        ? "Confirming bet…"
                        : retrying
                          ? "Retry confirmation"
                          : `Confirm ${valid ? coins(amount) : ""} coin bet`}
                    </button>
                  ) : (
                    <a className="primary button-link" href="#/login">
                      Sign in to place this bet
                    </a>
                  )}
                  <small className="muted">
                    Possible return includes your stake. Virtual coins only.
                  </small>
                </form>
              ) : (
                <div className="empty-slip">
                  <Ticket size={28} strokeWidth={1.3} aria-hidden="true" />
                  <p>Select odds from a fixture.</p>
                  <small>
                    Review the market, stake and possible return here before you confirm.
                  </small>
                </div>
              )}
              {!selection && !receipt && (
                <div className="slip-note">
                  <h3>A level playing field</h3>
                  <p>You can bet on other clubs. Your own club’s fixtures stay off limits.</p>
                  <a href={user ? "#/my-team" : "#/teams"}>
                    {user?.teamId ? "Open Manager Room" : "Find your club"}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                </div>
              )}
            </aside>
          </div>
        </>
      ) : (
        !loading &&
        !error && (
          <Notice>
            The next round opens Monday at 09:00 Madrid time.{" "}
            <a href="#/teams">Explore the clubs</a>.
          </Notice>
        )
      )}
    </>
  );
}
