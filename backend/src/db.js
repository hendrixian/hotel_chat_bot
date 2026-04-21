const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const { resolveRepoPath } = require("./env");

const DB_PATH = resolveRepoPath(process.env.HOTEL_DB_PATH, ["backend", "data", "app.db"]);
const DB_DIR = path.dirname(DB_PATH);

let SQL = null;
let db = null;

async function initDb() {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, "..", "node_modules", "sql.js", "dist", file)
  });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(new Uint8Array(fileBuffer));
  } else {
    db = new SQL.Database();
  }

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      price_per_night REAL NOT NULL,
      features TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS room_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_type TEXT NOT NULL,
      date TEXT NOT NULL,
      total_rooms INTEGER NOT NULL,
      available_rooms INTEGER NOT NULL,
      price_usd REAL,
      notes TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (room_type, date)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_en TEXT NOT NULL,
      title_my TEXT NOT NULL,
      description_en TEXT,
      description_my TEXT,
      venue TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_name TEXT NOT NULL,
      contact TEXT,
      room_type TEXT NOT NULL,
      venue TEXT,
      check_in_date TEXT NOT NULL,
      check_out_date TEXT NOT NULL,
      room_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_key TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      title_en TEXT NOT NULL,
      title_my TEXT NOT NULL,
      content_en TEXT NOT NULL,
      content_my TEXT NOT NULL,
      tags TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON admin_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_date ON room_inventory(date);
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(check_in_date, check_out_date);
  `);

  ensureColumnExists("reservations", "venue", "TEXT");
  ensureColumnExists("events", "venue", "TEXT");

  saveDb();
  return db;
}

function ensureColumnExists(tableName, columnName, columnSqlType) {
  const columns = all(`PRAGMA table_info(${tableName})`);
  const hasColumn = columns.some((col) => col.name === columnName);
  if (!hasColumn) {
    run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSqlType}`);
  }
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

function safeAll(sql, params = []) {
  if (!db) return [];
  return all(sql, params);
}

function safeGet(sql, params = []) {
  if (!db) return null;
  return get(sql, params);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDate(value) {
  return String(value || "").trim().slice(0, 10);
}

function seedIfEmpty() {
  // Knowledge base now lives in kb.json, so we do not seed facts/rooms here.
  saveDb();
}

function logMessage(sessionId, role, content) {
  run(
    "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    [sessionId, role, content, new Date().toISOString()]
  );
  saveDb();
}

function getRecentMessages(sessionId, limit = 8) {
  return all(
    "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
    [sessionId, limit]
  ).reverse();
}

function searchFactsLike(query, limit = 5) {
  const like = `%${query}%`;
  return all(
    "SELECT title, content, category FROM facts WHERE title LIKE ? OR content LIKE ? OR tags LIKE ? LIMIT ?",
    [like, like, like, limit]
  );
}


function listFacts() {
  return all("SELECT category, title, content, tags FROM facts ORDER BY id ASC");
}

function listRooms() {
  return all("SELECT name, capacity, price_per_night, features FROM rooms");
}

function getAdminByUsername(username) {
  return safeGet("SELECT * FROM admin_users WHERE username = ?", [String(username || "").trim()]);
}

function getAdminById(id) {
  return safeGet("SELECT * FROM admin_users WHERE id = ?", [id]);
}

function upsertAdminUser({ username, passwordHash, passwordSalt }) {
  const existing = getAdminByUsername(username);
  const ts = nowIso();

  if (existing) {
    run(
      "UPDATE admin_users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?",
      [passwordHash, passwordSalt, ts, existing.id]
    );
    saveDb();
    return getAdminById(existing.id);
  }

  run(
    "INSERT INTO admin_users (username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [String(username || "").trim(), passwordHash, passwordSalt, ts, ts]
  );
  saveDb();
  return getAdminByUsername(username);
}

function createAdminSession({ token, adminUserId, expiresAt }) {
  run(
    "INSERT INTO admin_sessions (token, admin_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [token, adminUserId, nowIso(), expiresAt]
  );
  saveDb();
}

function getAdminSession(token) {
  return safeGet(
    `SELECT s.token, s.admin_user_id, s.created_at, s.expires_at, u.username
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.token = ?`,
    [token]
  );
}

function deleteAdminSession(token) {
  run("DELETE FROM admin_sessions WHERE token = ?", [token]);
  saveDb();
}

function deleteExpiredAdminSessions(now = nowIso()) {
  run("DELETE FROM admin_sessions WHERE expires_at < ?", [now]);
  saveDb();
}

function listRoomInventory({ dateFrom, dateTo, roomType } = {}) {
  const clauses = [];
  const params = [];

  if (dateFrom) {
    clauses.push("date >= ?");
    params.push(normalizeDate(dateFrom));
  }
  if (dateTo) {
    clauses.push("date <= ?");
    params.push(normalizeDate(dateTo));
  }
  if (roomType) {
    clauses.push("room_type = ?");
    params.push(String(roomType).trim());
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return safeAll(
    `SELECT id, room_type, date, total_rooms, available_rooms, price_usd, notes, updated_at
     FROM room_inventory
     ${where}
     ORDER BY date ASC, room_type ASC`,
    params
  );
}

function upsertRoomInventory({ roomType, date, totalRooms, availableRooms, priceUsd, notes }) {
  const ts = nowIso();
  run(
    `INSERT INTO room_inventory (room_type, date, total_rooms, available_rooms, price_usd, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_type, date) DO UPDATE SET
       total_rooms = excluded.total_rooms,
       available_rooms = excluded.available_rooms,
       price_usd = excluded.price_usd,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    [
      String(roomType || "").trim(),
      normalizeDate(date),
      Number(totalRooms || 0),
      Number(availableRooms || 0),
      priceUsd === null || priceUsd === undefined || priceUsd === "" ? null : Number(priceUsd),
      notes ? String(notes) : null,
      ts
    ]
  );
  saveDb();
  return safeGet("SELECT * FROM room_inventory WHERE room_type = ? AND date = ?", [
    String(roomType || "").trim(),
    normalizeDate(date)
  ]);
}

function getRoomInventoryById(id) {
  return safeGet("SELECT * FROM room_inventory WHERE id = ?", [id]);
}

function updateRoomInventory(id, { roomType, date, totalRooms, availableRooms, priceUsd, notes }) {
  run(
    `UPDATE room_inventory
     SET room_type = ?, date = ?, total_rooms = ?, available_rooms = ?, price_usd = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      String(roomType || "").trim(),
      normalizeDate(date),
      Number(totalRooms || 0),
      Number(availableRooms || 0),
      priceUsd === null || priceUsd === undefined || priceUsd === "" ? null : Number(priceUsd),
      notes ? String(notes) : null,
      nowIso(),
      id
    ]
  );
  saveDb();
  return safeGet("SELECT * FROM room_inventory WHERE id = ?", [id]);
}

function deleteRoomInventory(id) {
  run("DELETE FROM room_inventory WHERE id = ?", [id]);
  saveDb();
}

function listEvents({ dateFrom, dateTo } = {}) {
  const clauses = [];
  const params = [];
  if (dateFrom) {
    clauses.push("end_date >= ?");
    params.push(normalizeDate(dateFrom));
  }
  if (dateTo) {
    clauses.push("start_date <= ?");
    params.push(normalizeDate(dateTo));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return safeAll(
    `SELECT id, title_en, title_my, description_en, description_my, venue, start_date, end_date, updated_at
     FROM events
     ${where}
     ORDER BY start_date ASC, id ASC`,
    params
  );
}

function createEvent({ titleEn, titleMy, descriptionEn, descriptionMy, venue, startDate, endDate }) {
  const ts = nowIso();
  run(
    `INSERT INTO events (title_en, title_my, description_en, description_my, venue, start_date, end_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(titleEn || "").trim(),
      String(titleMy || "").trim(),
      descriptionEn ? String(descriptionEn) : "",
      descriptionMy ? String(descriptionMy) : "",
      venue ? String(venue).trim() : "",
      normalizeDate(startDate),
      normalizeDate(endDate),
      ts
    ]
  );
  saveDb();
  return safeGet("SELECT * FROM events WHERE id = last_insert_rowid()");
}

function updateEvent(id, { titleEn, titleMy, descriptionEn, descriptionMy, venue, startDate, endDate }) {
  run(
    `UPDATE events
     SET title_en = ?, title_my = ?, description_en = ?, description_my = ?, venue = ?, start_date = ?, end_date = ?, updated_at = ?
     WHERE id = ?`,
    [
      String(titleEn || "").trim(),
      String(titleMy || "").trim(),
      descriptionEn ? String(descriptionEn) : "",
      descriptionMy ? String(descriptionMy) : "",
      venue ? String(venue).trim() : "",
      normalizeDate(startDate),
      normalizeDate(endDate),
      nowIso(),
      id
    ]
  );
  saveDb();
  return safeGet("SELECT * FROM events WHERE id = ?", [id]);
}

function deleteEvent(id) {
  run("DELETE FROM events WHERE id = ?", [id]);
  saveDb();
}

function listReservations({ dateFrom, dateTo, status } = {}) {
  const clauses = [];
  const params = [];
  if (dateFrom) {
    clauses.push("check_out_date >= ?");
    params.push(normalizeDate(dateFrom));
  }
  if (dateTo) {
    clauses.push("check_in_date <= ?");
    params.push(normalizeDate(dateTo));
  }
  if (status) {
    clauses.push("status = ?");
    params.push(String(status).trim().toLowerCase());
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return safeAll(
    `SELECT id, guest_name, contact, room_type, check_in_date, check_out_date, room_count, status, notes, created_at, updated_at
     FROM reservations
     ${where}
     ORDER BY check_in_date ASC, id ASC`,
    params
  );
}

function createReservation({ guestName, contact, roomType, checkInDate, checkOutDate, roomCount, status, notes }) {
  const ts = nowIso();
  run(
    `INSERT INTO reservations
      (guest_name, contact, room_type, check_in_date, check_out_date, room_count, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(guestName || "").trim(),
      contact ? String(contact) : "",
      String(roomType || "").trim(),
      normalizeDate(checkInDate),
      normalizeDate(checkOutDate),
      Number(roomCount || 1),
      String(status || "confirmed").trim().toLowerCase(),
      notes ? String(notes) : "",
      ts,
      ts
    ]
  );
  saveDb();
  return safeGet("SELECT * FROM reservations WHERE id = last_insert_rowid()");
}

function updateReservation(id, { guestName, contact, roomType, checkInDate, checkOutDate, roomCount, status, notes }) {
  run(
    `UPDATE reservations
     SET guest_name = ?, contact = ?, room_type = ?, check_in_date = ?, check_out_date = ?, room_count = ?, status = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      String(guestName || "").trim(),
      contact ? String(contact) : "",
      String(roomType || "").trim(),
      normalizeDate(checkInDate),
      normalizeDate(checkOutDate),
      Number(roomCount || 1),
      String(status || "confirmed").trim().toLowerCase(),
      notes ? String(notes) : "",
      nowIso(),
      id
    ]
  );
  saveDb();
  return safeGet("SELECT * FROM reservations WHERE id = ?", [id]);
}

function deleteReservation(id) {
  run("DELETE FROM reservations WHERE id = ?", [id]);
  saveDb();
}

function serializeTags(tags) {
  if (Array.isArray(tags)) {
    return tags
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(",");
  }
  return String(tags || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .join(",");
}

function listKbEntries() {
  return safeAll(
    `SELECT id, kb_key, category, title_en, title_my, content_en, content_my, tags, updated_by, updated_at
     FROM kb_entries
     ORDER BY category ASC, kb_key ASC`
  );
}

function createKbEntry({ kbKey, category, titleEn, titleMy, contentEn, contentMy, tags, updatedBy }) {
  const ts = nowIso();
  run(
    `INSERT INTO kb_entries
      (kb_key, category, title_en, title_my, content_en, content_my, tags, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(kbKey || "").trim(),
      String(category || "general").trim(),
      String(titleEn || "").trim(),
      String(titleMy || "").trim(),
      String(contentEn || "").trim(),
      String(contentMy || "").trim(),
      serializeTags(tags),
      updatedBy ? String(updatedBy) : "",
      ts
    ]
  );
  saveDb();
  return safeGet("SELECT * FROM kb_entries WHERE id = last_insert_rowid()");
}

function updateKbEntry(id, { kbKey, category, titleEn, titleMy, contentEn, contentMy, tags, updatedBy }) {
  run(
    `UPDATE kb_entries
     SET kb_key = ?, category = ?, title_en = ?, title_my = ?, content_en = ?, content_my = ?, tags = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`,
    [
      String(kbKey || "").trim(),
      String(category || "general").trim(),
      String(titleEn || "").trim(),
      String(titleMy || "").trim(),
      String(contentEn || "").trim(),
      String(contentMy || "").trim(),
      serializeTags(tags),
      updatedBy ? String(updatedBy) : "",
      nowIso(),
      id
    ]
  );
  saveDb();
  return safeGet("SELECT * FROM kb_entries WHERE id = ?", [id]);
}

function deleteKbEntry(id) {
  run("DELETE FROM kb_entries WHERE id = ?", [id]);
  saveDb();
}

module.exports = {
  initDb,
  seedIfEmpty,
  logMessage,
  getRecentMessages,
  searchFactsLike,
  listFacts,
  listRooms,
  getAdminByUsername,
  getAdminById,
  upsertAdminUser,
  createAdminSession,
  getAdminSession,
  deleteAdminSession,
  deleteExpiredAdminSessions,
  listRoomInventory,
  upsertRoomInventory,
  getRoomInventoryById,
  updateRoomInventory,
  deleteRoomInventory,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  listReservations,
  createReservation,
  updateReservation,
  deleteReservation,
  listKbEntries,
  createKbEntry,
  updateKbEntry,
  deleteKbEntry
};
