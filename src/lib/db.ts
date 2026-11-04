import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Single SQLite file via Node's built-in sqlite module (Node 22.13+ / 24).
 * No native build step, so `npm install` works on any machine. Created on first use.
 */
const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), "data", "app.db");

declare global {
  var __wanderDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  mkdirSync(resolve(DB_PATH, ".."), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      destination TEXT NOT NULL,
      origin_city TEXT NOT NULL,
      start_date TEXT NOT NULL,
      nights INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'swiping',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      name TEXT NOT NULL,
      is_host INTEGER NOT NULL DEFAULT 0,
      done_swiping INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS swipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      member_id TEXT NOT NULL REFERENCES members(id),
      left_card TEXT NOT NULL,
      right_card TEXT NOT NULL,
      chosen_card TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plans (
      room_id TEXT PRIMARY KEY REFERENCES rooms(id),
      json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plan_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      kind TEXT NOT NULL,
      tool TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS api_calls (
      api TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (api, day)
    );
    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      room_id TEXT,
      hotel_id TEXT NOT NULL,
      hotel_name TEXT NOT NULL,
      checkin TEXT NOT NULL,
      checkout TEXT NOT NULL,
      status TEXT NOT NULL,
      confirmation TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Added after the first rooms were created: which deck/destination the room uses.
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN dest_key TEXT");
  } catch {
    /* column already exists */
  }
  return db;
}

export function db(): DatabaseSync {
  if (!globalThis.__wanderDb) globalThis.__wanderDb = open();
  return globalThis.__wanderDb;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function roomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
