const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const DB_PATH = process.env.HOTEL_DB_PATH || path.join(__dirname, "..", "data", "app.db");
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
  `);

  saveDb();
  return db;
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

function seedIfEmpty() {
  const factCount = get("SELECT COUNT(1) AS count FROM facts");
  if (!factCount || factCount.count === 0) {
    const facts = [
      {
        category: "policy",
        title: "Check-in time",
        content: "Standard check-in is from 2:00 PM. Early check-in is subject to availability.",
        tags: "check-in,arrival"
      },
      {
        category: "policy",
        title: "Check-out time",
        content: "Standard check-out is by 12:00 PM. Late check-out may be available for a fee.",
        tags: "check-out,departure"
      },
      {
        category: "amenity",
        title: "Wi-Fi",
        content: "Complimentary Wi-Fi is available in all rooms and public areas.",
        tags: "wifi,wi-fi,internet"
      },
      {
        category: "amenity",
        title: "Breakfast",
        content: "Breakfast is included with select room types. It is served from 6:30 AM to 10:00 AM.",
        tags: "breakfast,restaurant"
      },
      {
        category: "policy",
        title: "Cancellation",
        content: "Free cancellation up to 24 hours before check-in. Within 24 hours, one night may be charged.",
        tags: "cancel,cancellation"
      }
    ];

    facts.forEach((row) => {
      run(
        "INSERT INTO facts (category, title, content, tags) VALUES (?, ?, ?, ?)",
        [row.category, row.title, row.content, row.tags]
      );
    });
  }

  const roomCount = get("SELECT COUNT(1) AS count FROM rooms");
  if (!roomCount || roomCount.count === 0) {
    const rooms = [
      {
        name: "Deluxe Twin",
        capacity: 2,
        price_per_night: 65,
        features: "twin beds,city view,ac,private bathroom"
      },
      {
        name: "Family Suite",
        capacity: 4,
        price_per_night: 120,
        features: "2 bedrooms,balcony,breakfast included,sofa"
      },
      {
        name: "Executive King",
        capacity: 2,
        price_per_night: 95,
        features: "king bed,balcony,breakfast included,work desk"
      }
    ];

    rooms.forEach((row) => {
      run(
        "INSERT INTO rooms (name, capacity, price_per_night, features) VALUES (?, ?, ?, ?)",
        [row.name, row.capacity, row.price_per_night, row.features]
      );
    });
  }

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

function listRooms() {
  return all("SELECT name, capacity, price_per_night, features FROM rooms");
}

module.exports = {
  initDb,
  seedIfEmpty,
  logMessage,
  getRecentMessages,
  searchFactsLike,
  listRooms
};
