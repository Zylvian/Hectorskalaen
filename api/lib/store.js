const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");

const SEED_VISITOR = "seed:editorial";
const ALLOWED_ID = /^[a-z0-9:-]{3,80}$/i;
const ALLOWED_VISITOR = /^[a-z0-9-]{8,64}$/i;

let catalogCache = null;
let backendPromise = null;

function persistenceMode() {
  if (process.env.TURSO_DATABASE_URL) return "turso";
  if (process.env.WEBSITE_INSTANCE_ID || process.env.FUNCTIONS_WORKER_RUNTIME) {
    return "ephemeral";
  }
  return "file";
}

function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, "..", "..", ".env");
    const text = require("node:fs").readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = value;
    }
  } catch {
    /* no .env in this environment */
  }
}

function loadRuntimeConfig() {
  try {
    const configPath = path.join(__dirname, "..", "runtime-config.json");
    const raw = JSON.parse(require("node:fs").readFileSync(configPath, "utf8"));
    if (raw.TURSO_DATABASE_URL && process.env.TURSO_DATABASE_URL == null) {
      process.env.TURSO_DATABASE_URL = String(raw.TURSO_DATABASE_URL);
    }
    if (raw.TURSO_AUTH_TOKEN && process.env.TURSO_AUTH_TOKEN == null) {
      process.env.TURSO_AUTH_TOKEN = String(raw.TURSO_AUTH_TOKEN);
    }
  } catch {
    /* no deploy-time config */
  }
}

loadDotEnv();
loadRuntimeConfig();

function ratingsFilePath() {
  if (process.env.RATINGS_FILE) return process.env.RATINGS_FILE;
  if (persistenceMode() === "ephemeral") {
    return "/tmp/hectorskalaen-ratings.json";
  }
  return path.join(process.cwd(), "data", "ratings.json");
}

function seedsPath() {
  return path.join(__dirname, "..", "data", "seeds.json");
}

async function loadCatalog() {
  if (catalogCache) return catalogCache;
  const raw = JSON.parse(await readFile(seedsPath(), "utf8"));
  catalogCache = {
    ids: new Set(raw.ids),
    seeds: raw.seeds || [],
  };
  return catalogCache;
}

function emptyStats() {
  return { average: null, count: 0, histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
}

function aggregate(rows) {
  const byBar = new Map();
  for (const row of rows) {
    let entry = byBar.get(row.barId);
    if (!entry) {
      entry = { sum: 0, count: 0, histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
      byBar.set(row.barId, entry);
    }
    entry.sum += row.score;
    entry.count += 1;
    entry.histogram[row.score - 1] += 1;
  }
  const ratings = {};
  for (const [barId, entry] of byBar) {
    ratings[barId] = {
      average: Math.round((entry.sum / entry.count) * 10) / 10,
      count: entry.count,
      histogram: entry.histogram,
    };
  }
  return ratings;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function createJsonBackend(filePath) {
  let mem = { ratings: [] };

  async function read() {
    try {
      const raw = JSON.parse(await readFile(filePath, "utf8"));
      mem = { ratings: Array.isArray(raw.ratings) ? raw.ratings : [] };
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      mem = { ratings: [] };
    }
    return mem;
  }

  async function write() {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(mem, null, 2)}\n`, "utf8");
  }

  return {
    async allRows() {
      const data = await read();
      return data.ratings.map((r) => ({
        barId: r.barId,
        visitorId: r.visitorId,
        score: r.score,
      }));
    },
    async upsert({ barId, visitorId, score, createdAt }) {
      const data = await read();
      const idx = data.ratings.findIndex(
        (r) => r.barId === barId && r.visitorId === visitorId
      );
      if (idx >= 0) {
        data.ratings[idx] = {
          ...data.ratings[idx],
          score,
          updatedAt: createdAt,
        };
      } else {
        data.ratings.push({
          barId,
          visitorId,
          score,
          createdAt,
          updatedAt: createdAt,
        });
      }
      mem = data;
      await write();
    },
    async seedIfEmpty(seeds) {
      const data = await read();
      const haveSeed = new Set(
        data.ratings
          .filter((r) => r.visitorId === SEED_VISITOR)
          .map((r) => r.barId)
      );
      let changed = false;
      for (const seed of seeds) {
        if (haveSeed.has(seed.id)) continue;
        data.ratings.push({
          barId: seed.id,
          visitorId: SEED_VISITOR,
          score: seed.score,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        changed = true;
      }
      if (changed) {
        mem = data;
        await write();
      }
    },
  };
}

function mapTursoRows(result) {
  return (result.rows || []).map((row) => ({
    barId: row.bar_id,
    visitorId: row.visitor_id,
    score: Number(row.score),
  }));
}

function createTursoBackend(url, authToken) {
  const { createClient } = require("@libsql/client");
  const client = createClient({ url, authToken });
  let ready = false;

  async function ensureSchema() {
    if (ready) return;
    await client.execute(`
      CREATE TABLE IF NOT EXISTS ratings (
        bar_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        score INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (bar_id, visitor_id)
      )
    `);
    await client.execute(
      `CREATE INDEX IF NOT EXISTS ratings_bar_id ON ratings (bar_id)`
    );
    ready = true;
  }

  return {
    async allRows() {
      await ensureSchema();
      const result = await client.execute(
        "SELECT bar_id, visitor_id, score FROM ratings"
      );
      return mapTursoRows(result);
    },
    async upsert({ barId, visitorId, score, createdAt }) {
      await ensureSchema();
      await client.execute({
        sql: `
          INSERT INTO ratings (bar_id, visitor_id, score, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(bar_id, visitor_id) DO UPDATE SET
            score = excluded.score,
            updated_at = excluded.updated_at
        `,
        args: [barId, visitorId, score, createdAt, createdAt],
      });
    },
    async seedIfEmpty(seeds) {
      await ensureSchema();
      for (const seed of seeds) {
        await client.execute({
          sql: `
            INSERT OR IGNORE INTO ratings (bar_id, visitor_id, score)
            VALUES (?, ?, ?)
          `,
          args: [seed.id, SEED_VISITOR, seed.score],
        });
      }
    },
  };
}

async function getBackend() {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    const catalog = await loadCatalog();
    const url = process.env.TURSO_DATABASE_URL;
    const backend = url
      ? createTursoBackend(url, process.env.TURSO_AUTH_TOKEN)
      : createJsonBackend(ratingsFilePath());
    await backend.seedIfEmpty(catalog.seeds);
    return { backend, catalog };
  })();
  return backendPromise;
}

async function getAggregates() {
  const { backend } = await getBackend();
  const rows = await backend.allRows();
  return {
    ratings: aggregate(rows),
    persistence: persistenceMode(),
  };
}

async function upsertRating({ barId, score, visitorId }) {
  if (typeof barId !== "string" || !ALLOWED_ID.test(barId)) {
    throw httpError(400, "Ugyldig bar.");
  }
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw httpError(400, "Gi en score mellom 1 og 10.");
  }
  if (typeof visitorId !== "string" || !ALLOWED_VISITOR.test(visitorId)) {
    throw httpError(400, "Mangler gyldig besøks-id.");
  }

  const { backend, catalog } = await getBackend();
  if (!catalog.ids.has(barId)) {
    throw httpError(404, "Baren finnes ikke i katalogen.");
  }

  await backend.upsert({
    barId,
    visitorId,
    score,
    createdAt: new Date().toISOString(),
  });

  const all = await getAggregates();
  return {
    barId,
    stats: all.ratings[barId] || emptyStats(),
    ratings: all.ratings,
    persistence: all.persistence,
  };
}

function resetForTests() {
  catalogCache = null;
  backendPromise = null;
}

module.exports = {
  getAggregates,
  upsertRating,
  resetForTests,
  persistenceMode,
  SEED_VISITOR,
};
