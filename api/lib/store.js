const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

const SEED_VISITOR = "seed:editorial";
const ALLOWED_ID = /^[a-z0-9:-]{3,80}$/i;
const ALLOWED_VISITOR = /^[a-z0-9-]{8,64}$/i;
const COMMENT_MAX = 280;
const ALLOWED_COMMENT_ID = /^[a-f0-9]{16}$/;

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

function roundToTenth(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
}

function emptyStats() {
  return {
    average: null,
    count: 0,
    histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    comments: [],
    votes: [],
  };
}

function publicCommentId(barId, visitorId) {
  return createHash("sha256").update(`${barId}:${visitorId}`).digest("hex").slice(0, 16);
}

function voteValue(value) {
  const n = Number(value);
  if (n === 1 || n === -1) return n;
  return 0;
}

function tallyVotes(votes, barId, authorId, viewerId) {
  let upvotes = 0;
  let downvotes = 0;
  let myVote = 0;
  for (const vote of votes) {
    if (vote.barId !== barId || vote.authorId !== authorId) continue;
    const value = voteValue(vote.value);
    if (!value) continue;
    if (value === 1) upvotes += 1;
    else downvotes += 1;
    if (viewerId && vote.voterId === viewerId) myVote = value;
  }
  return { upvotes, downvotes, myVote };
}
function sanitizeComment(value) {
  if (value == null) return "";
  if (typeof value !== "string") {
    throw httpError(400, "Ugyldig kommentar.");
  }
  const text = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > COMMENT_MAX) {
    throw httpError(400, `Kommentaren er for lang (maks ${COMMENT_MAX} tegn).`);
  }
  const links = text.match(/https?:\/\//gi) || [];
  if (links.length > 1) {
    throw httpError(400, "Maks én lenke i kommentaren.");
  }
  return text;
}

function aggregate(rows, votes = [], viewerId = null) {
  const byBar = new Map();
  for (const row of rows) {
    let entry = byBar.get(row.barId);
    if (!entry) {
      entry = {
        sum: 0,
        count: 0,
        histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        comments: [],
        votes: [],
      };
      byBar.set(row.barId, entry);
    }
    entry.sum += row.score;
    entry.count += 1;
    entry.histogram[row.score - 1] += 1;
    const text = typeof row.comment === "string" ? row.comment.trim() : "";
    if (row.visitorId !== SEED_VISITOR) {
      entry.votes.push({
        score: row.score,
        updatedAt: row.updatedAt || null,
      });
    }
    if (text && row.visitorId !== SEED_VISITOR) {
      const counts = tallyVotes(votes, row.barId, row.visitorId, viewerId);
      entry.comments.push({
        id: publicCommentId(row.barId, row.visitorId),
        score: row.score,
        comment: text,
        updatedAt: row.updatedAt || null,
        upvotes: counts.upvotes,
        downvotes: counts.downvotes,
        myVote: counts.myVote,
        own: Boolean(viewerId && viewerId === row.visitorId),
      });
    }
  }
  const ratings = {};
  for (const [barId, entry] of byBar) {
    entry.comments.sort(
      (a, b) =>
        b.upvotes - a.upvotes ||
        a.downvotes - b.downvotes ||
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
    );
    entry.votes.sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
    );
    ratings[barId] = {
      average: roundToTenth(entry.sum / entry.count),
      count: entry.count,
      histogram: entry.histogram,
      comments: entry.comments.slice(0, 40),
      votes: entry.votes,
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
  let mem = { ratings: [], votes: [] };
  let queue = Promise.resolve();

  function locked(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function read() {
    try {
      const raw = JSON.parse(await readFile(filePath, "utf8"));
      mem = {
        ratings: Array.isArray(raw.ratings) ? raw.ratings : [],
        votes: Array.isArray(raw.votes) ? raw.votes : [],
      };
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      mem = { ratings: [], votes: [] };
    }
    return mem;
  }

  async function write() {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(mem, null, 2)}\n`, "utf8");
  }

  return {
    async allRows() {
      return locked(async () => {
        const data = await read();
        return data.ratings.map((r) => ({
          barId: r.barId,
          visitorId: r.visitorId,
          score: r.score,
          comment: typeof r.comment === "string" ? r.comment : "",
          updatedAt: r.updatedAt || r.createdAt || null,
        }));
      });
    },
    async upsert({ barId, visitorId, score, comment, createdAt }) {
      return locked(async () => {
        const data = await read();
      const idx = data.ratings.findIndex(
        (r) => r.barId === barId && r.visitorId === visitorId
      );
      if (idx >= 0) {
        data.ratings[idx] = {
          ...data.ratings[idx],
          score,
          comment,
          updatedAt: createdAt,
        };
      } else {
        data.ratings.push({
          barId,
          visitorId,
          score,
          comment,
          createdAt,
          updatedAt: createdAt,
        });
      }
      mem = data;
      await write();
      });
    },
    async allVotes() {
      return locked(async () => {
        const data = await read();
        return (data.votes || []).map((v) => ({
          barId: v.barId,
          authorId: v.authorId,
          voterId: v.voterId,
          value: voteValue(v.value),
        }));
      });
    },
    async upsertVote({ barId, authorId, voterId, value }) {
      return locked(async () => {
        const data = await read();
        if (!Array.isArray(data.votes)) data.votes = [];
        const idx = data.votes.findIndex(
          (v) => v.barId === barId && v.authorId === authorId && v.voterId === voterId
        );
        if (idx >= 0 && voteValue(data.votes[idx].value) === value) {
          data.votes.splice(idx, 1);
        } else if (idx >= 0) {
          data.votes[idx] = {
            ...data.votes[idx],
            value,
            updatedAt: new Date().toISOString(),
          };
        } else {
          data.votes.push({
            barId,
            authorId,
            voterId,
            value,
            updatedAt: new Date().toISOString(),
          });
        }
        mem = data;
        await write();
      });
    },
    async seedIfEmpty(seeds) {
      return locked(async () => {
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
      });
    },
  };
}

function mapTursoRows(result) {
  return (result.rows || []).map((row) => ({
    barId: row.bar_id,
    visitorId: row.visitor_id,
    score: Number(row.score),
    comment: typeof row.comment === "string" ? row.comment : "",
    updatedAt: row.updated_at || row.created_at || null,
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
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (bar_id, visitor_id)
      )
    `);
    await client.execute(
      `CREATE INDEX IF NOT EXISTS ratings_bar_id ON ratings (bar_id)`
    );
    try {
      await client.execute(`ALTER TABLE ratings ADD COLUMN comment TEXT`);
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      if (!/duplicate column|already exists/i.test(message)) throw err;
    }
    await client.execute(`
      CREATE TABLE IF NOT EXISTS comment_votes (
        bar_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        voter_id TEXT NOT NULL,
        value INTEGER NOT NULL CHECK (value IN (-1, 1)),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (bar_id, author_id, voter_id)
      )
    `);
    ready = true;
  }

  return {
    async allRows() {
      await ensureSchema();
      const result = await client.execute(
        "SELECT bar_id, visitor_id, score, comment, created_at, updated_at FROM ratings"
      );
      return mapTursoRows(result);
    },
    async allVotes() {
      await ensureSchema();
      const result = await client.execute(
        "SELECT bar_id, author_id, voter_id, value FROM comment_votes"
      );
      return (result.rows || []).map((row) => ({
        barId: row.bar_id,
        authorId: row.author_id,
        voterId: row.voter_id,
        value: voteValue(row.value),
      }));
    },
    async upsertVote({ barId, authorId, voterId, value }) {
      await ensureSchema();
      const existing = await client.execute({
        sql: `SELECT value FROM comment_votes WHERE bar_id = ? AND author_id = ? AND voter_id = ?`,
        args: [barId, authorId, voterId],
      });
      const current = existing.rows?.[0] ? voteValue(existing.rows[0].value) : 0;
      if (current === value) {
        await client.execute({
          sql: `DELETE FROM comment_votes WHERE bar_id = ? AND author_id = ? AND voter_id = ?`,
          args: [barId, authorId, voterId],
        });
        return;
      }
      await client.execute({
        sql: `
          INSERT INTO comment_votes (bar_id, author_id, voter_id, value, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(bar_id, author_id, voter_id) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `,
        args: [barId, authorId, voterId, value],
      });
    },
    async upsert({ barId, visitorId, score, comment, createdAt }) {
      await ensureSchema();
      await client.execute({
        sql: `
          INSERT INTO ratings (bar_id, visitor_id, score, comment, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(bar_id, visitor_id) DO UPDATE SET
            score = excluded.score,
            comment = excluded.comment,
            updated_at = excluded.updated_at
        `,
        args: [barId, visitorId, score, comment, createdAt, createdAt],
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

async function getAggregates(viewerId = null) {
  const { backend } = await getBackend();
  const [rows, votes] = await Promise.all([backend.allRows(), backend.allVotes()]);
  return {
    ratings: aggregate(rows, votes, viewerId),
    persistence: persistenceMode(),
  };
}

async function upsertCommentVote({ barId, commentId, visitorId, vote }) {
  if (typeof barId !== "string" || !ALLOWED_ID.test(barId)) {
    throw httpError(400, "Ugyldig bar.");
  }
  if (typeof commentId !== "string" || !ALLOWED_COMMENT_ID.test(commentId)) {
    throw httpError(400, "Ugyldig kommentar.");
  }
  if (typeof visitorId !== "string" || !ALLOWED_VISITOR.test(visitorId)) {
    throw httpError(400, "Mangler gyldig besøks-id.");
  }
  const value = Number(vote);
  if (value !== 1 && value !== -1) {
    throw httpError(400, "Stem 1 for like eller -1 for dislike.");
  }

  const { backend, catalog } = await getBackend();
  if (!catalog.ids.has(barId)) {
    throw httpError(404, "Baren finnes ikke i katalogen.");
  }

  const rows = await backend.allRows();
  const author = rows.find(
    (row) =>
      row.barId === barId &&
      publicCommentId(row.barId, row.visitorId) === commentId &&
      String(row.comment || "").trim()
  );
  if (!author) {
    throw httpError(404, "Kommentaren finnes ikke.");
  }
  if (author.visitorId === visitorId) {
    throw httpError(400, "Du kan ikke stemme på din egen kommentar.");
  }

  await backend.upsertVote({
    barId,
    authorId: author.visitorId,
    voterId: visitorId,
    value,
  });

  const all = await getAggregates(visitorId);
  return {
    barId,
    stats: all.ratings[barId] || emptyStats(),
    ratings: all.ratings,
    persistence: all.persistence,
  };
}

async function upsertRating({ barId, score, visitorId, comment }) {
  if (typeof barId !== "string" || !ALLOWED_ID.test(barId)) {
    throw httpError(400, "Ugyldig bar.");
  }
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw httpError(400, "Gi en score mellom 1 og 10.");
  }
  if (typeof visitorId !== "string" || !ALLOWED_VISITOR.test(visitorId)) {
    throw httpError(400, "Mangler gyldig besøks-id.");
  }
  const cleanComment = sanitizeComment(comment);

  const { backend, catalog } = await getBackend();
  if (!catalog.ids.has(barId)) {
    throw httpError(404, "Baren finnes ikke i katalogen.");
  }

  await backend.upsert({
    barId,
    visitorId,
    score,
    comment: cleanComment,
    createdAt: new Date().toISOString(),
  });

  const all = await getAggregates(visitorId);
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
  upsertCommentVote,
  resetForTests,
  persistenceMode,
  SEED_VISITOR,
  COMMENT_MAX,
};
