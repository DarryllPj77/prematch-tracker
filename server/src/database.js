import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { defaultTargets } from "./config/defaultTargets.js";

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
  }

  async healthCheck() {
    await this.pool.query("SELECT 1");
  }

  async createUser({ username, pinHash, role }) {
    const result = await this.pool.query(
      `INSERT INTO users (username, normalized_username, pin_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, role, created_at`,
      [username, normalizeUsername(username), pinHash, role],
    );
    return result.rows[0];
  }

  async findUserByUsername(username) {
    const result = await this.pool.query(
      `SELECT id, username, normalized_username, pin_hash, role, created_at
       FROM users
       WHERE normalized_username = $1`,
      [normalizeUsername(username)],
    );
    return result.rows[0] || null;
  }

  async getPlayers() {
    const result = await this.pool.query(
      `SELECT id, username, created_at
       FROM users
       WHERE role = 'player'
       ORDER BY LOWER(username), id`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.username,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async getTargets() {
    const result = await this.pool.query(
      `SELECT dm_matches_required, dm_placement_limit, range_rounds_required, range_min_score
       FROM target_settings
       WHERE singleton_id = 1`,
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

  async saveTargets(targets, managerId) {
    const result = await this.pool.query(
      `UPDATE target_settings
       SET dm_matches_required = $1,
           dm_placement_limit = $2,
           range_rounds_required = $3,
           range_min_score = $4,
           updated_at = NOW(),
           updated_by = $5
       WHERE singleton_id = 1
       RETURNING dm_matches_required, dm_placement_limit, range_rounds_required, range_min_score`,
      [
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

  async getSubmissions({ userId, date, limit = 500 } = {}) {
    const values = [];
    const filters = [];
    if (userId) {
      values.push(userId);
      filters.push(`user_id = $${values.length}`);
    }
    if (date) {
      values.push(date);
      filters.push(`submission_date = $${values.length}`);
    }
    values.push(Math.min(Math.max(Number(limit) || 500, 1), 1000));
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await this.pool.query(
      `SELECT * FROM submissions ${where}
       ORDER BY submitted_at DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(mapSubmission);
  }

  async deleteSubmission(submissionId) {
    const result = await this.pool.query(
      `DELETE FROM submissions
       WHERE submission_id = $1
       RETURNING submission_id, player_id, player_name, submission_date`,
      [submissionId],
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
