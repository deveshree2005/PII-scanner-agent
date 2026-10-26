const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let db;
let databasePath;

async function initializeDatabase() {
  const SQL = await initSqlJs();

  databasePath = path.join(
    app.getPath("userData"),
    "pii-scanner.db"
  );
                                                     
  // Load the existing database or create a new one.
  if (fs.existsSync(databasePath)) {
    const savedData = fs.readFileSync(databasePath);
    db = new SQL.Database(savedData);
  } else {
    db = new SQL.Database();
  }
  db.run("PRAGMA foreign_keys = ON");

  // 1. Existing Admin Panel table.
  db.run(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      aadhaar TEXT,
      pan TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Existing Audit Logs table.
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      person_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Custom Detection Types table.
  // Stores detection types created manually by the user.
  db.run(`
    CREATE TABLE IF NOT EXISTS detection_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rule_key TEXT NOT NULL UNIQUE,
      description TEXT,
      pattern TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Save the database, including any newly created tables.
  saveDatabase();

  console.log("PII Scanner database initialized successfully.");
  console.log("Tables ready: people, audit_logs, detection_rules");

  return db;
}

function saveDatabase() {
  if (!db || !databasePath) {
    throw new Error("Database has not been initialized.");
  }

  const data = db.export();
  fs.writeFileSync(databasePath, Buffer.from(data));
}

function getDatabase() {
  if (!db) {
    throw new Error("Database has not been initialized.");
  }

  return db;
}

module.exports = {
  initializeDatabase,
  getDatabase,
  saveDatabase
};



