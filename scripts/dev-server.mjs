import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("../api/lib/store.js");

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC_DIR = join(ROOT, "src");
const PORT = Number(process.env.PORT) || 8000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/api/ratings") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET") {
      sendJson(res, 200, await store.getAggregates(url.searchParams.get("visitorId")));
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (body.commentId != null || body.vote != null) {
        sendJson(
          res,
          200,
          await store.upsertCommentVote({
            barId: body.barId,
            commentId: body.commentId,
            visitorId: body.visitorId,
            vote: body.vote,
          })
        );
        return;
      }
      sendJson(
        res,
        200,
        await store.upsertRating({
          barId: body.barId,
          score: Number(body.score),
          visitorId: body.visitorId,
          comment: body.comment,
        })
      );
      return;
    }
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    sendJson(res, status, { error: err.message || "Server error" });
  }
}

function safeFile(urlPath) {
  const relative = urlPath === "/" ? "/index.html" : urlPath;
  const decoded = decodeURIComponent(relative.split("?")[0]);
  const resolved = normalize(join(PUBLIC_DIR, decoded));
  if (!resolved.startsWith(PUBLIC_DIR)) return null;
  return resolved;
}

function serveStatic(req, res) {
  const filePath = safeFile(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const type = TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((err) => {
      sendJson(res, 500, { error: err.message || "Server error" });
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Hectorskalaen running at http://localhost:${PORT}`);
});
