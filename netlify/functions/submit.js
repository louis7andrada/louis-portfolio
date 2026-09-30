// All site forms (newsletter, unsubscribe, contact, purchase, commission)
// post here. This function checks the reCAPTCHA token with Google on the
// server — where a bot can't skip it — and only then forwards the form to
// the Google Apps Script that writes to the sheet / mailing list.
//
// Netlify environment variables:
//   RECAPTCHA_SECRET_KEY  (required) reCAPTCHA v3 secret key
//   APPS_SCRIPT_URL       (optional) Apps Script web-app URL; defaults to the current one
//   FORMS_SHARED_SECRET   (optional) sent to the Apps Script as `secret`, so the
//                         script can reject anything that didn't come through here

const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxxnqf8ImE2r9tkV60_7cIQJC4TvdzyDrDc0MovRvk9m4cN_lEntF1LS1EFV5VHmd19/exec";

const MIN_SCORE = 0.5;
const ALLOWED_ACTIONS = new Set(["subscribe", "unsubscribe", "contact", "purchase", "commission"]);
const MAX_BODY_BYTES = 20000;

const text = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  body,
});

async function verifyRecaptcha(token, remoteip) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) throw new Error("RECAPTCHA_SECRET_KEY is not set");
  const params = new URLSearchParams({ secret, response: token });
  if (remoteip) params.set("remoteip", remoteip);
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return text(405, "METHOD_NOT_ALLOWED");
  if (!event.body || event.body.length > MAX_BODY_BYTES) return text(400, "BAD_REQUEST");

  let data;
  try {
    data = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
  } catch (e) {
    return text(400, "BAD_REQUEST");
  }
  if (!data || typeof data !== "object") return text(400, "BAD_REQUEST");

  const { token, ...payload } = data;
  // The newsletter form historically sent no action; the Apps Script treats that as a signup.
  const formAction = payload.action || "subscribe";
  if (!ALLOWED_ACTIONS.has(formAction)) return text(400, "BAD_REQUEST");
  if (typeof token !== "string" || !token) return text(403, "RECAPTCHA_FAILED");

  try {
    const ip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"];
    const check = await verifyRecaptcha(token, ip);
    if (!check.success || typeof check.score !== "number" || check.score < MIN_SCORE || check.action !== "submit") {
      return text(403, "RECAPTCHA_FAILED");
    }
  } catch (e) {
    console.error("reCAPTCHA verification error:", e.message);
    return text(502, "RECAPTCHA_ERROR");
  }

  const forward = { ...payload };
  if (process.env.FORMS_SHARED_SECRET) forward.secret = process.env.FORMS_SHARED_SECRET;

  let result;
  try {
    const res = await fetch(process.env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(forward),
    });
    result = String(await res.text()).trim();
    if (!res.ok) {
      console.error("Apps Script HTTP", res.status);
      return text(502, "UPSTREAM_ERROR");
    }
  } catch (e) {
    console.error("Apps Script request failed:", e.message);
    return text(502, "UPSTREAM_ERROR");
  }

  // Don't reveal whether an address is on the mailing list: "already
  // subscribed" and "wasn't subscribed" both look like success to the visitor.
  if (formAction === "subscribe" && result === "DUPLICATE") result = "OK";
  if (formAction === "unsubscribe" && result === "NOT_FOUND") result = "OK";

  return text(200, result);
};
