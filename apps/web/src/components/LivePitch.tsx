import { useEffect, useRef } from "react";
import {
  pitchLayout,
  PitchMotion,
  type MatchCenterDto,
  type LiveMatchSnapshot,
} from "@ffb/football";
import type { MatchCenter } from "@ffb/contracts";
export function LivePitch({ data }: { data: MatchCenter }) {
  const svg = useRef<SVGSVGElement>(null),
    motion = useRef<PitchMotion | null>(null);
  useEffect(() => {
    const now = new Date().toISOString(),
      m = data.match,
      l = data.live;
    const live: LiveMatchSnapshot | null = l
      ? {
          ...l,
          matchId: m.id,
          revision: m.revision,
          latestSequence: l.sequence,
          startedAt: m.scheduledAt,
          observedAt: now,
          serverTime: now,
          settled: m.status === "RESOLVED",
          homeScore: l.home.stats.goals,
          awayScore: l.away.stats.goals,
          events: data.events,
        }
      : null;
    const team = (t: typeof m.homeTeam, side: "home" | "away") => ({
      ...t,
      formation: data.formations[side],
    });
    const dto: MatchCenterDto = {
      id: m.id,
      roundId: m.roundId,
      weekNumber: m.weekNumber,
      scheduledAt: m.scheduledAt,
      stadiumName: m.homeTeam.stadiumName,
      homeTeam: team(m.homeTeam, "home"),
      awayTeam: team(m.awayTeam, "away"),
      live,
      result: m.result,
      supportsLive: true,
    };
    const layout = pitchLayout(dto);
    if (!motion.current) motion.current = new PitchMotion(layout);
    else motion.current.retarget(layout, performance.now());
  }, [data]);
  useEffect(() => {
    let frame = 0,
      previous = performance.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    function paint(now: number) {
      const engine = motion.current;
      if (engine && svg.current) {
        if (reduced.matches) engine.snap();
        else engine.advance(now - previous, now);
        for (const [id, point] of engine.players) {
          const node = [...svg.current.querySelectorAll<SVGGElement>("[data-player]")].find(
            (n) => n.dataset.player === id,
          );
          node?.setAttribute("transform", `translate(${point.x},${point.y})`);
        }
        svg.current
          .querySelector("[data-ball]")
          ?.setAttribute("transform", `translate(${engine.ball.x},${engine.ball.y})`);
      }
      previous = now;
      frame = requestAnimationFrame(paint);
    }
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <svg
      ref={svg}
      className="pitch"
      viewBox="0 0 1000 620"
      role="img"
      aria-label="Live match pitch showing player and ball movement"
    >
      <defs>
        <pattern id="grass" width="110" height="620" patternUnits="userSpaceOnUse">
          <rect width="55" height="620" fill="#184e3b" />
          <rect x="55" width="55" height="620" fill="#1d5942" />
        </pattern>
      </defs>
      <rect width="1000" height="620" rx="16" fill="url(#grass)" />
      <g stroke="#b5d1be" strokeWidth="2" opacity=".7" fill="none">
        <rect x="60" y="50" width="880" height="520" />
        <path d="M500 50V570" />
        <circle cx="500" cy="310" r="73" />
        <path d="M60 160H190V460H60M940 160H810V460H940M60 245H105V375H60M940 245H895V375H940" />
      </g>
      {data.live &&
        (["home", "away"] as const).flatMap((side) =>
          data
            .live![side].players.filter((p) => p.status === "ACTIVE")
            .map((p) => (
              <g key={p.id} data-player={p.id} transform="translate(500,310)">
                <circle
                  r="16"
                  fill={
                    side === "home"
                      ? data.match.homeTeam.primaryColor
                      : data.match.awayTeam.primaryColor
                  }
                  stroke="white"
                  strokeWidth="2"
                />
                <text textAnchor="middle" dy="5" fill="white" fontSize="13" fontWeight="bold">
                  {p.shirtNumber}
                </text>
                <title>{p.name}</title>
              </g>
            )),
        )}
      <g data-ball transform="translate(500,310)">
        <circle r="7" fill="white" stroke="#182f24" strokeWidth="2" />
      </g>
    </svg>
  );
}
