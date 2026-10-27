import { FORMATION_PITCH_ROWS, isFormation } from "./formations.js";
import type { LiveEvent, MatchCenterDto, MatchPhase } from "./live.js";

export interface PitchPoint {
  x: number;
  y: number;
}
export interface PitchActor extends PitchPoint {
  id: string;
  slot: string;
}
export interface PitchLayout {
  revision: number;
  sequence: number;
  phase: MatchPhase;
  players: PitchActor[];
  ball: PitchPoint;
  carrierId?: string | null;
  attackDirection?: 1 | -1;
  shot?: LiveEvent | undefined;
}
interface MovingPoint extends PitchPoint {
  vx: number;
  vy: number;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const moving = (point: PitchPoint): MovingPoint => ({ ...point, vx: 0, vy: 0 });

/** Presentation only. Player shapes follow play; carriers never jump to a ball coordinate. */
export function pitchLayout(match: MatchCenterDto): PitchLayout {
  const live = match.live;
  const ball = live?.ball ?? { x: 50, y: 50, playerId: null };
  const players: PitchActor[] = [];
  for (const side of ["home", "away"] as const) {
    const home = side === "home";
    const team = home ? match.homeTeam : match.awayTeam;
    const rows =
      FORMATION_PITCH_ROWS[
        team.formation && isFormation(team.formation) ? team.formation : "4-3-3"
      ];
    const hasBall = live?.possession === (home ? "HOME" : "AWAY");
    for (const player of live?.[side].players ?? []) {
      if (player.status !== "ACTIVE") continue;
      const rowIndex = Math.max(
        0,
        rows.findIndex((row) => (row as readonly string[]).includes(player.slotKey ?? "")),
      );
      const row = rows[rowIndex]!;
      const col = Math.max(0, (row as readonly string[]).indexOf(player.slotKey ?? ""));
      const baseX = 12 + (rows.length - 1 - rowIndex) * 16;
      const drift =
        player.unit === "GK" ? 0 : (hasBall ? 7 : -3) + (ball.x - 50) * (home ? 0.12 : -0.12);
      let x = home ? baseX + drift : 100 - baseX - drift;
      let y = (100 * (col + 1)) / (row.length + 1) + (ball.y - 50) * 0.12;
      if (ball.playerId === player.id && player.unit !== "GK") {
        x += clamp((ball.x - x) * 0.3, -9, 9);
        y += clamp((ball.y - y) * 0.2, -6, 6);
      }
      players.push({
        id: player.id,
        slot: `${side}:${player.slotKey}`,
        x: 60 + clamp(x, 5, 95) * 8.8,
        y: 50 + clamp(y, 5, 95) * 5.2,
      });
    }
  }
  const carrier = players.find((player) => player.id === ball.playerId);
  return {
    revision: live?.revision ?? -1,
    sequence: live?.latestSequence ?? 0,
    phase: live?.phase ?? "PENDING",
    players,
    carrierId: ball.playerId,
    attackDirection: live?.possession === "AWAY" ? -1 : 1,
    ball: carrier
      ? { x: carrier.x + (live?.possession === "HOME" ? 15 : -15), y: carrier.y + 5 }
      : { x: 60 + ball.x * 8.8, y: 50 + ball.y * 5.2 },
    shot: live ? [...live.events].reverse().find((event) => event.type === "SHOT") : undefined,
  };
}

/** Critically damped motion with a speed cap; retargeting preserves position and velocity. */
function integrate(
  body: MovingPoint,
  target: PitchPoint,
  seconds: number,
  speed: number,
  frequency: number,
) {
  const slices = Math.max(1, Math.ceil(seconds / 0.008));
  const dt = seconds / slices;
  for (let i = 0; i < slices; i++) {
    body.vx += ((target.x - body.x) * frequency ** 2 - 2 * frequency * body.vx) * dt;
    body.vy += ((target.y - body.y) * frequency ** 2 - 2 * frequency * body.vy) * dt;
    const magnitude = Math.hypot(body.vx, body.vy);
    if (magnitude > speed) {
      body.vx *= speed / magnitude;
      body.vy *= speed / magnitude;
    }
    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }
}

export class PitchMotion {
  readonly players = new Map<string, MovingPoint>();
  ball: MovingPoint;
  ballRotation = 0;
  readonly trail: PitchPoint[] = [];
  private shotUntil = 0;
  private shotTarget: PitchPoint | undefined;

  private layout: PitchLayout;
  constructor(layout: PitchLayout) {
    this.layout = layout;
    for (const player of layout.players) this.players.set(player.id, moving(player));
    this.ball = moving(layout.ball);
  }

  retarget(next: PitchLayout, now: number, animateEvents = true) {
    if (next.revision < this.layout.revision) return;
    for (const player of next.players) {
      if (this.players.has(player.id)) continue;
      // A substitute inherits the outgoing player's position, not the centre spot.
      const previous = this.layout.players.find((old) => old.slot === player.slot);
      this.players.set(player.id, moving((previous && this.players.get(previous.id)) || player));
    }
    const active = new Set(next.players.map((p) => p.id));
    for (const id of this.players.keys()) if (!active.has(id)) this.players.delete(id);
    // Only animate a newly committed shot, never a historical shot after joining.
    if (!animateEvents) this.shotTarget = undefined;
    if (
      animateEvents &&
      next.shot &&
      next.shot.sequence > this.layout.sequence &&
      next.phase === "LIVE"
    ) {
      this.shotTarget = {
        x: next.shot.side === "HOME" ? 950 : 50,
        y: next.shot.outcome === "MISS" ? 395 : 310,
      };
      this.shotUntil = now + 700;
    }
    this.layout = next;
  }

  snap() {
    for (const player of this.layout.players) this.players.set(player.id, moving(player));
    this.ball = moving(this.layout.ball);
    this.trail.length = 0;
    this.shotTarget = undefined;
  }

  advance(elapsedMs: number, now: number) {
    // A suspended tab never catches up by teleporting all actors in one frame.
    const dt = clamp(elapsedMs, 0, 50) / 1000;
    for (const target of this.layout.players)
      integrate(this.players.get(target.id)!, target, dt, 95, 8);
    const carrier = this.players.get(this.layout.carrierId ?? "");
    const target = carrier
      ? { x: carrier.x + (this.layout.attackDirection ?? 1) * 15, y: carrier.y + 5 }
      : this.layout.ball;
    const before = { x: this.ball.x, y: this.ball.y };
    integrate(
      this.ball,
      this.shotTarget && now < this.shotUntil ? this.shotTarget : target,
      dt,
      900,
      12,
    );
    this.ballRotation =
      (this.ballRotation + Math.hypot(this.ball.x - before.x, this.ball.y - before.y) * 9) % 360;
    this.trail.push({ x: this.ball.x, y: this.ball.y });
    if (this.trail.length > 12) this.trail.shift();
  }
}
