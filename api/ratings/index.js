const store = require("../lib/store");

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
      json(context, req, 200, await store.getAggregates());
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      json(
        context,
        req,
        200,
        await store.upsertRating({
          barId: body.barId,
          score: Number(body.score),
          visitorId: body.visitorId,
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
