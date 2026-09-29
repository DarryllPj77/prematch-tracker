import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { defaultTargets } from "./config/defaultTargets.js";
import { generateTeamCode, normalizeTeamCode } from "./teamCodes.js";

const { Pool } = pg;
const schemaPath = fileURLToPath(new URL("../sql/schema.sql", import.meta.url));

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function mapSubmission(row) {
  const dmResults = Array.isArray(row.dm_results) ? row.dm_results : [];
  const rangeResults = Array.isArray(row.range_results) ? row.range_results : [];
  const screenshotKeys = Array.isArray(row.screenshot_keys) ? row.screenshot_keys : [];
  const screenshotSlots = row.screenshot_slots || { dm: [], range: [] };
  const requirementsSnapshot = row.requirements_snapshot || null;
  const submittedAt = new Date(row.submitted_at).toISOString();
  const date = typeof row.submission_date === "string"
    ? row.submission_date.slice(0, 10)
    : new Date(row.submission_date).toISOString().slice(0, 10);

  return {
    submissionId: row.submission_id,
    playerId: row.player_id,
    playerName: row.player_name,
    date,
    dmResults,
    rangeResults,
    requirementsSnapshot,
    screenshotKeys,
    screenshotSlots,
    timestamp: submittedAt,
    submittedAt,
    receivedAt: new Date(row.updated_at).toISOString(),
    isAttended: row.is_attended,
    passed: row.is_attended,
    dm: {
      matchesPlayed: dmResults.length,
      placements: dmResults,
      passed: row.dm_passed,
    },
    range: {
      roundsPlayed: rangeResults.length,
      scores: rangeResults,
      passed: row.range_passed,
    },
  };
}

export class PostgresRepository {
  constructor(connectionString) {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    this.pool.on("error", (error) => console.error("Postgres pool error:", error.message));
  }

  async initialize() {
    const schema = await fs.readFile(schemaPath, "utf8");
    await this.pool.query(schema);
    await this.ensureManagerTeamCodes();
    await this.seedLegacyTeamTargets();
  }

  async healthCheck() {
    await this.pool.query("SELECT 1");
  }

  async ensureManagerTeamCodes() {
    const managers = await this.pool.query(
      `SELECT id
       FROM users
       WHERE role = 'manager' AND team_code IS NULL
       ORDER BY id`,
    );

    for (const manager of managers.rows) {
      let assigned = false;
      for (let attempt = 0; attempt < 32 && !assigned; attempt += 1) {
        try {
          const result = await this.pool.query(
            `UPDATE users
             SET team_code = $1
             WHERE id = $2 AND role = 'manager' AND team_code IS NULL
             RETURNING id`,
            [generateTeamCode(), manager.id],
          );
          assigned = result.rowCount === 1;
        } catch (error) {
          if (error?.code !== "23505") throw error;
        }
      }
      if (!assigned) throw new Error(`Could not generate a unique team code for manager ${manager.id}.`);
    }
  }

  async seedLegacyTeamTargets() {
    await this.pool.query(
      `INSERT INTO team_target_settings (
         team_code, dm_matches_required, dm_placement_limit,
         range_rounds_required, range_min_score, updated_by
       )
       SELECT u.team_code, t.dm_matches_required, t.dm_placement_limit,
              t.range_rounds_required, t.range_min_score, u.id
       FROM users u
       CROSS JOIN target_settings t
       WHERE u.role = 'manager'
         AND u.team_code IS NOT NULL
         AND t.singleton_id = 1
       ON CONFLICT (team_code) DO NOTHING`,
    );
  }

  async createUser({ username, pinHash, role, teamCode }) {
    const result = await this.pool.query(
      `INSERT INTO users (username, normalized_username, pin_hash, role, team_code)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, role, team_code, created_at`,
      [username, normalizeUsername(username), pinHash, role, normalizeTeamCode(teamCode)],
    );
    return result.rows[0];
  }

  async findUserByUsername(username) {
    const result = await this.pool.query(
      `SELECT id, username, normalized_username, pin_hash, role, team_code, created_at
       FROM users
       WHERE normalized_username = $1`,
      [normalizeUsername(username)],
    );
    return result.rows[0] || null;
  }

  async findUserById(userId) {
    const result = await this.pool.query(
      `SELECT id, username, normalized_username, pin_hash, role, team_code, created_at
       FROM users
       WHERE id = $1`,
      [userId],
    );
    return result.rows[0] || null;
  }

  async findManagerByTeamCode(teamCode) {
    const result = await this.pool.query(
      `SELECT id, username, role, team_code, created_at
       FROM users
       WHERE role = 'manager' AND team_code = $1`,
      [normalizeTeamCode(teamCode)],
    );
    return result.rows[0] || null;
  }

  async assignPlayerToTeam(userId, teamCode) {
    const result = await this.pool.query(
      `UPDATE users
       SET team_code = $1
       WHERE id = $2 AND role = 'player' AND team_code IS NULL
       RETURNING id, username, role, team_code, pin_hash, created_at`,
      [normalizeTeamCode(teamCode), userId],
    );
    return result.rows[0] || null;
  }

  async getPlayers(teamCode) {
    const result = await this.pool.query(
      `SELECT id, username, created_at
       FROM users
       WHERE role = 'player' AND team_code = $1
       ORDER BY LOWER(username), id`,
      [normalizeTeamCode(teamCode)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.username,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async removePlayerFromTeam(callsign, teamCode) {
    const result = await this.pool.query(
      `UPDATE users
       SET team_code = NULL
       WHERE role = 'player'
         AND normalized_username = $1
         AND team_code = $2
       RETURNING id, username`,
      [normalizeUsername(callsign), normalizeTeamCode(teamCode)],
    );
    const row = result.rows[0];
    return row ? { id: Number(row.id), name: row.username } : null;
  }

  async getTargets(teamCode) {
    const result = await this.pool.query(
      `SELECT dm_matches_required, dm_placement_limit, range_rounds_required, range_min_score
       FROM team_target_settings
       WHERE team_code = $1`,
      [normalizeTeamCode(teamCode)],
    );
    const row = result.rows[0];
    if (!row) return structuredClone(defaultTargets);
    return {
      dm: {
        ...defaultTargets.dm,
        matchesRequired: row.dm_matches_required,
        placementLimit: row.dm_placement_limit,
      },
      range: {
        ...defaultTargets.range,
        roundsRequired: row.range_rounds_required,
        minScore: row.range_min_score,
      },
    };
  }

  async saveTargets(teamCode, targets, managerId) {
    const result = await this.pool.query(
      `INSERT INTO team_target_settings (
         team_code, dm_matches_required, dm_placement_limit,
         range_rounds_required, range_min_score, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (team_code) DO UPDATE SET
         dm_matches_required = EXCLUDED.dm_matches_required,
         dm_placement_limit = EXCLUDED.dm_placement_limit,
         range_rounds_required = EXCLUDED.range_rounds_required,
         range_min_score = EXCLUDED.range_min_score,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by
       RETURNING dm_matches_required, dm_placement_limit, range_rounds_required, range_min_score`,
      [
        normalizeTeamCode(teamCode),
        targets.dm.matchesRequired,
        targets.dm.placementLimit,
        targets.range.roundsRequired,
        targets.range.minScore,
        managerId,
      ],
    );
    const row = result.rows[0];
    return {
      dm: {
        ...defaultTargets.dm,
        matchesRequired: row.dm_matches_required,
        placementLimit: row.dm_placement_limit,
      },
      range: {
        ...defaultTargets.range,
        roundsRequired: row.range_rounds_required,
        minScore: row.range_min_score,
      },
    };
  }

  async upsertSubmission(submission, userId) {
    const result = await this.pool.query(
      `INSERT INTO submissions (
         submission_id, user_id, player_id, player_name, submission_date,
         dm_results, range_results, requirements_snapshot, screenshot_keys,
         screenshot_slots, is_attended, dm_passed, range_passed, submitted_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
       ON CONFLICT (user_id, submission_date) DO UPDATE SET
         submission_id = EXCLUDED.submission_id,
         player_id = EXCLUDED.player_id,
         player_name = EXCLUDED.player_name,
         dm_results = EXCLUDED.dm_results,
         range_results = EXCLUDED.range_results,
         requirements_snapshot = EXCLUDED.requirements_snapshot,
         screenshot_keys = EXCLUDED.screenshot_keys,
         screenshot_slots = EXCLUDED.screenshot_slots,
         is_attended = EXCLUDED.is_attended,
         dm_passed = EXCLUDED.dm_passed,
         range_passed = EXCLUDED.range_passed,
         submitted_at = EXCLUDED.submitted_at,
         updated_at = NOW()
       RETURNING *`,
      [
        submission.submissionId,
        userId,
        submission.playerId,
        submission.playerName,
        submission.date,
        JSON.stringify(submission.dmResults),
        JSON.stringify(submission.rangeResults),
        JSON.stringify(submission.requirementsSnapshot),
        JSON.stringify(submission.screenshotKeys || []),
        JSON.stringify(submission.screenshotSlots || { dm: [], range: [] }),
        submission.isAttended,
        submission.dmPassed,
        submission.rangePassed,
        submission.submittedAt,
      ],
    );
    return mapSubmission(result.rows[0]);
  }

  async getSubmissions({ userId, teamCode, date, limit = 500 } = {}) {
    const values = [];
    const filters = [];
    if (teamCode) {
      values.push(normalizeTeamCode(teamCode));
      filters.push(`owner.team_code = $${values.length}`);
    }
    if (userId) {
      values.push(userId);
      filters.push(`submission.user_id = $${values.length}`);
    }
    if (date) {
      values.push(date);
      filters.push(`submission.submission_date = $${values.length}`);
    }
    values.push(Math.min(Math.max(Number(limit) || 500, 1), 1000));
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await this.pool.query(
      `SELECT submission.*
       FROM submissions submission
       JOIN users owner ON owner.id = submission.user_id
       ${where}
       ORDER BY submission.submitted_at DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(mapSubmission);
  }

  async deleteSubmission(submissionId, teamCode) {
    const result = await this.pool.query(
      `DELETE FROM submissions submission
       USING users owner
       WHERE submission.submission_id = $1
         AND submission.user_id = owner.id
         AND owner.team_code = $2
       RETURNING submission.submission_id, submission.player_id,
                 submission.player_name, submission.submission_date`,
      [submissionId, normalizeTeamCode(teamCode)],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      submissionId: row.submission_id,
      playerId: row.player_id,
      playerName: row.player_name,
      date: typeof row.submission_date === "string"
        ? row.submission_date.slice(0, 10)
        : new Date(row.submission_date).toISOString().slice(0, 10),
    };
  }
}
