import {
  HALFTIME_STEPS,
  LIVE_ENGINE_VERSION,
  SIMULATION_SECONDS_PER_STEP,
  FORMATION_TEMPLATES,
  type LiveEvent,
  type LiveEventType,
  type LivePlayer,
  type LiveStats,
  type LiveTeamState,
  type MatchResultPayload,
  type MatchSide,
  type SimulationInput,
  type SimulationPlayer,
  type SimulationState,
  type SimulationTeam,
} from "@ffb/football";

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
// Checkpoints cross PostgreSQL JSON and JavaScript number parsers. Quantize at
// EVERY logical step, not just persistence, so batch size cannot alter a draw.
const precise = (n: number) => Math.round(n * 10_000) / 10_000;
const emptyStats = (): LiveStats => ({
  goals: 0,
  shots: 0,
  shotsOnTarget: 0,
  saves: 0,
  corners: 0,
  fouls: 0,
  offsides: 0,
  yellows: 0,
  reds: 0,
  cards: 0,
  possessionSeconds: 0,
});
const other = (side: MatchSide): MatchSide => (side === "HOME" ? "AWAY" : "HOME");
const teamState = (state: SimulationState, side: MatchSide) =>
  side === "HOME" ? state.home : state.away;
const teamInput = (input: SimulationInput, side: MatchSide) =>
  side === "HOME" ? input.home : input.away;

export function validateSimulationInput(input: SimulationInput): void {
  if (input.version !== LIVE_ENGINE_VERSION)
    throw new Error(`Unsupported simulation version: ${input.version}`);
  if (input.home.id === input.away.id) throw new Error("A match requires two different teams");
  const allIds = new Set<string>();
  for (const team of [input.home, input.away]) {
    const starters = team.players.filter((p) => p.slotKey !== null);
    const bench = team.players.filter((p) => p.slotKey === null);
    const template = FORMATION_TEMPLATES[team.formation];
    if (
      !template ||
      starters.length !== 11 ||
      bench.length !== 7 ||
      starters.filter((p) => p.position === "GK").length !== 1 ||
      bench.filter((p) => p.position === "GK").length !== 1 ||
      template.some((slot) => starters.filter((p) => p.slotKey === slot.key).length !== 1)
    ) {
      throw new Error(`Invalid frozen matchday squad for ${team.name}`);
    }
    if (!Number.isFinite(team.strength) || team.strength < 1 || team.strength > 100)
      throw new Error("Invalid strength");
    for (const player of team.players) {
      if (allIds.has(player.id)) throw new Error("Duplicate simulation player");
      allIds.add(player.id);
      const keys =
        player.position === "GK"
          ? ["diving", "handling", "kicking", "reflexes", "speed", "positioning"]
          : ["pace", "shooting", "passing", "dribbling", "defending", "physical"];
      if (
        !Number.isFinite(player.overall) ||
        player.overall < 1 ||
        player.overall > 99 ||
        keys.some(
          (key) =>
            !Number.isInteger(player.attributes[key]) ||
            player.attributes[key]! < 1 ||
            player.attributes[key]! > 99,
        )
      ) {
        throw new Error(`Incomplete frozen attributes for ${player.id}`);
      }
    }
  }
}

export function initializeSimulation(input: SimulationInput, seed: string): SimulationState {
  validateSimulationInput(input);
  let randomState = 2166136261;
  for (let i = 0; i < seed.length; i++)
    randomState = Math.imul(randomState ^ seed.charCodeAt(i), 16777619) >>> 0;
  const initializeTeam = (team: SimulationTeam): LiveTeamState => ({
    players: team.players.map((p) => ({
      id: p.id,
      name: p.name,
      shirtNumber: p.shirtNumber,
      position: p.position,
      slotKey: p.slotKey,
      unit: p.unit,
      status: p.slotKey ? "ACTIVE" : "BENCH",
      energy: 100,
      yellows: 0,
      injured: false,
      goals: 0,
    })),
    stats: emptyStats(),
    mentality: "BALANCED",
    substitutions: 0,
    substitutionWindows: 0,
    lastSubstitutionSecond: -1000,
  });
  return {
    phase: "PENDING",
    period: 1,
    second: 0,
    step: 0,
    sequence: 0,
    randomState,
    halftimeSteps: 0,
    addedMinutes: [0, 0],
    interruptionSeconds: 0,
    possession: "HOME",
    zone: 1,
    ball: { x: 50, y: 50, playerId: null },
    pressure: 50,
    home: initializeTeam(input.home),
    away: initializeTeam(input.away),
    lastEvent: null,
  };
}

/** Mulberry32 with explicit state: neither batch timing nor retries affect draws. */
function random(state: SimulationState): number {
  state.randomState = (state.randomState + 0x6d2b79f5) >>> 0;
  let value = state.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function pick<T>(state: SimulationState, values: T[]): T {
  if (!values.length) throw new Error("No eligible simulation participant");
  return values[Math.floor(random(state) * values.length)]!;
}

function active(team: LiveTeamState): LivePlayer[] {
  return team.players.filter((p) => p.status === "ACTIVE");
}
function source(input: SimulationTeam, player: LivePlayer): SimulationPlayer {
  return input.players.find((p) => p.id === player.id)!;
}
function ability(input: SimulationTeam, player: LivePlayer, key: string): number {
  const p = source(input, player);
  const originalPenalty = Math.max(0, p.overall - (p.attributes[key] ?? p.overall));
  return (
    (p.attributes[key] ?? p.overall) -
    (100 - player.energy) * 0.11 -
    (player.injured ? 12 : 0) -
    (p.slotKey && p.unit !== player.unit ? Math.min(originalPenalty, 4) : 0)
  );
}
function mean(input: SimulationTeam, team: LiveTeamState, key: string): number {
  const players = active(team).filter((p) => p.unit !== "GK");
  return players.reduce((total, p) => total + ability(input, p, key), 0) / players.length;
}

function emit(
  state: SimulationState,
  events: LiveEvent[],
  type: LiveEventType,
  side: MatchSide | null,
  player: LivePlayer | null,
  text: string,
  related: LivePlayer | null = null,
  outcome?: LiveEvent["outcome"],
): void {
  const event: LiveEvent = {
    sequence: ++state.sequence,
    step: state.step,
    actionId: `action-${state.step}`,
    period: state.period,
    second: state.second,
    type,
    side,
    playerId: player?.id ?? null,
    relatedPlayerId: related?.id ?? null,
    text,
    important: !["PASS", "TURNOVER", "ATTACK", "FOUL"].includes(type),
    ...(outcome ? { outcome } : {}),
  };
  events.push(event);
  state.lastEvent = event;
}

function restart(state: SimulationState, side: MatchSide, zone = 0): void {
  state.possession = side;
  state.zone = zone;
  state.ball = { x: side === "HOME" ? 20 + zone * 19 : 80 - zone * 19, y: 50, playerId: null };
}

function takeCorner(
  state: SimulationState,
  events: LiveEvent[],
  input: SimulationInput,
  side: MatchSide,
): void {
  const team = teamState(state, side);
  const outfield = active(team).filter((p) => p.unit !== "GK");
  const preferred = outfield.filter((p) => p.unit !== "DEF");
  const taker = pick(state, preferred.length ? preferred : outfield);
  team.stats.corners++;
  state.possession = side;
  state.zone = 3;
  state.ball = { x: side === "HOME" ? 98 : 2, y: random(state) < 0.5 ? 3 : 97, playerId: taker.id };
  emit(
    state,
    events,
    "CORNER",
    side,
    taker,
    `${teamInput(input, side).name} win a corner. ${taker.name} will deliver.`,
  );
}

function substitute(
  input: SimulationInput,
  state: SimulationState,
  events: LiveEvent[],
  side: MatchSide,
  forced?: LivePlayer,
): boolean {
  const team = teamState(state, side);
  const frozen = teamInput(input, side);
  const atHalf = state.phase === "HALFTIME";
  const sameWindow = team.lastSubstitutionSecond === state.second;
  if (team.substitutions >= 5 || (!atHalf && !sameWindow && team.substitutionWindows >= 3))
    return false;
  const candidates = (forced ? [forced] : active(team).filter((p) => p.unit !== "GK")).sort(
    (a, b) =>
      a.energy -
      (a.injured ? 50 : 0) -
      a.yellows * 5 -
      (b.energy - (b.injured ? 50 : 0) - b.yellows * 5),
  );
  for (const outgoing of candidates) {
    const template = FORMATION_TEMPLATES[frozen.formation].find((s) => s.key === outgoing.slotKey);
    if (!template) continue;
    const reserves = team.players
      .filter(
        (p) =>
          p.status === "BENCH" &&
          (outgoing.unit === "GK"
            ? p.position === "GK"
            : p.position !== "GK" &&
              (p.unit === outgoing.unit ||
                source(frozen, p).secondaryPositions.includes(template.position))),
      )
      .sort(
        (a, b) => source(frozen, b).overall - source(frozen, a).overall || a.id.localeCompare(b.id),
      );
    const incoming = reserves[0];
    if (!incoming) continue;
    outgoing.status = "REPLACED";
    incoming.status = "ACTIVE";
    incoming.slotKey = outgoing.slotKey;
    incoming.unit = outgoing.unit;
    team.substitutions++;
    if (!atHalf && !sameWindow) team.substitutionWindows++;
    team.lastSubstitutionSecond = state.second;
    if (!atHalf) state.interruptionSeconds += 25;
    if (state.ball.playerId === outgoing.id) state.ball.playerId = incoming.id;
    emit(
      state,
      events,
      "SUBSTITUTION",
      side,
      incoming,
      `${incoming.name} replaces ${outgoing.name}${outgoing.injured ? " after the injury" : ". Fresh legs for the closing stages"}.`,
      outgoing,
    );
    return true;
  }
  return false;
}

function manageTeams(input: SimulationInput, state: SimulationState, events: LiveEvent[]): void {
  for (const side of ["HOME", "AWAY"] as const) {
    const team = teamState(state, side);
    const opponent = teamState(state, other(side));
    team.mentality =
      state.second >= 3600 && team.stats.goals < opponent.stats.goals
        ? "ATTACKING"
        : state.second >= 4200 && team.stats.goals > opponent.stats.goals
          ? "CAUTIOUS"
          : "BALANCED";
    if (
      state.second >= 3300 &&
      state.second - team.lastSubstitutionSecond >= 600 &&
      active(team).some((p) => p.unit !== "GK" && p.energy < 77)
    ) {
      substitute(input, state, events, side);
      if (state.second >= 4200) substitute(input, state, events, side);
    }
  }
}

function discipline(
  input: SimulationInput,
  state: SimulationState,
  events: LiveEvent[],
  side: MatchSide,
): void {
  const team = teamState(state, side);
  const candidates = active(team).filter((p) => p.unit !== "GK");
  const player = pick(state, candidates);
  team.stats.fouls++;
  state.interruptionSeconds += 3;
  emit(
    state,
    events,
    "FOUL",
    side,
    player,
    `${player.name} is penalised. A free kick to ${teamInput(input, other(side)).name}.`,
  );
  if (random(state) < 0.17) {
    // Abandonment is outside v1: never generate a dismissal below seven active players.
    const mayDismiss = active(team).length > 7;
    if (mayDismiss && random(state) < 0.018) {
      player.status = "DISMISSED";
      team.stats.reds++;
      team.stats.cards++;
      state.interruptionSeconds += 40;
      emit(state, events, "RED_CARD", side, player, `Straight red! ${player.name} is sent off.`);
    } else if (player.yellows === 0 || mayDismiss) {
      player.yellows++;
      team.stats.yellows++;
      team.stats.cards++;
      state.interruptionSeconds += 15;
      emit(
        state,
        events,
        "YELLOW_CARD",
        side,
        player,
        `${player.name} receives ${player.yellows === 2 ? "a second" : "a"} yellow card.`,
      );
      if (player.yellows === 2) {
        player.status = "DISMISSED";
        team.stats.reds++;
        emit(
          state,
          events,
          "RED_CARD",
          side,
          player,
          `Two yellows! ${player.name} must leave the pitch.`,
        );
      }
    }
  }
  if (state.ball.playerId === player.id && player.status !== "ACTIVE") state.ball.playerId = null;
}

function play(input: SimulationInput, state: SimulationState, events: LiveEvent[]): void {
  const side = state.possession;
  const defendingSide = other(side);
  const attack = teamState(state, side);
  const defense = teamState(state, defendingSide);
  const attackingInput = teamInput(input, side);
  const defendingInput = teamInput(input, defendingSide);
  attack.stats.possessionSeconds += SIMULATION_SECONDS_PER_STEP;
  const attackerPool = active(attack).filter((p) => p.unit !== "GK");
  const preferred = attackerPool.filter((p) =>
    state.zone >= 2 ? p.unit === "ATT" || p.unit === "MID" : p.unit !== "ATT",
  );
  const carrier = pick(state, preferred.length ? preferred : attackerPool);
  state.ball = {
    x: side === "HOME" ? 20 + state.zone * 22 : 80 - state.zone * 22,
    y: 16 + random(state) * 68,
    playerId: carrier.id,
  };
  const passDifference =
    (ability(attackingInput, carrier, "passing") + ability(attackingInput, carrier, "dribbling")) /
      2 -
    mean(defendingInput, defense, "defending");
  const manpower = (active(attack).length - active(defense).length) * 0.022;
  const action = random(state);

  if (action < 0.022) {
    discipline(input, state, events, defendingSide);
    return;
  }
  if (action < 0.025 && state.zone >= 2) {
    attack.stats.offsides++;
    emit(
      state,
      events,
      "OFFSIDE",
      side,
      carrier,
      `The flag is up. ${carrier.name} moved a fraction too early.`,
    );
    restart(state, defendingSide);
    return;
  }
  if (action >= 0.025 && action < 0.0253 && active(attack).length > 7) {
    carrier.injured = true;
    carrier.energy = Math.max(15, carrier.energy - 18);
    state.interruptionSeconds += 50;
    emit(
      state,
      events,
      "INJURY",
      side,
      carrier,
      `${carrier.name} needs treatment. The bench is getting ready.`,
    );
    if (!substitute(input, state, events, side, carrier)) {
      carrier.status = "WITHDRAWN";
      state.ball.playerId = null;
    }
    return;
  }
  const turnoverChance = clamp(
    0.21 - passDifference * 0.00035 - manpower + (attack.mentality === "ATTACKING" ? 0.02 : 0),
    0.08,
    0.42,
  );
  if (action < 0.0253 + turnoverChance) {
    if (state.zone >= 2 && random(state) < 0.04) {
      takeCorner(state, events, input, side);
      return;
    }
    emit(
      state,
      events,
      "TURNOVER",
      defendingSide,
      null,
      `${defendingInput.name} recover possession and look to break.`,
    );
    restart(state, defendingSide, Math.max(0, 2 - state.zone));
    return;
  }

  if (
    state.zone === 3 &&
    random(state) <
      0.105 * (attack.mentality === "ATTACKING" ? 1.13 : attack.mentality === "CAUTIOUS" ? 0.88 : 1)
  ) {
    const forwards = attackerPool.filter((p) => p.unit === "ATT");
    const shooter = random(state) < 0.68 && forwards.length ? pick(state, forwards) : carrier;
    const keeper = active(defense).find((p) => p.unit === "GK")!;
    const shooting = ability(attackingInput, shooter, "shooting");
    const keeping =
      (ability(defendingInput, keeper, "reflexes") +
        ability(defendingInput, keeper, "positioning")) /
      2;
    const homeBias = side === "HOME" ? 1.18 : 0.84;
    const goalChance = clamp(
      0.084 * homeBias + (shooting - keeping) * 0.0005 + manpower * 0.4,
      0.025,
      0.38,
    );
    const outcomeDraw = random(state);
    const outcome =
      outcomeDraw < goalChance
        ? "GOAL"
        : outcomeDraw < 0.4
          ? "SAVED"
          : outcomeDraw < 0.66
            ? "BLOCK"
            : "MISS";
    attack.stats.shots++;
    if (outcome === "SAVED" || outcome === "GOAL") attack.stats.shotsOnTarget++;
    state.ball = { x: side === "HOME" ? 99 : 1, y: 44 + random(state) * 12, playerId: shooter.id };
    emit(
      state,
      events,
      "SHOT",
      side,
      shooter,
      `${shooter.name} takes the shot${outcome === "MISS" ? " — just wide!" : outcome === "BLOCK" ? " — blocked!" : "!"}`,
      null,
      outcome,
    );
    if (outcome === "GOAL") {
      attack.stats.goals++;
      shooter.goals++;
      state.interruptionSeconds += 25;
      emit(
        state,
        events,
        "GOAL",
        side,
        shooter,
        `GOAL! ${shooter.name} finds the net for ${attackingInput.name}!`,
      );
      restart(state, defendingSide, 1);
    } else if (outcome === "SAVED") {
      defense.stats.saves++;
      emit(state, events, "SAVE", defendingSide, keeper, `${keeper.name} makes the save!`, shooter);
      if (random(state) < 0.22) takeCorner(state, events, input, side);
      else restart(state, defendingSide);
    } else if (outcome === "BLOCK" && random(state) < 0.28) takeCorner(state, events, input, side);
    else restart(state, defendingSide);
    return;
  }

  if (random(state) < 0.48 + passDifference * 0.0002 + manpower)
    state.zone = Math.min(3, state.zone + 1);
  const recipientPool = attackerPool.filter((p) => p.id !== carrier.id);
  const recipient = pick(state, recipientPool);
  state.ball.playerId = recipient.id;
  // Persist concise possession commentary periodically; animation still uses every state.
  if (state.step % 8 === 0 || (state.zone === 3 && state.step % 5 === 0)) {
    emit(
      state,
      events,
      state.zone === 3 ? "ATTACK" : "PASS",
      side,
      recipient,
      state.zone === 3
        ? `${attackingInput.name} are building pressure. ${recipient.name} looks for an opening.`
        : `${carrier.name} finds ${recipient.name} as ${attackingInput.name} work the ball forward.`,
      carrier,
    );
  }
}

/** One logical step. Never mutate the caller's checkpoint. */
export function stepSimulation(
  input: SimulationInput,
  previous: SimulationState,
): { state: SimulationState; events: LiveEvent[] } {
  if (input.version !== LIVE_ENGINE_VERSION) throw new Error("Unsupported simulation version");
  if (previous.phase === "FINISHED") return { state: previous, events: [] };
  const state = structuredClone(previous);
  const events: LiveEvent[] = [];
  state.step++;
  if (state.phase === "PENDING") {
    state.phase = "LIVE";
    emit(state, events, "KICKOFF", "HOME", null, "The whistle goes. We are underway!");
    return { state, events };
  }
  if (state.phase === "HALFTIME") {
    if (++state.halftimeSteps >= HALFTIME_STEPS) {
      state.phase = "LIVE";
      state.period = 2;
      state.second = 2700;
      state.interruptionSeconds = 0;
      restart(state, "AWAY", 1);
      emit(
        state,
        events,
        "SECOND_HALF_KICKOFF",
        "AWAY",
        null,
        "Back underway for the second half.",
      );
    }
    return { state, events };
  }
  state.second += SIMULATION_SECONDS_PER_STEP;
  for (const side of ["HOME", "AWAY"] as const) {
    const team = teamState(state, side);
    const frozen = teamInput(input, side);
    for (const player of active(team)) {
      const endurance = source(frozen, player).attributes.physical ?? 80;
      const depletion =
        (player.unit === "GK" ? 0.008 : 0.036 + (80 - endurance) * 0.0003) *
        (team.mentality === "ATTACKING" ? 1.15 : 1);
      player.energy = precise(Math.max(15, player.energy - depletion));
    }
  }
  if (state.second % 60 === 0) manageTeams(input, state, events);
  play(input, state, events);
  const pressureTarget = state.possession === "HOME" ? 55 + state.zone * 12 : 45 - state.zone * 12;
  state.pressure = precise(clamp(state.pressure * 0.95 + pressureTarget * 0.05, 8, 92));
  state.ball.x = precise(state.ball.x);
  state.ball.y = precise(state.ball.y);
  const normalEnd = state.period === 1 ? 2700 : 5400;
  if (state.second >= normalEnd && state.addedMinutes[state.period - 1] === 0) {
    const added = clamp(
      Math.ceil(state.interruptionSeconds / 60) + 1,
      1,
      state.period === 1 ? 5 : 8,
    );
    state.addedMinutes[state.period - 1] = added;
    emit(state, events, "ADDED_TIME", null, null, `${added} minutes of added time.`);
  }
  // Added time is fixed when announced in v1; new stoppages do not recursively extend it.
  if (state.second >= normalEnd + state.addedMinutes[state.period - 1]! * 60) {
    if (state.period === 1) {
      state.phase = "HALFTIME";
      for (const side of ["HOME", "AWAY"] as const) {
        for (const player of active(teamState(state, side)))
          player.energy = precise(Math.min(100, player.energy + 5));
        const atRisk = active(teamState(state, side)).find(
          (p) => p.unit !== "GK" && (p.injured || p.yellows > 0),
        );
        if (atRisk && random(state) < 0.5) substitute(input, state, events, side, atRisk);
      }
      emit(
        state,
        events,
        "HALFTIME",
        null,
        null,
        "Half time. A moment to regroup in the dressing room.",
      );
    } else {
      state.phase = "FINISHED";
      state.ball.playerId = null;
      emit(
        state,
        events,
        "FULL_TIME",
        null,
        null,
        `Full time! ${input.home.name} ${state.home.stats.goals}–${state.away.stats.goals} ${input.away.name}.`,
      );
    }
  }
  return { state, events };
}

export function simulationResult(state: SimulationState): MatchResultPayload {
  if (state.phase !== "FINISHED") throw new Error("Cannot settle before full time");
  return {
    homeScore: state.home.stats.goals,
    awayScore: state.away.stats.goals,
    homeCards: state.home.stats.cards,
    awayCards: state.away.stats.cards,
    homeCorners: state.home.stats.corners,
    awayCorners: state.away.stats.corners,
  };
}
