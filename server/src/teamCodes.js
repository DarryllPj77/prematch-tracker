import { randomInt } from "node:crypto";

const TEAM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeTeamCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function isValidTeamCode(value) {
  return /^[A-Z0-9]{4}$/.test(normalizeTeamCode(value));
}

export function generateTeamCode() {
  return Array.from({ length: 4 }, () => TEAM_CODE_ALPHABET[randomInt(TEAM_CODE_ALPHABET.length)]).join("");
}
