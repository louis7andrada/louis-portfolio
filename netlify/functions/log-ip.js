exports.handler = async (event, context) => {
  const ip =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["client-ip"] ||
    "unknown";

  const ua = event.headers["user-agent"] || "unknown";
  const path = event.queryStringParameters.path || "unknown";
  const ref = event.headers["referer"] || "none";
  const lang = event.headers["accept-language"] || "unknown";
  const method = event.httpMethod || "unknown";
  const fullUrl = event.rawUrl || "unknown";

  let country = "unknown";
  try {
    if (event.headers["x-nf-geo"]) {
      country = JSON.parse(event.headers["x-nf-geo"]).country || "unknown";
    }
  } catch (e) {}

  const isMobile = /mobile/i.test(ua);

  console.log(
    JSON.stringify({
      ip,
      ua,
      isMobile,
      path,
      ref,
      lang,
      method,
      fullUrl,
      country,
      time: Date.now()
    })
  );

  return {
    statusCode: 200,
    body: "OK"
  };
};
