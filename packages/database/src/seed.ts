import { generateLeagueSquads } from "@ffb/football";
import { loadConfig } from "@ffb/config";
import { database } from "./client.ts";
import { TEAM_SEED_DEFINITIONS } from "../data/teams.ts";
import identities from "../data/player-identities-v1.json";
import { ensureRound } from "./lifecycle.ts";
import type { SQL } from "bun";
export const seedSquads = () =>
  generateLeagueSquads(
    TEAM_SEED_DEFINITIONS.map((t) => ({ key: t.slug, targetStrength: t.targetStrength })),
    identities.map((p) => ({ firstName: p.first_name, lastName: p.last_name })),
  );
export async function seed(sql: SQL) {
  const squads = seedSquads();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(72411002)`;
    for (const definition of TEAM_SEED_DEFINITIONS) {
      const squad = squads.find((s) => s.teamKey === definition.slug)!;
      const {
        legacyName: _legacyName,
        legacyStrength: _legacyStrength,
        targetStrength: _targetStrength,
        ...profile
      } = definition;
      await tx`INSERT INTO teams(id,profile,strength) VALUES(${definition.slug},${tx.json(profile)},${squad.strengthRating}) ON CONFLICT(id) DO NOTHING`;
      for (const p of squad.players)
        await tx`INSERT INTO players(id,team_id,generation_key,shirt_number,payload) VALUES(${p.id},${definition.slug},${p.generationKey},${p.shirtNumber},${tx.json(p)}) ON CONFLICT(id) DO NOTHING`;
      for (const [i, l] of squad.lineups.entries()) {
        const payload = {
          formation: l.formation,
          assignments: l.ratings.assignments.map((a) => ({
            slotKey: a.slotKey,
            playerId: a.player.id,
          })),
        };
        await tx`INSERT INTO lineups(id,team_id,kind,payload) VALUES(${`${definition.slug}:system:${i}`},${definition.slug},${l.official ? "official" : "alternative"},${tx.json(payload)}) ON CONFLICT(id) DO NOTHING`;
      }
    }
  });
  await sql.begin((tx) => ensureRound(tx, new Date()));
}
if (import.meta.main) {
  const sql = database(loadConfig().DATABASE_URL);
  try {
    await seed(sql);
    console.info("Seed complete: 20 clubs and 460 players");
  } finally {
    await sql.close();
  }
}
