const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { createWorker } = require("tesseract.js");
const os = require("os");
const AdmZip = require("adm-zip");
const WordExtractor = require("word-extractor");

const {
  initializeDatabase,
  getDatabase,
  saveDatabase
} = require("./Database/database");

// ==================================================
// WINDOW
// ==================================================

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "PII Scanner Agent",
    backgroundColor: "#f5f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

// ==================================================
// DATABASE HELPERS
// ==================================================

function queryAll(sql, params = []) {
  const db = getDatabase();
  const statement = db.prepare(sql);

  try {
    statement.bind(params);

    const rows = [];

    while (statement.step()) {
      rows.push(statement.getAsObject());
    }

    return rows;
  } finally {
    statement.free();
  }
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

function executeQuery(sql, params = []) {
  const db = getDatabase();
  db.run(sql, params);
  saveDatabase();
}

function recordAudit(action, personId, details) {
  const db = getDatabase();

  db.run(
    `INSERT INTO audit_logs (action, person_id, details)
     VALUES (?, ?, ?)`,
    [action, personId ?? null, details]
  );
}

// ==================================================
// ADMIN PANEL: LIST AND SEARCH PEOPLE
// ==================================================

ipcMain.handle("people:list", async (_event, searchTerm = "") => {
  if (typeof searchTerm !== "string") {
    throw new Error("Invalid search term.");
  }

  const search = searchTerm.trim().slice(0, 150);

  if (!search) {
    return queryAll(`
      SELECT *
      FROM people
      ORDER BY id DESC
    `);
  }

  const pattern = `%${search}%`;

  return queryAll(
    `SELECT *
     FROM people
     WHERE full_name LIKE ?
        OR email LIKE ?
        OR phone LIKE ?
        OR pan LIKE ?
     ORDER BY id DESC`,
    [pattern, pattern, pattern, pattern]
  );
});

// ==================================================
// ADMIN PANEL: ADD PERSON
// ==================================================

ipcMain.handle("people:add", async (_event, person) => {
  if (!person || typeof person !== "object" || Array.isArray(person)) {
    throw new Error("Invalid person details.");
  }

  const fullName =
    typeof person.full_name === "string"
      ? person.full_name.trim()
      : "";

  if (!fullName || fullName.length > 150) {
    throw new Error("Enter a name of up to 150 characters.");
  }

  const fields = ["email", "phone", "aadhaar", "pan", "notes"];

  const values = fields.map((field) => {
    const value = person[field];

    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new Error(`Invalid value for ${field}.`);
    }

    const maxLength = field === "notes" ? 2000 : 200;

    if (value.length > maxLength) {
      throw new Error(`${field} exceeds the allowed length.`);
    }

    return value.trim();
  });

  const db = getDatabase();

  db.run(
    `INSERT INTO people
      (full_name, email, phone, aadhaar, pan, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [fullName, ...values]
  );

  const personId = queryOne(
    "SELECT last_insert_rowid() AS id"
  ).id;

  recordAudit("CREATE", personId, "Person record created");
  saveDatabase();

  return queryOne(
    "SELECT * FROM people WHERE id = ?",
    [personId]
  );
});

// ==================================================
// ADMIN PANEL: GET ONE PERSON
// ==================================================

ipcMain.handle("people:get", async (_event, id) => {
  const personId = Number(id);

  if (!Number.isSafeInteger(personId) || personId <= 0) {
    throw new Error("Invalid person ID.");
  }

  return queryOne(
    "SELECT * FROM people WHERE id = ?",
    [personId]
  );
});

// ==================================================
// ADMIN PANEL: UPDATE PERSON
// ==================================================

ipcMain.handle("people:update", async (_event, id, person) => {
  const personId = Number(id);

  if (!Number.isSafeInteger(personId) || personId <= 0) {
    throw new Error("Invalid person ID.");
  }

  if (!person || typeof person !== "object" || Array.isArray(person)) {
    throw new Error("Invalid person details.");
  }

  const existing = queryOne(
    "SELECT id FROM people WHERE id = ?",
    [personId]
  );

  if (!existing) {
    throw new Error("Person record not found.");
  }

  const fullName =
    typeof person.full_name === "string"
      ? person.full_name.trim()
      : "";

  if (!fullName || fullName.length > 150) {
    throw new Error("Enter a name of up to 150 characters.");
  }

  const fields = ["email", "phone", "aadhaar", "pan", "notes"];

  const values = fields.map((field) => {
    const value = person[field];

    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new Error(`Invalid value for ${field}.`);
    }

    const maxLength = field === "notes" ? 2000 : 200;

    if (value.length > maxLength) {
      throw new Error(`${field} exceeds the allowed length.`);
    }

    return value.trim();
  });

  const db = getDatabase();

  db.run(
    `UPDATE people
     SET full_name = ?,
         email = ?,
         phone = ?,
         aadhaar = ?,
         pan = ?,
         notes = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [fullName, ...values, personId]
  );

  recordAudit("UPDATE", personId, "Person record updated");
  saveDatabase();

  return queryOne(
    "SELECT * FROM people WHERE id = ?",
    [personId]
  );
});

// ==================================================
// ADMIN PANEL: DELETE PERSON
// ==================================================

ipcMain.handle("people:delete", async (_event, id) => {
  const personId = Number(id);

  if (!Number.isSafeInteger(personId) || personId <= 0) {
    throw new Error("Invalid person ID.");
  }

  const existing = queryOne(
    "SELECT id FROM people WHERE id = ?",
    [personId]
  );

  if (!existing) {
    throw new Error("Person record not found.");
  }

  getDatabase().run(
    "DELETE FROM people WHERE id = ?",
    [personId]
  );

  recordAudit("DELETE", personId, "Person record deleted");
  saveDatabase();

  return { success: true };
});

// ==================================================
// AUDIT LOGS
// ==================================================

ipcMain.handle("audit:list", async (_event, limit = 100) => {
  const safeLimit = Math.min(
    500,
    Math.max(1, Number.parseInt(limit, 10) || 100)
  );

  return queryAll(
    `SELECT id, action, person_id, details, created_at
     FROM audit_logs
     ORDER BY id DESC
     LIMIT ?`,
    [safeLimit]
  );
});

// ==================================================
// DETECTION RULES: VALIDATION
// ==================================================

function validateDetectionRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new Error("Invalid detection rule.");
  }

  const name = typeof rule.name === "string" ? rule.name.trim() : "";
  const ruleKey =
    typeof rule.rule_key === "string" ? rule.rule_key.trim() : "";
  const description =
    typeof rule.description === "string" ? rule.description.trim() : "";
  const pattern =
    typeof rule.pattern === "string" ? rule.pattern.trim() : "";

  if (!name || name.length > 100) {
    throw new Error("Enter a detection name of up to 100 characters.");
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/.test(ruleKey)) {
    throw new Error(
      "Rule key must start with a letter and use only letters, numbers, _ or - (max 50)."
    );
  }

  if (description.length > 500) {
    throw new Error("Description cannot exceed 500 characters.");
  }

  if (!pattern || pattern.length > 1000) {
    throw new Error("Enter a regular expression of up to 1000 characters.");
  }

  try {
    new RegExp(pattern, "gi");
  } catch {
    throw new Error("Invalid regular expression. Check your pattern.");
  }

  return { name, rule_key: ruleKey, description, pattern };
}

// ==================================================
// DETECTION RULES: LIST
// ==================================================

ipcMain.handle("rules:list", async () => {
  return queryAll(`
    SELECT id, name, rule_key, description, pattern,
           enabled, created_at, updated_at
    FROM detection_rules
    ORDER BY id DESC
  `);
});

// ==================================================
// DETECTION RULES: ADD
// ==================================================

ipcMain.handle("rules:add", async (_event, rule) => {
  const { name, rule_key, description, pattern } =
    validateDetectionRule(rule);

  if (
    queryOne("SELECT id FROM detection_rules WHERE rule_key = ?", [rule_key])
  ) {
    throw new Error("This rule key already exists. Choose a different key.");
  }

  getDatabase().run(
    `INSERT INTO detection_rules
      (name, rule_key, description, pattern, enabled)
     VALUES (?, ?, ?, ?, 1)`,
    [name, rule_key, description, pattern]
  );

  const id = queryOne("SELECT last_insert_rowid() AS id").id;

  recordAudit("CREATE", null, `Detection rule created: ${name}`);
  saveDatabase();

  return queryOne("SELECT * FROM detection_rules WHERE id = ?", [id]);
});

// ==================================================
// DETECTION RULES: UPDATE
// ==================================================

ipcMain.handle("rules:update", async (_event, id, rule) => {
  const ruleId = Number(id);

  if (!Number.isSafeInteger(ruleId) || ruleId <= 0) {
    throw new Error("Invalid detection rule ID.");
  }

  if (!queryOne("SELECT id FROM detection_rules WHERE id = ?", [ruleId])) {
    throw new Error("Detection rule not found.");
  }

  const { name, rule_key, description, pattern } =
    validateDetectionRule(rule);

  if (
    queryOne(
      "SELECT id FROM detection_rules WHERE rule_key = ? AND id != ?",
      [rule_key, ruleId]
    )
  ) {
    throw new Error("This rule key already exists. Choose a different key.");
  }

  getDatabase().run(
    `UPDATE detection_rules
     SET name = ?,
         rule_key = ?,
         description = ?,
         pattern = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [name, rule_key, description, pattern, ruleId]
  );

  recordAudit("UPDATE", null, `Detection rule updated: ${name}`);
  saveDatabase();

  return queryOne("SELECT * FROM detection_rules WHERE id = ?", [ruleId]);
});

// ==================================================
// DETECTION RULES: ENABLE / DISABLE
// ==================================================

ipcMain.handle("rules:toggle", async (_event, id, enabled) => {
  const ruleId = Number(id);

  if (!Number.isSafeInteger(ruleId) || ruleId <= 0) {
    throw new Error("Invalid detection rule ID.");
  }

  if (typeof enabled !== "boolean") {
    throw new Error("Enabled status must be true or false.");
  }

  const existing = queryOne(
    "SELECT id, name FROM detection_rules WHERE id = ?",
    [ruleId]
  );

  if (!existing) {
    throw new Error("Detection rule not found.");
  }

  getDatabase().run(
    `UPDATE detection_rules
     SET enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [enabled ? 1 : 0, ruleId]
  );

  recordAudit(
    enabled ? "ENABLE" : "DISABLE",
    null,
    `Detection rule ${enabled ? "enabled" : "disabled"}: ${existing.name}`
  );

  saveDatabase();

  return queryOne("SELECT * FROM detection_rules WHERE id = ?", [ruleId]);
});

// ==================================================
// DETECTION RULES: DELETE
// ==================================================

ipcMain.handle("rules:delete", async (_event, id) => {
  const ruleId = Number(id);

  if (!Number.isSafeInteger(ruleId) || ruleId <= 0) {
    throw new Error("Invalid detection rule ID.");
  }

  const existing = queryOne(
    "SELECT id, name FROM detection_rules WHERE id = ?",
    [ruleId]
  );

  if (!existing) {
    throw new Error("Detection rule not found.");
  }

  getDatabase().run(
    "DELETE FROM detection_rules WHERE id = ?",
    [ruleId]
  );

  recordAudit("DELETE", null, `Detection rule deleted: ${existing.name}`);
  saveDatabase();

  return { success: true };
});

// ==================================================
// SUPPORTED FILE TYPES
// ==================================================

const TEXT_EXTENSIONS = [
  ".txt", ".csv", ".tsv", ".log", ".json", ".jsonl", ".ndjson", ".xml",
  ".yaml", ".yml", ".toml", ".md", ".rst", ".tex", ".srt", ".html", ".htm",
  ".css", ".ini", ".cfg", ".conf", ".properties", ".reg", ".inf",
  ".sql", ".eml", ".mbox", ".ics", ".vcf", ".ldif", ".pem", ".cer",
  ".js", ".ts", ".tsx", ".jsx", ".vue", ".py", ".java", ".cs", ".php",
  ".c", ".cpp", ".h", ".go", ".rb", ".rs", ".kt", ".swift", ".pl", ".lua", ".r",
  ".bat", ".sh", ".ps1"
];

const OFFICE_ZIP_EXTENSIONS = [".pptx", ".odt", ".odp", ".ods"];

const SUPPORTED_EXTENSIONS = [
  ".pdf", ".docx", ".xlsx", ".xls",
  ".doc", ".rtf", ".zip",
  ...OFFICE_ZIP_EXTENSIONS,
  ...TEXT_EXTENSIONS
];

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp", ".webp"];
SUPPORTED_EXTENSIONS.push(...IMAGE_EXTENSIONS);
const SHEET_EXTENSIONS = [".xlsm", ".xlsb"];
SUPPORTED_EXTENSIONS.push(...SHEET_EXTENSIONS);
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);

// Text files larger than this are scanned in chunks (no size limit).
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const CHUNK_OVERLAP = 2000; // characters kept between chunks

// Reads a text file and handles UTF-16 files (common for Windows logs).
function readTextFile(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }

  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

// ==================================================
// PHASE 2 FILE TYPES: PPTX, ODT/ODP/ODS, DOC, RTF, ZIP
// ==================================================

function safeCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function xmlToText(xml) {
  const withBreaks = xml
    .replace(/<\/(?:a:p|text:p|text:h|table:table-row|a:tr)>/g, "\n")
    .replace(/<\/(?:a:tc|table:table-cell)>/g, "\t")
    .replace(/<text:tab\s*\/>/g, "\t")
    .replace(/<text:line-break\s*\/>/g, "\n")
    .replace(/<text:s(?:\s[^>]*)?\/>/g, " ");

  return decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ""));
}

// PPTX and OpenDocument files are ZIP packages that contain XML text.
function extractOfficeZipText(filePath, extension) {
  const zip = new AdmZip(filePath);
  const parts = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    const name = entry.entryName;

    const wanted =
      extension === ".pptx"
        ? /^ppt\/(slides|notesSlides|comments)\/[^/]+\.xml$/.test(name)
        : name === "content.xml";

    if (!wanted) continue;
    if (entry.header.size > 200 * 1024 * 1024) continue;

    parts.push(xmlToText(entry.getData().toString("utf8")));
  }

  return parts.join("\n");
}

// Simple RTF reader: removes formatting codes and keeps the text.
function rtfToText(rtf) {
  const SKIP_WORDS = new Set([
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "object",
    "themedata", "colorschememapping", "datastore", "latentstyles",
    "listtable", "listoverridetable", "rsidtbl", "generator",
    "xmlnstbl", "fldinst"
  ]);

  const out = [];
  const stack = [];
  let skip = false;
  let i = 0;

  while (i < rtf.length) {
    const ch = rtf[i];

    if (ch === "{") {
      stack.push(skip);
      if (rtf[i + 1] === "\\" && rtf[i + 2] === "*") skip = true;
      i++;
    } else if (ch === "}") {
      skip = stack.length ? stack.pop() : false;
      i++;
    } else if (ch === "\\") {
      const next = rtf[i + 1];

      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);

        if (!skip && /^[0-9a-fA-F]{2}$/.test(hex)) {
          out.push(String.fromCharCode(parseInt(hex, 16)));
        }

        i += 4;
      } else if (next !== undefined && /[a-zA-Z]/.test(next)) {
        let j = i + 1;
        while (j < rtf.length && /[a-zA-Z]/.test(rtf[j])) j++;

        const word = rtf.slice(i + 1, j);

        let k = j;
        if (rtf[k] === "-" && /\d/.test(rtf[k + 1] || "")) k++;
        while (k < rtf.length && /\d/.test(rtf[k])) k++;

        const param = rtf.slice(j, k);

        if (rtf[k] === " ") k++;
        i = k;

        if (SKIP_WORDS.has(word)) {
          skip = true;
        } else if (!skip) {
          if (["par", "line", "sect", "page", "row"].includes(word)) {
            out.push("\n");
          } else if (word === "tab" || word === "cell") {
            out.push("\t");
          } else if (word === "u" && param) {
            let code = parseInt(param, 10);
            if (code < 0) code += 65536;
            out.push(String.fromCharCode(code));

            // Skip the fallback character that follows a unicode value.
            if (rtf[i] === "\\" && rtf[i + 1] === "'") {
              i += 4;
            } else if (
              rtf[i] !== undefined &&
              rtf[i] !== "\\" && rtf[i] !== "{" && rtf[i] !== "}"
            ) {
              i += 1;
            }
          }
        }
      } else {
        if (!skip) {
          if (next === "\\" || next === "{" || next === "}") out.push(next);
          else if (next === "\n" || next === "\r") out.push("\n");
          else if (next === "~") out.push(" ");
          else if (next === "_") out.push("-");
        }

        i += 2;
      }
    } else {
      if (!skip && ch !== "\r" && ch !== "\n") out.push(ch);
      i++;
    }
  }

  return out.join("");
}

// ZIP archives: each supported file inside is scanned as its own result row.
const ZIP_MAX_ENTRIES = 5000;
const ZIP_MAX_ENTRY_BYTES = 200 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const ZIP_MAX_DEPTH = 3;

function errorRow(fileName, filePath, message) {
  return {
    fileName,
    filePath,
    status: "error",
    totalFindings: 0,
    findings: [],
    error: message
  };
}

async function scanZipFile(zipPath, piiType, depth = 0, label = null) {
  const displayName = label || path.basename(zipPath);
  const results = [];

  let zip;

  try {
    zip = new AdmZip(zipPath);
  } catch (error) {
    return [errorRow(displayName, zipPath, "Could not open archive: " + error.message)];
  }

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pii-scan-"));

  let processed = 0;
  let totalBytes = 0;

  try {
    for (const entry of entries) {
      const extension = path.extname(entry.entryName).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.includes(extension)) continue;

      const entryLabel = displayName + " → " + entry.entryName;

      if (processed >= ZIP_MAX_ENTRIES) {
        results.push(errorRow(displayName, zipPath, "Archive has too many files. Remaining files were skipped."));
        break;
      }

      if (entry.header.size > ZIP_MAX_ENTRY_BYTES) {
        results.push(errorRow(entryLabel, zipPath, "File inside the archive is larger than 200 MB and was skipped."));
        continue;
      }

      totalBytes += entry.header.size;

      if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
        results.push(errorRow(displayName, zipPath, "Archive is larger than 1 GB when unpacked. Remaining files were skipped."));
        break;
      }

      processed++;

      // A safe temporary name is used, never the name stored in the archive.
      const tempFile = path.join(tempDir, processed + extension);

      try {
        fs.writeFileSync(tempFile, entry.getData());

        if (extension === ".zip") {
          if (depth + 1 >= ZIP_MAX_DEPTH) {
            throw new Error("Nested archive is too deep.");
          }

          results.push(
            ...(await scanZipFile(tempFile, piiType, depth + 1, entryLabel))
          );
        } else {
          const text = await extractText(tempFile);
          const findings = findPII(text, piiType);

          results.push({
            fileName: entryLabel,
            filePath: zipPath,
            status: "success",
            totalFindings: findings.length,
            findings
          });
        }
      } catch (error) {
        results.push(errorRow(entryLabel, zipPath, error.message));
      } finally {
        fs.rmSync(tempFile, { force: true });
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (!results.length) {
    results.push({
      fileName: displayName,
      filePath: zipPath,
      status: "success",
      totalFindings: 0,
      findings: []
    });
  }

  return results;
}

// ==================================================
// OCR: READ TEXT FROM IMAGES (runs on this computer)
// ==================================================

const MAX_IMAGE_BYTES = 30 * 1024 * 1024; // 30 MB per image
let ocrWorker = null;

async function getOcrWorker() {
  if (!ocrWorker) {
    // The English language data is downloaded once on first use
    // and then cached, so later scans work offline.
    ocrWorker = await createWorker("eng", 1, {
      cachePath: app.getPath("userData")
    });
  }

  return ocrWorker;
}

async function ocrImage(filePath) {
  if (fs.statSync(filePath).size > MAX_IMAGE_BYTES) {
    throw new Error("Image is larger than 30 MB and was skipped.");
  }

  const worker = await getOcrWorker();
  const result = await worker.recognize(filePath);

  return result.data.text || "";
}

// ==================================================
// EXTRACT TEXT FROM FILES
// ==================================================


async function extractText(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  // TXT, CSV, JSON, LOG and other text-based files
  if (TEXT_EXTENSIONS.includes(extension)) {
    return readTextFile(filePath);
  }

  // PDF files
  if (extension === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const result = await pdfParse(buffer);
    return result.text || "";
  }

  // DOCX files
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({
      path: filePath
    });

    return result.value || "";
  }

  // Excel files: XLSX and XLS
    if ([".xlsx", ".xls", ".xlsm", ".xlsb"].includes(extension)) {
    const workbook = XLSX.readFile(filePath);

    return workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      return XLSX.utils.sheet_to_csv(worksheet);
    }).join("\n");
  }

  // PPTX, ODT, ODP and ODS files
  if (OFFICE_ZIP_EXTENSIONS.includes(extension)) {
    return extractOfficeZipText(filePath, extension);
  }

  // Older Word DOC files
  if (extension === ".doc") {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(filePath);

    return [
      doc.getBody(),
      doc.getHeaders(),
      doc.getFootnotes(),
      doc.getEndnotes()
    ]
      .filter(Boolean)
      .join("\n");
  }

    // RTF files
  if (extension === ".rtf") {
    return rtfToText(fs.readFileSync(filePath, "latin1"));
  }

  // Image files (OCR)
  if (IMAGE_EXTENSIONS.includes(extension)) {
    return ocrImage(filePath);
  }

  throw new Error("Unsupported file type.");
}

// ==================================================
// BUILT-IN PII DETECTION PATTERNS
// ==================================================

const patterns = {
  email: {
    label: "Email",
    regex: /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+\b/gi
  },

  phone: {
    label: "Phone number",
    regex: /(?<!\d)(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g
  },

  aadhaar: {
    label: "Aadhaar-like number",
    regex: /(?<!\d)(?<!\d[ -])(?:\d{4}[ -]\d{4}[ -]\d{4}|\d{12})(?!\d)(?![ -]\d)/g
  },

  pan: {
    label: "PAN-like number",
    regex: /\b[A-Z]{5}\d{4}[A-Z]\b/gi
  },

  ip: {
    label: "IPv4 address",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g
  },

  creditCard: {
    label: "Credit-card-like number",
    regex: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g
  },

  dob: {
    label: "Date of birth-like value",
    regex: /\b(?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])[/-](?:19|20)\d{2}\b/g
  }
};

// ==================================================
// FIND PII
// Supports all built-in and enabled custom rules.
// piiType can be "all", a built-in key, or "custom:ID".
// ==================================================

function findPII(text, piiType = "all") {
  const detections = [];

  for (const [key, pattern] of Object.entries(patterns)) {
    if (piiType !== "all" && piiType !== key) {
      continue;
    }

    detections.push({
      key,
      label: pattern.label,
      pattern: pattern.regex.source,
      flags: pattern.regex.flags
    });
  }

  const customRules = queryAll(`
    SELECT id, name, pattern
    FROM detection_rules
    WHERE enabled = 1
    ORDER BY id
  `);

  for (const rule of customRules) {
    const key = `custom:${rule.id}`;

    if (piiType !== "all" && piiType !== key) {   
      continue;
    }

    detections.push({
      key,
      label: rule.name,
      pattern: rule.pattern,
      flags: "gi"
    });
  }

  const findings = [];

  for (const detection of detections) {
    let regex;

    try {
      regex = new RegExp(detection.pattern, detection.flags);
    } catch (error) {
      console.error(
        `Invalid detection rule "${detection.label}":`,
        error.message
      );
      continue;
    }

    let match;

    while ((match = regex.exec(text)) !== null) {
      findings.push({
        type: detection.label,
        value: match[0],
        index: match.index
      });

      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
  }

  findings.sort((a, b) => a.index - b.index);

  const uniqueFindings = [];
  const seen = new Set();

  for (const finding of findings) {
    const key = `${finding.type}|${finding.index}|${finding.value}`;

    if (!seen.has(key)) {
      seen.add(key);
      uniqueFindings.push(finding);
    }
  }

  return uniqueFindings;
}

// ==================================================
// SCAN LARGE TEXT FILES IN CHUNKS (no size limit)
// ==================================================

async function scanLargeTextFile(filePath, piiType) {
  const stream = fs.createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 8 * 1024 * 1024
  });

  const allFindings = [];
  const seen = new Set();

  let tail = "";
  let tailStart = 0; // position of tail's first character in the whole file

  function addFindings(found, offset, textLength, isFinal) {
    for (const finding of found) {
      const end = finding.index + finding.value.length;

      // Skip matches that touch the end of a chunk; the next chunk
      // sees them whole because of the overlap.
      if (!isFinal && end > textLength - CHUNK_OVERLAP / 2) continue;

      const absoluteIndex = offset + finding.index;
      const key = `${finding.type}|${absoluteIndex}|${finding.value}`;

      if (!seen.has(key)) {
        seen.add(key);
        allFindings.push({ ...finding, index: absoluteIndex });
      }
    }
  }

  for await (const chunk of stream) {
    const text = tail + chunk;

    addFindings(findPII(text, piiType), tailStart, text.length, false);

    const keep = Math.min(CHUNK_OVERLAP, text.length);
    tailStart += text.length - keep;
    tail = text.slice(text.length - keep);
  }

  // Check the last piece completely.
  addFindings(findPII(tail, piiType), tailStart, tail.length, true);

  allFindings.sort((a, b) => a.index - b.index);

  return allFindings;
}

// ==================================================
// LOCAL DRIVES
// ==================================================

const SYSTEM_FOLDERS = new Set([
  "windows", "program files", "program files (x86)", "programdata",
  "$recycle.bin", "system volume information", "appdata", "recovery",
  "$windows.~bt", "$winreagent", "msocache"
]);

const MAX_DRIVE_FILES = 20000;

async function getDrives() {
  if (process.platform !== "win32") {
    return ["/"];
  }

  const drives = [];

  for (let code = 65; code <= 90; code++) {
    const root = String.fromCharCode(code) + ":\\";

    try {
      await fs.promises.access(root);
      drives.push(root);
    } catch {
      // Drive letter not in use.
    }
  }

  return drives;
}

async function collectFilesAsync(root, skipSystem, maxFiles) {
  const files = [];
  const stack = [root];

  while (stack.length) {
    const folder = stack.pop();
    let entries;

    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        const skip =
          SKIPPED_FOLDERS.has(entry.name) ||
          (skipSystem && SYSTEM_FOLDERS.has(entry.name.toLowerCase()));

        if (!skip) stack.push(fullPath);
      } else if (
        entry.isFile() &&
        SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())
      ) {
        files.push(fullPath);

        if (files.length >= maxFiles) {
          return { files, truncated: true };
        }
      }
    }
  }

  return { files, truncated: false };
}

ipcMain.handle("list-drives", async () => {
  return getDrives();
});

ipcMain.handle("collect-drive-files", async (_event, drivePath) => {
  if (typeof drivePath !== "string") {
    throw new Error("Invalid drive.");
  }

  const drives = await getDrives();

  if (!drives.includes(drivePath)) {
    throw new Error("Drive not found.");
  }

  return collectFilesAsync(drivePath, true, MAX_DRIVE_FILES);
});


// ==================================================
// SELECT FILES
// ==================================================

ipcMain.handle("select-files", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select files to scan",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Supported Documents",
        extensions: SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1))
      }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

// ==================================================
// SELECT FOLDER
// ==================================================

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select folder to scan",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  const selectedFolder = result.filePaths[0];
  const collectedFiles = [];

  function collectFiles(folderPath) {
    let entries;

    try {
      entries = fs.readdirSync(folderPath, {
        withFileTypes: true
      });
    } catch (error) {
      console.error(
        "Could not read folder:",
        folderPath,
        error.message
      );
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          collectFiles(fullPath);
        }
      } else if (
        entry.isFile() &&
        SUPPORTED_EXTENSIONS.includes(
          path.extname(entry.name).toLowerCase()
        )
      ) {
        collectedFiles.push(fullPath);
      }
    }
  }

  collectFiles(selectedFolder);

  return collectedFiles;
});

// ==================================================
// SCAN FILES
// ==================================================

ipcMain.handle(
  "scan-files",
  async (_event, filePaths, piiType = "all") => {
    if (!Array.isArray(filePaths)) {
      throw new Error("Invalid file list.");
    }

    if (typeof piiType !== "string") {
      throw new Error("Invalid detection type.");
    }

    const results = [];

    for (const filePath of filePaths) {
      try {
        if (
          typeof filePath !== "string" ||
          !SUPPORTED_EXTENSIONS.includes(
            path.extname(filePath).toLowerCase()
          )
        ) {
          throw new Error("Unsupported file type.");
        }

        const extension = path.extname(filePath).toLowerCase();
                if (extension === ".zip") {
          results.push(...(await scanZipFile(filePath, piiType)));
          continue;
        }
        let findings;

        if (
          TEXT_EXTENSIONS.includes(extension) &&
          fs.statSync(filePath).size > LARGE_FILE_THRESHOLD
        ) {
          // Very large text/log files: scan in chunks, no size limit.
          findings = await scanLargeTextFile(filePath, piiType);
        } else {
          const text = await extractText(filePath);
          findings = findPII(text, piiType);
        }

        results.push({
          fileName: path.basename(filePath),
          filePath,
          status: "success",
          totalFindings: findings.length,
          findings
        });
      } catch (error) {
        results.push({
          fileName:
            typeof filePath === "string"
              ? path.basename(filePath)
              : "Unknown file",
          filePath,
          status: "error",
          totalFindings: 0,
          findings: [],
          error: error.message
        });
      }
    }

    return results;
  }
);

// ==================================================
// APP LIFECYCLE
// ==================================================

app.whenReady().then(async () => {
  try {
    await initializeDatabase();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error("Failed to initialize database:", error);

    dialog.showErrorBox(
      "Database Error",
      "The database could not be initialized. Check the terminal for details."
    );

    app.quit();
  }
});

