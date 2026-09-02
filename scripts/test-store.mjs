import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
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
  assert(
    (first.ratings["osm-n2839876148"].votes || []).length === 0,
    "editorial seed vote should not appear in public votes"
  );

  const visitorId = "11111111-1111-4111-8111-111111111111";
  const updated = await store.upsertRating({
    barId: "osm-n2839876148",
    score: 8,
    visitorId,
  });
  assert(updated.stats.count === 2, "user vote should add to the seed");
  assert(updated.stats.average === 9, `expected 9, got ${updated.stats.average}`);
  assert(updated.stats.comments.length === 0, "score-only vote should not appear as a comment");
  assert(updated.stats.votes.length === 1, "score-only vote should appear in votes");
  assert(updated.stats.votes[0].score === 8, "vote payload should keep the score");
  assert(
    typeof updated.stats.votes[0].updatedAt === "string" &&
      updated.stats.votes[0].updatedAt.length > 0,
    "score-only vote should include a timestamp"
  );
  assert(
    !("visitorId" in updated.stats.votes[0]),
    "vote payload should stay anonymous"
  );

  const changed = await store.upsertRating({
    barId: "osm-n2839876148",
    score: 4,
    visitorId,
  });
  assert(changed.stats.count === 2, "updating a vote should not add another");
  assert(changed.stats.average === 7, `expected 7, got ${changed.stats.average}`);
  assert(changed.stats.votes.length === 1, "updating a vote should not add another public vote");
  assert(changed.stats.votes[0].score === 4, "updated score-only vote should keep the new score");

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
  assert(withComment.stats.votes.length === 1, "commented vote should still appear in votes");
  assert(withComment.stats.votes[0].score === 6, "votes list should follow the updated score");
  assert(
    typeof withComment.stats.votes[0].updatedAt === "string" &&
      withComment.stats.votes[0].updatedAt.length > 0,
    "commented vote should keep a timestamp"
  );

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

  const otherVisitor = "22222222-2222-4222-8222-222222222222";
  const liked = await store.upsertCommentVote({
    barId: "osm-n2839876148",
    commentId: updatedComment.stats.comments[0].id,
    visitorId: otherVisitor,
    vote: 1,
  });
  assert(liked.stats.comments[0].upvotes === 1, "comment should have one like");
  assert(liked.stats.comments[0].downvotes === 0, "no dislikes yet");
  assert(liked.stats.comments[0].myVote === 1, "viewer like should be marked");

  const disliked = await store.upsertCommentVote({
    barId: "osm-n2839876148",
    commentId: updatedComment.stats.comments[0].id,
    visitorId: otherVisitor,
    vote: -1,
  });
  assert(disliked.stats.comments[0].upvotes === 0, "switching to dislike clears the like");
  assert(disliked.stats.comments[0].downvotes === 1, "dislike should count");

  const toggledOff = await store.upsertCommentVote({
    barId: "osm-n2839876148",
    commentId: updatedComment.stats.comments[0].id,
    visitorId: otherVisitor,
    vote: -1,
  });
  assert(toggledOff.stats.comments[0].downvotes === 0, "clicking dislike again should undo");

  let failed = false;
  try {
    await store.upsertCommentVote({
      barId: "osm-n2839876148",
      commentId: updatedComment.stats.comments[0].id,
      visitorId,
      vote: 1,
    });
  } catch (err) {
    failed = err.status === 400;
  }
  assert(failed, "author should not like their own comment");

  const thirdVisitor = "33333333-3333-4333-8333-333333333333";
  const secondComment = await store.upsertRating({
    barId: "osm-n2839876148",
    score: 9,
    visitorId: otherVisitor,
    comment: "Verre enn sist.",
  });
  assert(secondComment.stats.comments.length === 2, "two public comments");
  await store.upsertCommentVote({
    barId: "osm-n2839876148",
    commentId: secondComment.stats.comments.find((c) => c.comment === "Verre enn sist.").id,
    visitorId: thirdVisitor,
    vote: 1,
  });
  const ranked = await store.upsertCommentVote({
    barId: "osm-n2839876148",
    commentId: secondComment.stats.comments.find((c) => c.comment === "Oppdatert: merkbart, ikke verst.").id,
    visitorId: thirdVisitor,
    vote: 1,
  });
  await store.upsertCommentVote({
    barId: "osm-n2839876148",
    commentId: ranked.stats.comments.find((c) => c.comment === "Oppdatert: merkbart, ikke verst.").id,
    visitorId: otherVisitor,
    vote: 1,
  });
  const sorted = await store.getAggregates(thirdVisitor);
  const hectorComments = sorted.ratings["osm-n2839876148"].comments;
  assert(hectorComments[0].upvotes >= hectorComments[1].upvotes, "comments should sort by most likes");
  assert(hectorComments[0].comment === "Oppdatert: merkbart, ikke verst.", "most liked comment first");
  assert(hectorComments[0].upvotes === 2, "top comment should have two likes");
  assert(hectorComments[1].upvotes === 1, "second comment should keep one like");

  failed = false;
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

  const decimalBar = "osm-n4682353960";
  await store.upsertRating({
    barId: decimalBar,
    score: 10,
    visitorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  await store.upsertRating({
    barId: decimalBar,
    score: 10,
    visitorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  await store.upsertRating({
    barId: decimalBar,
    score: 9,
    visitorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  const decimalStats = (await store.getAggregates()).ratings[decimalBar];
  assert(decimalStats.histogram[9] === 2, "two votes of 10");
  assert(decimalStats.histogram[8] === 1, "one vote of 9");
  assert(
    decimalStats.average === 9.7,
    `2×10 and 1×9 should round to 9.7, got ${decimalStats.average}`
  );
  await store.upsertRating({
    barId: decimalBar,
    score: 10,
    visitorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
  await store.upsertRating({
    barId: decimalBar,
    score: 7,
    visitorId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
  const nineTwo = (await store.getAggregates()).ratings[decimalBar];
  assert(
    nineTwo.average === 9.2,
    `10+10+9+10+7 should round to 9.2, got ${nineTwo.average}`
  );

  const homepage = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert(homepage.includes('id="map"'), "homepage should include a map canvas");
  assert(homepage.includes('id="viewMap"'), "homepage should include a map view toggle");
  const appJs = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert(appJs.includes("mapHoverHtml"), "map hover card helper missing");
  assert(appJs.includes("World_Street_Map"), "map should use street tiles");
  assert(appJs.includes("roundToTenth"), "averages should round to one decimal");

  await rm(dir, { recursive: true, force: true });
  console.log("All store and catalog checks passed.");
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
