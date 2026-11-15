// jl.andrada.one: Lulu & Jiji, who pays whom (Louis, council #10005-#10021, Nov 15 2026).
// Louis's drawings (council pictures #166-#168): a total on top, a Lulu box and a Jiji box, Send. Whoever paid types the
// amount in their own box; the top says who pays whom the difference (Jiji 40 -> "Lulu to pay Jiji $40"; then Lulu 70 ->
// "Jiji to pay Lulu $30"). No passwords or keys (#10005); the nine-square 404 door in front, as on andrada.one (#10017);
// "not to be known publicly" (#10019): noindex everywhere, robots.txt says no, no workers.dev address.
// Memory forever (#10012): every payment is a row in one Durable Object (SQLite). Nothing deletes a row except Remove.

const NOINDEX = { "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet" };
const WHO = new Set(["lulu", "jiji"]);
const MAX_CENTS = 10_000_000; // $100,000: a typo guard, not a limit anyone should reach

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...NOINDEX },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain", ...NOINDEX } });
    }
    if (url.pathname === "/AndradaMono.woff2") {
      const r = await env.ASSETS.fetch(request);
      const h = new Headers(r.headers);
      for (const [k, v] of Object.entries(NOINDEX)) h.set(k, v);
      h.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(r.body, { status: r.status, headers: h });
    }
    if (url.pathname === "/api/payments" || url.pathname.startsWith("/api/payments/")) {
      // A browser elsewhere can't post here on someone's behalf: writes must come from this page.
      const origin = request.headers.get("Origin");
      if (request.method !== "GET" && origin && origin !== url.origin) return json({ error: "Not from this page." }, 403);
      const stub = env.LEDGER.get(env.LEDGER.idFromName("jl"));
      return stub.fetch(request);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...NOINDEX },
      });
    }
    return new Response("404.", { status: 404, headers: { "Content-Type": "text/plain", ...NOINDEX } });
  },
};

export class Ledger {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      who TEXT NOT NULL CHECK (who IN ('lulu', 'jiji')),
      cents INTEGER NOT NULL CHECK (cents > 0),
      at INTEGER NOT NULL
    )`);
  }

  list() {
    return this.sql.exec("SELECT id, who, cents, at FROM payments ORDER BY id DESC").toArray();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/payments") return json({ payments: this.list() });

    if (request.method === "POST" && url.pathname === "/api/payments") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400); }
      const entries = Array.isArray(body && body.payments) ? body.payments : [body];
      if (!entries.length || entries.length > 2) return json({ error: "One or two payments at a time." }, 400);
      for (const e of entries) {
        if (!e || !WHO.has(e.who)) return json({ error: "Who paid? Lulu or Jiji." }, 400);
        if (!Number.isInteger(e.cents) || e.cents <= 0 || e.cents > MAX_CENTS) {
          return json({ error: "Type an amount like 30 or 12.50." }, 400);
        }
      }
      const at = Date.now();
      for (const e of entries) this.sql.exec("INSERT INTO payments (who, cents, at) VALUES (?, ?, ?)", e.who, e.cents, at);
      return json({ payments: this.list() });
    }

    const m = url.pathname.match(/^\/api\/payments\/(\d{1,12})$/);
    if (request.method === "DELETE" && m) {
      this.sql.exec("DELETE FROM payments WHERE id = ?", Number(m[1]));
      return json({ payments: this.list() });
    }
    return json({ error: "Not here." }, 404);
  }
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<meta name="referrer" content="no-referrer">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="Lulu & Jiji">
<meta name="theme-color" content="#000000">
<title>Lulu &amp; Jiji</title>
<style>
@font-face { font-family: 'AndradaMono'; src: url('/AndradaMono.woff2') format('woff2'); font-display: swap; }
:root {
  --bg: #000; --chalk: #f2f0ea; --line: #e9e6de; --lulu: #8d8d8d; --jiji: #c2286a; --muted: #7a7872;
  --mono: 'AndradaMono', 'Courier New', Courier;
  color-scheme: dark;
}
html, body { margin: 0; background: var(--bg); color: var(--chalk); }
body {
  font-family: var(--mono); -webkit-text-size-adjust: 100%;
  padding: max(28px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(40px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
}
main { max-width: 440px; margin: 0 auto; display: grid; gap: 22px; }
.total { border: 3px solid var(--line); border-radius: 6px 10px 5px 12px; padding: 18px 12px; text-align: center;
  display: grid; gap: 8px; min-height: 128px; align-content: center; }
.who { font-size: 1.15rem; letter-spacing: .04em; min-height: 1.4em; }
.l { color: var(--lulu); } .j { color: var(--jiji); }
.amount { font-size: 3.2rem; line-height: 1; font-variant-numeric: tabular-nums; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.pair input {
  width: 100%; box-sizing: border-box; background: #0b0b0b; color: inherit;
  border: 3px solid var(--line); border-radius: 8px 4px 10px 6px;
  font: inherit; font-size: 2rem; text-align: center; padding: 22px 6px; outline: none; font-variant-numeric: tabular-nums;
}
.pair input::placeholder { opacity: 1; }
#lulu, #lulu::placeholder { color: var(--lulu); }
#jiji, #jiji::placeholder { color: var(--jiji); }
.pair input:focus-visible { border-color: #fff; box-shadow: 0 0 0 3px #ffffff33; }
.send-row { display: flex; justify-content: center; }
button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
#send { font-size: 1.4rem; letter-spacing: .14em; background: var(--bg); border: 3px solid var(--line); border-radius: 6px; padding: 12px 34px; }
#send:active { background: #1c1c1c; }
#send:disabled { opacity: .4; cursor: default; }
#send:focus-visible, .rm:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.note { color: var(--muted); font-size: .8rem; text-align: center; min-height: 1.2em; margin: 0; }
.note.err { color: #ff8a8a; }
h2 { font-weight: 400; font-size: .9rem; margin: 8px 0 0; color: var(--muted); letter-spacing: .12em; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px solid #222; }
li .n { font-size: 1rem; }
li .d { color: var(--muted); font-size: .72rem; margin-top: 2px; }
li .v { font-size: 1.1rem; font-variant-numeric: tabular-nums; }
.rm { background: none; border: 1px solid #333; border-radius: 5px; padding: 5px 9px; font-size: .72rem; color: var(--muted); }
.rm.sure { border-color: #ff8a8a; color: #ff8a8a; }
.empty { display: block; color: var(--muted); font-size: .8rem; border: 0; }

/* The door: the same nine invisible squares as andrada.one's wall (Louis #10017). */
html:has(#wall), html:has(#wall) body { overflow: hidden; }
html:has(#wall) main { visibility: hidden; }
#wall { position: fixed; inset: 0; z-index: 2147483647; background: #0c0c0c; -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
#wall .w404 { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none;
  color: #e8e8e8; font-size: 28px; letter-spacing: .18em; }
#wall .w404.blur { filter: blur(14px); opacity: .5; transform: translateY(8px); }
#wall .w-keys { position: absolute; inset: 0; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); touch-action: none; }
</style>
</head>
<body>
<div id="wall" aria-hidden="true">
  <div class="w404 blur">404.</div>
  <div class="w404">404.</div>
  <div class="w-keys"><div data-k="1"></div><div data-k="2"></div><div data-k="3"></div><div data-k="4"></div><div data-k="5"></div><div data-k="6"></div><div data-k="7"></div><div data-k="8"></div><div data-k="9"></div></div>
</div>
<main>
  <section class="total" aria-live="polite">
    <div class="who" id="who"></div>
    <div class="amount" id="amount">$0</div>
  </section>
  <div class="pair">
    <input id="lulu" inputmode="decimal" autocomplete="off" placeholder="Lulu" aria-label="Lulu paid">
    <input id="jiji" inputmode="decimal" autocomplete="off" placeholder="Jiji" aria-label="Jiji paid">
  </div>
  <div class="send-row"><button id="send" type="button">SEND</button></div>
  <p class="note" id="note">Loading…</p>
  <section>
    <h2>PAYMENTS</h2>
    <ul id="list"></ul>
  </section>
</main>
<script>
(function () {
  // ---- the door: press all nine squares, any order; open until the browser closes (shared with andrada.one) ----
  var wall = document.getElementById("wall");
  function isOpen() {
    if (window.name === "door-session=open") return true;
    try { return /(?:^|; )door-session=open(?:;|$)/.test(document.cookie); } catch (e) { return false; }
  }
  function open() {
    try { document.cookie = "door-session=open; path=/; SameSite=Lax; domain=andrada.one"; } catch (e) {}
    try { if (!isOpen()) document.cookie = "door-session=open; path=/; SameSite=Lax"; } catch (e) {}
    if (!isOpen()) window.name = "door-session=open";
    wall.remove();
  }
  if (isOpen()) wall.remove();
  else {
    var pressed = {}, count = 0;
    wall.querySelector(".w-keys").addEventListener("pointerdown", function (e) {
      var k = e.target && e.target.getAttribute("data-k");
      if (!k || pressed[k]) return;
      pressed[k] = true;
      if (++count === 9) open();
    });
  }

  // ---- the app ----
  var $ = function (id) { return document.getElementById(id); };
  var NAME = { lulu: "Lulu", jiji: "Jiji" };
  var payments = [];
  function fmt(c) { var d = Math.abs(c) / 100; return "$" + (Number.isInteger(d) ? d : d.toFixed(2)); }
  // Lulu's payments push the balance toward "Jiji to pay Lulu", Jiji's the other way.
  function balance() { return payments.reduce(function (s, p) { return s + (p.who === "lulu" ? p.cents : -p.cents); }, 0); }
  function note(t, err) { $("note").textContent = t; $("note").classList.toggle("err", !!err); }
  function span(cls, t) { var s = document.createElement("span"); s.className = cls; s.textContent = t; return s; }

  function render() {
    var b = balance(), who = $("who");
    who.textContent = "";
    if (b > 0) who.append(span("j", "Jiji"), " to pay ", span("l", "Lulu"));
    else if (b < 0) who.append(span("l", "Lulu"), " to pay ", span("j", "Jiji"));
    $("amount").textContent = fmt(b);
    var ul = $("list"); ul.textContent = "";
    if (!payments.length) {
      var li = document.createElement("li"); li.className = "empty";
      li.textContent = "Nothing yet. Type what you paid in your box and tap Send.";
      ul.append(li); return;
    }
    payments.forEach(function (p) {
      var li = document.createElement("li"), left = document.createElement("div");
      var n = document.createElement("div"); n.className = "n " + (p.who === "lulu" ? "l" : "j"); n.textContent = NAME[p.who] + " paid";
      var d = document.createElement("div"); d.className = "d";
      d.textContent = new Date(p.at).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
      left.append(n, d);
      var v = document.createElement("div"); v.className = "v"; v.textContent = fmt(p.cents);
      var rm = document.createElement("button"); rm.className = "rm"; rm.type = "button"; rm.textContent = "Remove";
      var t = null;
      rm.addEventListener("click", function () {
        if (!rm.classList.contains("sure")) {
          rm.classList.add("sure"); rm.textContent = "Sure?";
          t = setTimeout(function () { rm.classList.remove("sure"); rm.textContent = "Remove"; }, 3000);
          return;
        }
        clearTimeout(t);
        call("DELETE", "/api/payments/" + p.id).then(function () { note("Removed " + NAME[p.who] + "'s " + fmt(p.cents) + "."); },
          function (e) { note("Couldn't remove it: " + e.message, true); });
      });
      li.append(left, v, rm); ul.append(li);
    });
  }

  function call(method, path, body) {
    return fetch(path, {
      method: method, cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !Array.isArray(j.payments)) throw new Error(j.error || "the connection failed, try again.");
        payments = j.payments; render(); return j;
      });
    }, function () { throw new Error("no connection, try again."); });
  }

  // Accepts "30", "30.5", "$30", "30,50".
  function cents(raw) {
    var s = raw.replace(/[$\\s]/g, "").replace(",", ".");
    if (!s) return 0;
    if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }

  $("send").addEventListener("click", function () {
    var l = cents($("lulu").value), j = cents($("jiji").value);
    if (isNaN(l) || isNaN(j)) { note("Type an amount like 30 or 12.50.", true); return; }
    if (!l && !j) { note("Type what you paid in your box first.", true); return; }
    var list = [];
    if (l) list.push({ who: "lulu", cents: l });
    if (j) list.push({ who: "jiji", cents: j });
    $("send").disabled = true;
    call("POST", "/api/payments", { payments: list }).then(function () {
      $("lulu").value = ""; $("jiji").value = "";
      if (document.activeElement) document.activeElement.blur();
      note("Sent.");
    }, function (e) { note("Didn't send: " + e.message + " Nothing was saved.", true); })
      .then(function () { $("send").disabled = false; });
  });
  ["lulu", "jiji"].forEach(function (id) {
    $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") $("send").click(); });
  });

  function refresh() {
    return call("GET", "/api/payments").then(function () { if ($("note").textContent === "Loading…") note(""); },
      function (e) { note("Couldn't load: " + e.message, true); });
  }
  render(); refresh();
  // The other phone's payments show up within a few seconds, and at once when the app comes back to the front.
  setInterval(function () { if (!document.hidden) refresh(); }, 8000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
})();
</script>
</body>
</html>`;
