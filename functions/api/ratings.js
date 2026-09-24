import handler from "../../api/ratings/index.js";

function headersToObject(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const headers = headersToObject(request.headers);
  if (headers["cf-connecting-ip"]) {
    headers["x-azure-clientip"] = headers["cf-connecting-ip"];
  }

  let body = null;
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
    body = await request.text();
  }

  const azureContext = {
    res: null,
    log: { error: (...args) => console.error(...args) },
  };
  await handler(azureContext, {
    method: request.method,
    headers,
    query,
    url: request.url,
    body,
  });

  const res = azureContext.res || { status: 500, body: { error: "No response" } };
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(res.headers || {})) {
    if (value != null) responseHeaders.set(key, String(value));
  }
  if (res.status === 204) {
    return new Response(null, { status: 204, headers: responseHeaders });
  }
  const payload = typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? {});
  return new Response(payload, { status: res.status || 200, headers: responseHeaders });
}
