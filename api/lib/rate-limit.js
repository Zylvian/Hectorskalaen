const MINUTE_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_MINUTE = 40;
const MAX_PER_HOUR = 200;

/** @type {Map<string, number[]>} */
const hitsByIp = new Map();

function header(req, name) {
  const headers = req && req.headers ? req.headers : {};
  const value = headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  return typeof value === "string" ? value.trim() : "";
}

function clientIp(req) {
  const azure = header(req, "x-azure-clientip") || header(req, "x-client-ip") || header(req, "x-real-ip");
  if (azure) return azure.split(",")[0].trim();
  const forwarded = header(req, "x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    // Last hop is added by the edge proxy and is harder to spoof than the first.
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || req.ip || "unknown";
}

function prune(now) {
  if (hitsByIp.size < 2000) return;
  for (const [ip, hits] of hitsByIp) {
    const recent = hits.filter((t) => now - t < HOUR_MS);
    if (recent.length) hitsByIp.set(ip, recent);
    else hitsByIp.delete(ip);
  }
}

function assertPostAllowed(req) {
  const ip = clientIp(req);
  const now = Date.now();
  prune(now);
  const hits = (hitsByIp.get(ip) || []).filter((t) => now - t < HOUR_MS);
  const lastMinute = hits.filter((t) => now - t < MINUTE_MS);
  if (lastMinute.length >= MAX_PER_MINUTE || hits.length >= MAX_PER_HOUR) {
    const err = new Error("For mange stemmer fra samme nettverk. Vent et øyeblikk.");
    err.status = 429;
    throw err;
  }
  hits.push(now);
  hitsByIp.set(ip, hits);
}

function resetForTests() {
  hitsByIp.clear();
}

module.exports = {
  clientIp,
  assertPostAllowed,
  resetForTests,
  MAX_PER_MINUTE,
  MAX_PER_HOUR,
};
