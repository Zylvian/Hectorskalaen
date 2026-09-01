import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "hectorskalaen-"));
  process.env.RATINGS_FILE = join(dir, "ratings.json");
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.WEBSITE_INSTANCE_ID;
  delete process.env.FUNCTIONS_WORKER_RUNTIME;

  const store = require("../api/lib/store.js");
  store.resetForTests();

  const first = await store.getAggregates();
  assert(first.persistence === "file", `expected file persistence, got ${first.persistence}`);
  assert(first.ratings["osm-n2839876148"].average === 10, "Hector seed rating should be 10");
  assert(first.ratings["osm-n2839876148"].count === 1, "Hector should start with the editorial seed vote");

  const visitorId = "11111111-1111-4111-8111-111111111111";
  const updated = await store.upsertRating({
    barId: "osm-n2839876148",
    score: 8,
    visitorId,
  });
  assert(updated.stats.count === 2, "user vote should add to the seed");
  assert(updated.stats.average === 9, `expected 9, got ${updated.stats.average}`);

  const changed = await store.upsertRating({
    barId: "osm-n2839876148",
    score: 4,
    visitorId,
  });
  assert(changed.stats.count === 2, "updating a vote should not add another");
  assert(changed.stats.average === 7, `expected 7, got ${changed.stats.average}`);

  const withComment = await store.upsertRating({
    barId: "osm-n2839876148",
    score: 6,
    visitorId,
    comment: "  Lukter kjeller, men greit øl.  ",
  });
  assert(withComment.stats.count === 2, "comment should not add another vote");
  assert(withComment.stats.average === 8, `expected 8, got ${withComment.stats.average}`);
  assert(withComment.stats.comments.length === 1, "one public comment");
  assert(
    withComment.stats.comments[0].comment === "Lukter kjeller, men greit øl.",
    "comment should be trimmed"
  );
  assert(withComment.stats.comments[0].score === 6, "comment should keep the score");

  const updatedComment = await store.upsertRating({
    barId: "osm-n2839876148",
    score: 5,
    visitorId,
    comment: "Oppdatert: merkbart, ikke verst.",
  });
  assert(updatedComment.stats.count === 2, "updating comment should still be one vote");
  assert(updatedComment.stats.comments.length === 1, "still one comment after update");
  assert(
    updatedComment.stats.comments[0].comment === "Oppdatert: merkbart, ikke verst.",
    "comment should be replaced, not stacked"
  );

  let failed = false;
  try {
    await store.upsertRating({
      barId: "osm-n2839876148",
      score: 5,
      visitorId,
      comment: "x".repeat(300),
    });
  } catch (err) {
    failed = err.status === 400;
  }
  assert(failed, "overlong comment should be rejected");

  failed = false;
  try {
    await store.upsertRating({ barId: "osm-n2839876148", score: 11, visitorId });
  } catch (err) {
    failed = err.status === 400;
  }
  assert(failed, "score 11 should be rejected");

  failed = false;
  try {
    await store.upsertRating({ barId: "not-a-bar", score: 5, visitorId });
  } catch (err) {
    failed = err.status === 404;
  }
  assert(failed, "unknown bar should be 404");

  const catalog = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../src/bars.json", import.meta.url),
      "utf8"
    )
  );
  assert(catalog.bars.length >= 100, "OSM catalog should include Bergen bars");
  const original = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../src/data/original-bars.json", import.meta.url),
      "utf8"
    )
  );
  for (const bar of original) {
    const found = catalog.bars.find((item) => item.title === bar.title);
    assert(found, `missing original bar ${bar.title}`);
    assert(found.seedRating === bar.rating, `seed rating drifted for ${bar.title}`);
    assert(found.picture === bar.picture, `picture dropped for ${bar.title}`);
    assert(found.description === bar.description, `description dropped for ${bar.title}`);
  }

  const missingPictures = catalog.bars.filter((bar) => {
    if (typeof bar.picture !== "string") return true;
    return !/^https?:\/\//i.test(bar.picture) && !/^\/media\/maps\/.+\.png$/i.test(bar.picture);
  });
  assert(
    missingPictures.length === 0,
    `every bar needs a picture URL, missing: ${missingPictures.map((b) => b.title).join(", ")}`
  );
  const pictureUrls = catalog.bars.map((bar) => bar.picture);
  assert(new Set(pictureUrls).size === pictureUrls.length, "picture URLs should be unique per bar");

  await rm(dir, { recursive: true, force: true });
  console.log("All store and catalog checks passed.");
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
