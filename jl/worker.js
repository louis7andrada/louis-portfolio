// jl.andrada.one: Lulu & Jiji, who pays whom (Louis, council #10005-#10021, Nov 15 2026).
// Louis's drawings (council pictures #166-#168): a total on top, a Lulu box and a Jiji box, Send. Whoever paid types the
// amount in their own box; the top says who pays whom the difference (Jiji 40 -> "Lulu to pay Jiji $40"; then Lulu 70 ->
// "Jiji to pay Lulu $30"). No passwords or keys (#10005); the nine-square 404 door in front, as on andrada.one (#10017);
// "not to be known publicly" (#10019): noindex everywhere, robots.txt says no, no workers.dev address.
// Memory forever (#10012): every payment is a row in one Durable Object (SQLite). Nothing deletes a row except Remove.
// Louis, Nov 16 (#10062, #10065): under a filled box, a "/2" button that halves the number in that box (nothing is sent,
// so the amount can still be fixed), and an optional reason that shows in the list.
// Louis, Nov 16 (#10076, #10077; Aster #10080): Edit on every row (who paid, amount, reason), Save/Cancel; an edited row
// says "[edited]" beside its reason, and the total above recalculates from the list as always.

const NOINDEX = { "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet" };
const WHO = new Set(["lulu", "jiji"]);
const MAX_CENTS = 10_000_000; // $100,000: a typo guard, not a limit anyone should reach
const MAX_REASON = 120;

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

function invalid(e) {
  if (!e || !WHO.has(e.who)) return "Who paid? Lulu or Jiji.";
  if (!Number.isInteger(e.cents) || e.cents <= 0 || e.cents > MAX_CENTS) return "Type an amount like 30 or 12.50.";
  if (e.reason != null && (typeof e.reason !== "string" || e.reason.length > MAX_REASON)) {
    return "Keep the reason to " + MAX_REASON + " letters or fewer.";
  }
  return null;
}
function cleanReason(r) { return typeof r === "string" && r.trim() ? r.trim() : null; }

export class Ledger {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      who TEXT NOT NULL CHECK (who IN ('lulu', 'jiji')),
      cents INTEGER NOT NULL CHECK (cents > 0),
      at INTEGER NOT NULL
    )`);
    // Added Nov 16 (#10062); rows from before have neither.
    const cols = new Set(this.sql.exec("PRAGMA table_info(payments)").toArray().map((c) => c.name));
    if (!cols.has("reason")) this.sql.exec("ALTER TABLE payments ADD COLUMN reason TEXT");
    if (!cols.has("edited")) this.sql.exec("ALTER TABLE payments ADD COLUMN edited INTEGER NOT NULL DEFAULT 0");
  }

  list() {
    return this.sql.exec("SELECT id, who, cents, at, reason, edited FROM payments ORDER BY id DESC").toArray();
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
        const bad = invalid(e);
        if (bad) return json({ error: bad }, 400);
      }
      const at = Date.now();
      for (const e of entries) {
        this.sql.exec("INSERT INTO payments (who, cents, at, reason) VALUES (?, ?, ?, ?)", e.who, e.cents, at, cleanReason(e.reason));
      }
      return json({ payments: this.list() });
    }

    const m = url.pathname.match(/^\/api\/payments\/(\d{1,12})$/);
    if (request.method === "PUT" && m) {
      let e;
      try { e = await request.json(); } catch { return json({ error: "Send JSON." }, 400); }
      const bad = invalid(e);
      if (bad) return json({ error: bad }, 400);
      const id = Number(m[1]);
      if (!this.sql.exec("SELECT id FROM payments WHERE id = ?", id).toArray().length) {
        return json({ error: "That payment was removed.", payments: this.list() }, 404);
      }
      this.sql.exec("UPDATE payments SET who = ?, cents = ?, reason = ?, edited = 1 WHERE id = ?",
        e.who, e.cents, cleanReason(e.reason), id);
      return json({ payments: this.list() });
    }
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
.side { display: grid; gap: 8px; align-content: start; }
.extra { display: grid; gap: 8px; }
.extra[hidden] { display: none; }
.pair .extra input.reason { font-size: .95rem; padding: 10px 8px; border-width: 2px; text-align: left; }
.half { font-size: 1.15rem; letter-spacing: .08em; background: var(--bg); border: 2px solid var(--line); border-radius: 6px; padding: 8px 0; }
.half:active { background: #1c1c1c; }
.half:disabled { opacity: .4; cursor: default; }
.half:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
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
li .r { font-size: .85rem; margin-top: 3px; overflow-wrap: anywhere; }
li .r .ed { color: var(--muted); font-size: .72rem; }
.btns { display: grid; gap: 6px; }
li.editing { grid-template-columns: 1fr; gap: 8px; }
.ed-form { display: grid; gap: 8px; }
.ed-who { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ed-who button, .ed-acts button { background: none; border: 2px solid #333; border-radius: 6px; padding: 8px 0; font-size: .95rem; }
.ed-who button.on { border-color: var(--line); }
.ed-who .l.on { color: var(--lulu); } .ed-who .j.on { color: var(--jiji); }
.ed-who button:not(.on) { color: var(--muted); }
.ed-form input { background: #0b0b0b; color: inherit; font: inherit; border: 2px solid var(--line); border-radius: 6px; padding: 9px 8px;
  outline: none; width: 100%; box-sizing: border-box; }
.ed-form input.amt { font-size: 1.3rem; text-align: center; font-variant-numeric: tabular-nums; }
.ed-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ed-acts .save { border-color: var(--line); }
.ed-form button:focus-visible, .ed-form input:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
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
    <div class="side">
      <input id="lulu" inputmode="decimal" autocomplete="off" placeholder="Lulu" aria-label="Lulu paid">
      <div class="extra" id="lulu-extra" hidden>
        <button class="half" id="lulu-half" type="button" aria-label="Halve Lulu's amount">/2</button>
        <input class="reason" id="lulu-reason" maxlength="120" autocomplete="off" placeholder="reason (optional)" aria-label="Reason for Lulu's payment">
      </div>
    </div>
    <div class="side">
      <input id="jiji" inputmode="decimal" autocomplete="off" placeholder="Jiji" aria-label="Jiji paid">
      <div class="extra" id="jiji-extra" hidden>
        <button class="half" id="jiji-half" type="button" aria-label="Halve Jiji's amount">/2</button>
        <input class="reason" id="jiji-reason" maxlength="120" autocomplete="off" placeholder="reason (optional)" aria-label="Reason for Jiji's payment">
      </div>
    </div>
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
      if (p.reason || p.edited) {
        var r = document.createElement("div"); r.className = "r";
        if (p.reason) r.append(p.reason);
        if (p.edited) r.append(span("ed", (p.reason ? " " : "") + "[edited]"));
        left.append(r);
      }
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
      var ed = document.createElement("button"); ed.className = "rm"; ed.type = "button"; ed.textContent = "Edit";
      ed.addEventListener("click", function () { editing = p.id; render(); });
      var btns = document.createElement("div"); btns.className = "btns"; btns.append(ed, rm);
      if (editing === p.id) li.append(editForm(p, li)); else li.append(left, v, btns);
      ul.append(li);
    });
  }

  // One row at a time can be edited; the list refreshing every few seconds leaves an open row alone.
  var editing = null;
  function editForm(p, li) {
    li.className = "editing";
    var f = document.createElement("div"); f.className = "ed-form";
    var who = p.who, row = document.createElement("div"); row.className = "ed-who";
    var bl = document.createElement("button"), bj = document.createElement("button");
    bl.type = bj.type = "button"; bl.textContent = "Lulu paid"; bj.textContent = "Jiji paid";
    function mark() { bl.className = "l" + (who === "lulu" ? " on" : ""); bj.className = "j" + (who === "jiji" ? " on" : ""); }
    bl.addEventListener("click", function () { who = "lulu"; mark(); });
    bj.addEventListener("click", function () { who = "jiji"; mark(); });
    mark(); row.append(bl, bj);
    var amt = document.createElement("input"); amt.className = "amt"; amt.inputMode = "decimal"; amt.autocomplete = "off";
    amt.value = plain(p.cents); amt.setAttribute("aria-label", "Amount");
    var rs = document.createElement("input"); rs.maxLength = 120; rs.autocomplete = "off"; rs.placeholder = "reason (optional)";
    rs.value = p.reason || ""; rs.setAttribute("aria-label", "Reason");
    var acts = document.createElement("div"); acts.className = "ed-acts";
    var cancel = document.createElement("button"), save = document.createElement("button");
    cancel.type = save.type = "button"; cancel.textContent = "Cancel"; save.textContent = "Save"; save.className = "save";
    cancel.addEventListener("click", function () { editing = null; render(); });
    save.addEventListener("click", function () {
      var c = cents(amt.value);
      if (isNaN(c) || !c) { note("Type an amount like 30 or 12.50.", true); return; }
      save.disabled = true;
      var body = { who: who, cents: c, reason: rs.value.trim() || null };
      editing = null;
      call("PUT", "/api/payments/" + p.id, body).then(function () { note("Saved."); },
        function (e) { editing = p.id; render(); note("Didn't save: " + e.message, true); });
    });
    acts.append(cancel, save);
    f.append(row, amt, rs, acts);
    return f;
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

  var busy = false;
  function buttons() {
    ["send", "lulu-half", "jiji-half"].forEach(function (id) { $(id).disabled = busy; });
  }
  // The /2 and the reason show under a box once something is typed in it (#10062).
  function extras() {
    ["lulu", "jiji"].forEach(function (id) { $(id + "-extra").hidden = !$(id).value.trim(); });
  }
  function clear(ids) {
    ids.forEach(function (id) { $(id).value = ""; $(id + "-reason").value = ""; });
    extras();
    if (document.activeElement) document.activeElement.blur();
  }
  function post(list, ids, done) {
    busy = true; buttons();
    call("POST", "/api/payments", { payments: list }).then(function () { clear(ids); note(done); },
      function (e) { note("Didn't send: " + e.message + " Nothing was saved.", true); })
      .then(function () { busy = false; buttons(); });
  }
  function entry(id, c) {
    var e = { who: id, cents: c }, r = $(id + "-reason").value.trim();
    if (r) e.reason = r;
    return e;
  }

  $("send").addEventListener("click", function () {
    var l = cents($("lulu").value), j = cents($("jiji").value);
    if (isNaN(l) || isNaN(j)) { note("Type an amount like 30 or 12.50.", true); return; }
    if (!l && !j) { note("Type what you paid in your box first.", true); return; }
    var list = [], ids = [];
    if (l) { list.push(entry("lulu", l)); ids.push("lulu"); }
    if (j) { list.push(entry("jiji", j)); ids.push("jiji"); }
    post(list, ids, "Sent.");
  });
  // /2: halves the number in this box, in the box (#10065); Send still sends it. Odd cents round to the nearest cent.
  function plain(c) { return (c % 100 ? (c / 100).toFixed(2) : String(c / 100)); }
  ["lulu", "jiji"].forEach(function (id) {
    $(id + "-half").addEventListener("click", function () {
      var c = cents($(id).value);
      if (isNaN(c) || !c) { note("Type an amount like 30 or 12.50.", true); return; }
      var half = Math.round(c / 2);
      if (!half) { note("Too small to halve.", true); return; }
      $(id).value = plain(half);
      note(fmt(c) + " halved: " + fmt(half) + ". Tap Send when it's right.");
    });
    $(id).addEventListener("input", extras);
    $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") $("send").click(); });
    $(id + "-reason").addEventListener("keydown", function (e) { if (e.key === "Enter") $("send").click(); });
  });

  function refresh() {
    if (editing !== null) return Promise.resolve(); // don't redraw under someone's fingers
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
