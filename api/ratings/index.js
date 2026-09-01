const store = require("../lib/store");
const rateLimit = require("../lib/rate-limit");

function corsHeaders(req) {
  const origin = (req.headers && (req.headers.origin || req.headers.Origin)) || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(context, req, status, body) {
  context.res = {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      ...(status === 429 ? { "Retry-After": "60" } : {}),
    },
    body,
  };
}

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers: corsHeaders(req) };
    return;
  }

  try {
    if (req.method === "GET") {
      const visitorId =
        (req.query && (req.query.visitorId || req.query.visitorid)) || null;
      json(context, req, 200, await store.getAggregates(visitorId));
      return;
    }

    if (req.method === "POST") {
      rateLimit.assertPostAllowed(req);
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (body.commentId != null || body.vote != null) {
        json(
          context,
          req,
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
      json(
        context,
        req,
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

    json(context, req, 405, { error: "Method not allowed" });
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (status >= 500) {
      context.log.error(err);
    }
    json(context, req, status, { error: err.message || "Server error" });
  }
};
