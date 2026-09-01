import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rateLimit = require("../api/lib/rate-limit.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function reqWithIp(ip, forwarded) {
  return {
    headers: forwarded
      ? { "x-forwarded-for": forwarded }
      : { "x-azure-clientip": ip },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

function main() {
  rateLimit.resetForTests();
  const first = reqWithIp("203.0.113.10");
  for (let i = 0; i < rateLimit.MAX_PER_MINUTE; i += 1) {
    rateLimit.assertPostAllowed(first);
  }
  let blocked = false;
  try {
    rateLimit.assertPostAllowed(first);
  } catch (err) {
    blocked = err.status === 429;
  }
  assert(blocked, "41st vote in a minute from the same IP should be 429");

  const other = reqWithIp("203.0.113.11");
  rateLimit.assertPostAllowed(other);

  const spoofed = reqWithIp(null, "198.51.100.1, 203.0.113.50");
  assert(rateLimit.clientIp(spoofed) === "203.0.113.50", "should use the last X-Forwarded-For hop");

  console.log("Rate-limit checks passed.");
}

main();
