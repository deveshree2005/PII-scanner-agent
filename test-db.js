
const Database = require("better-sqlite3");

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE test (
    id INTEGER PRIMARY KEY,
    message TEXT
  );
`);

db.prepare("INSERT INTO test (message) VALUES (?)")
  .run("SQLite is working");

const result = db.prepare("SELECT * FROM test").get();

console.log(result);

db.close();
