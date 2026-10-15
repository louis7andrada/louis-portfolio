/* MUSIC PLAYER — plays Ny's tracks (Production, ny.andrada.one), and carries them from page to page.
   Named for what it does, not the section: a later section (singing) can use it as it is.
   Production pages include it inline (music-player.html); every other page loads it, as a file, only while
   music is carried (the bootstrap in baseof.html). music-assets.html puts window.MP_CONF in front of it: the
   cookie domain, Ny's name and every track (every side, in the Production grid's play order).
   One Audio object for the whole page, never in the DOM: the fog copies clone <main>, and an
   <audio> there would be cloned with it. Controls are plain markup (music-controls.html) bound with
   musicPlayer.bind(el); a small now-playing bar (musicPlayer.miniBar, built on <body>, outside <main>, so never
   in the copies) keeps the song going when no popup shows it, and hides while the footer is on screen (the
   newsletter form must stay reachable) or a popup is open. Lock screen and headset keys work through the
   Media Session API.
   play() is called straight from the click that asked for it: browsers only let sound start
   inside a visitor's own gesture (later tracks reuse the same, already allowed, Audio). */
(function () {
  if (window.musicPlayer) return;
  var CONF = window.MP_CONF || {};
  var audio = new Audio();
  audio.preload = "none";
  var tracks = [], cur = -1, errored = false, loading = false, subs = [];
  var startAt = 0; // where a carried track goes on (seconds), until its file has loaded
  // the site's popups (baseof.html POPUPS, + the inquiry's selector): the now-playing bar hides while one is open
  var POPUPS = ".arw-modal, #artworkModal, .sins-popup, .arch-popup, .book-modal, #bookFullscreen, .book-fullscreen-overlay, .lightbox-overlay, .ml-popup, #artworkSelectorModal, .artwork-filter-overlay, .inq-sel-overlay";
  var queue = function () { return tracks.map(function (t) { return t.id; }); };
  var artist = "";

  // Volume, kept for the visitor's next visit (localStorage: a convenience, never required).
  // iPhones ignore audio.volume (only their own buttons change it): there the control hides itself.
  var canVolume = (function () { try { var a = new Audio(); a.volume = 0.5; return Math.abs(a.volume - 0.5) < 0.01; } catch (e) { return false; } })();
  var vol = 1;
  try {
    var saved = parseFloat(localStorage.getItem("mp-volume"));
    if (saved >= 0 && saved <= 1) vol = saved;
    audio.muted = localStorage.getItem("mp-muted") === "1";
  } catch (e) {}
  audio.volume = vol;
  // (localStorage is per subdomain: the music carried to another face takes its volume along in the cookie, save())
  function keepVolume() { try { localStorage.setItem("mp-volume", String(vol)); localStorage.setItem("mp-muted", audio.muted ? "1" : "0"); } catch (e) {} save(false); }
  function setVolume(v) {
    vol = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
    audio.volume = vol;
    if (vol > 0 && audio.muted) audio.muted = false;
    keepVolume(); emit();
  }
  function toggleMute() {
    if (vol === 0) { setVolume(0.6); return; } // muted by sliding to zero: the speaker brings it back
    audio.muted = !audio.muted;
    keepVolume(); emit();
  }

  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function position() { return startAt || audio.currentTime || 0; }
  function index(id) { for (var i = 0; i < tracks.length; i++) if (tracks[i].id === id) return i; return -1; }
  function state() {
    var t = tracks[cur] || null;
    // the length written on the page (ingest-music.py) first, so the time never changes once the file
    // loads (the browser often measures an MP3 a fraction shorter: 3:48 would turn into 3:47)
    var d = t && t.duration ? t.duration : (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
    return { track: t, playing: !!t && !audio.paused && !audio.ended, loading: loading, error: errored, time: t ? position() : 0, duration: d,
             volume: vol, muted: audio.muted || vol === 0 };
  }
  function emit() { var s = state(); subs.forEach(function (fn) { fn(s); }); }

  // the neighbour of the current track among those the page shows (search), in grid order
  function neighbour(dir) { return cur < 0 ? null : from(tracks[cur].id, dir); }
  function from(id, dir) {
    var at = index(id), ids = queue(), here = ids.indexOf(id);
    if (at < 0) return null;
    if (here < 0) { // that track is hidden by the search: next/prev from where it sits in the grid
      var after = ids.filter(function (x) { return dir > 0 ? index(x) > at : index(x) < at; });
      return after.length ? (dir > 0 ? after[0] : after[after.length - 1]) : null;
    }
    return ids[here + dir] || null;
  }

  function meta() {
    if (!("mediaSession" in navigator)) return;
    var t = tracks[cur];
    try {
      navigator.mediaSession.metadata = t && window.MediaMetadata ? new MediaMetadata({
        title: t.side ? t.title + " (Side " + t.side + ")" : t.title, artist: artist,
        artwork: t.cover ? [{ src: new URL(t.cover, location.href).href, sizes: "1600x1600", type: "image/jpeg" }] : []
      }) : null;
    } catch (e) {}
  }

  function play(id) {
    var i = id == null ? cur : index(id);
    if (i < 0) return;
    if (i !== cur) {
      cur = i; errored = false; startAt = 0;
      audio.src = tracks[i].src;
      meta();
    }
    loading = true;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { loading = false; emit(); }); // blocked or interrupted: stays paused
    emit();
  }
  function pause() { audio.pause(); }
  function toggle(id) {
    var i = id == null ? cur : index(id);
    if (i === cur && cur >= 0 && !audio.paused) pause(); else play(id);
  }
  function next() { var id = neighbour(1); if (id) play(id); }
  function prev() { var id = neighbour(-1); if (id) play(id); }
  function seek(sec) {
    if (cur < 0) return;
    var d = state().duration, to = Math.max(0, Math.min(d ? d - 0.25 : sec, sec));
    if (audio.readyState < 1) startAt = to; // not loaded yet: it starts there once it has
    else { startAt = 0; audio.currentTime = to; }
    emit();
  }
  function stop() {
    audio.pause();
    cur = -1; errored = false; loading = false; startAt = 0;
    audio.removeAttribute("src"); audio.load();
    meta();
    if ("mediaSession" in navigator) try { navigator.mediaSession.playbackState = "none"; } catch (e) {}
    stopWaiting();
    writeNow(null); // the ✕: the music ends on every page, not only this one
    emit();
  }

  audio.addEventListener("loadedmetadata", function () {
    if (startAt) { try { audio.currentTime = startAt; } catch (e) {} startAt = 0; }
  });
  ["play", "timeupdate", "durationchange", "loadedmetadata"].forEach(function (ev) { audio.addEventListener(ev, emit); });
  ["play", "pause"].forEach(function (ev) { audio.addEventListener(ev, function () { save(false); }); });
  audio.addEventListener("playing", function () { loading = false; stopWaiting(); emit(); });
  audio.addEventListener("waiting", function () { loading = true; emit(); });
  audio.addEventListener("pause", function () { loading = false; emit(); });
  audio.addEventListener("error", function () { if (!audio.getAttribute("src")) return; errored = true; loading = false; emit(); });
  audio.addEventListener("ended", function () {
    var id = api.autoNext ? neighbour(1) : null;
    if (id) play(id);
    else { audio.currentTime = 0; emit(); writeNow(null); } // the last one: stays on it, at the start, paused (and the music is over: other pages show no bar)
  });
  if ("mediaSession" in navigator) {
    [["play", function () { play(); }], ["pause", pause], ["previoustrack", prev], ["nexttrack", next], ["stop", stop],
     ["seekto", function (d) { seek(d.seekTime); }]].forEach(function (a) {
      try { navigator.mediaSession.setActionHandler(a[0], a[1]); } catch (e) {}
    });
  }

  /* ── FROM PAGE TO PAGE (Louis, 2026-10-14: the music should go on while visitors explore the site). The site is
     full pages on six subdomains, so every page load stops the sound. Instead, what plays is written to a session
     cookie shared by every *.andrada.one (sessionStorage and localStorage are per subdomain):
       { id, t: the second, on: playing, n: autoNext, v/m: volume/muted, h: handed over by pagehide, at: when }.
     The next page, on any face, loads this player only while that cookie exists (baseof.html), cues the track at
     the same second and plays it. A handover counts once, and only for HANDOVER ms, so a tab opened later (or
     alongside a playing one) shows the bar paused instead of playing the same music twice.
     Browsers may refuse sound before the visitor has touched the new page (Safari and iPhones always; others
     sometimes, across subdomains): the bar then waits, paused at the spot, and the visitor's first tap or key
     anywhere goes on with it. The bar's ✕ ends it on every page (the cookie goes); so does the last track ending. */
  var NOW = "mp-now", HANDOVER = 30000, waiting = null, hidden = false;
  function readNow() {
    try { var m = document.cookie.match(/(?:^|; )mp-now=([^;]+)/); return m ? JSON.parse(decodeURIComponent(m[1])) : null; } catch (e) { return null; }
  }
  function writeNow(v) {
    try {
      var dom = CONF.domain || "", h = location.hostname;
      var shared = dom && (h === dom || h.slice(-dom.length - 1) === "." + dom) ? "; domain=" + dom : "";
      document.cookie = NOW + "=" + (v ? encodeURIComponent(JSON.stringify(v)) : "; max-age=0") + "; path=/; SameSite=Lax" + shared;
    } catch (e) {}
  }
  function save(handover) {
    if (hidden) return; // between pagehide and pageshow the browser pauses the sound itself: that's not the visitor's
    if (cur < 0) { writeNow(null); return; }
    writeNow({ id: tracks[cur].id, t: Math.round(position() * 10) / 10, on: (!audio.paused || waiting) ? 1 : 0,
               n: api && api.autoNext ? 1 : 0, v: vol, m: audio.muted ? 1 : 0, h: handover ? 1 : 0, at: Date.now() });
  }
  // sound refused (no touch on this page yet): the first tap, click or key anywhere goes on with it. The player's
  // own buttons are left to do what they say (play, pause, ✕).
  function waitForTouch() {
    if (waiting) return;
    var evs = ["pointerdown", "pointerup", "touchend", "keydown", "click"];
    waiting = function (e) {
      if (e.target && e.target.closest && e.target.closest(".mp-mini, .mp-player")) return;
      var p = audio.play();
      if (p && p.catch) p.catch(function () {}); // not a gesture the browser counts (a scroll): wait for the next
    };
    waiting.off = function () { evs.forEach(function (ev) { document.removeEventListener(ev, waiting, true); }); };
    evs.forEach(function (ev) { document.addEventListener(ev, waiting, true); });
  }
  function stopWaiting() { if (waiting) { waiting.off(); waiting = null; } }
  // Go on with what the cookie says (a page has just loaded, or come back from the browser's back/forward cache).
  function carryOn() {
    var s = readNow(), i = s ? index(s.id) : -1;
    if (!s || i < 0) { if (cur >= 0) stop(); else if (s) writeNow(null); return; } // ended elsewhere, or a track that's gone
    if (s.v >= 0 && s.v <= 1) { vol = s.v; audio.volume = vol; }
    audio.muted = !!s.m;
    try { localStorage.setItem("mp-volume", String(vol)); localStorage.setItem("mp-muted", audio.muted ? "1" : "0"); } catch (e) {}
    api.autoNext = !!s.n;
    var handed = s.h && Math.abs(Date.now() - s.at) < HANDOVER;
    if (i !== cur) { cur = i; errored = false; audio.src = tracks[i].src; meta(); }
    if (audio.readyState < 1) startAt = s.t > 0 ? s.t : 0;
    else { startAt = 0; try { audio.currentTime = s.t > 0 ? s.t : 0; } catch (e) {} }
    if (s.on && handed) {
      loading = true;
      var p = audio.play();
      if (p && p.catch) p.catch(function () { loading = false; waitForTouch(); save(false); emit(); });
    } else if (!audio.paused) audio.pause();
    if (s.h) save(false); // the handover is used: a tab opened later doesn't play it again
    emit();
  }
  addEventListener("pagehide", function () { save(true); hidden = true; });
  addEventListener("pageshow", function (e) { hidden = false; if (e.persisted && tracks.length) carryOn(); });

  /* Controls (music-controls.html). opts.id: they belong to that one track (its own page);
     without it they follow whatever is current (the popup, the now-playing bar, the hero).
     opts.fallback: the track they show and start while nothing has played yet (the hero). */
  function bind(root, opts) {
    if (!root) return;
    opts = opts || {};
    var q = function (s) { return root.querySelector(s); };
    var playBtn = q(".mp-play"), prevBtn = q(".mp-prev"), nextBtn = q(".mp-next"), bar = q(".mp-bar"),
        fill = q(".mp-bar-fill"), curEl = q(".mp-cur"), durEl = q(".mp-dur"), msg = q(".mp-msg");
    var dragging = false, last = state();
    function target() { return opts.id || (cur >= 0 ? tracks[cur].id : opts.fallback) || null; } // the track shown
    function mine() { var id = target(); return cur >= 0 && !!id && tracks[cur].id === id; }
    function own() { var id = target(); return id ? tracks[index(id)] || null : null; }
    function draw(time, d) {
      if (fill) fill.style.width = (d ? Math.min(100, time / d * 100) : 0) + "%";
      if (curEl) curEl.textContent = fmt(time);
      if (bar) { bar.setAttribute("aria-valuenow", Math.floor(time)); bar.setAttribute("aria-valuetext", fmt(time) + " of " + fmt(d)); }
    }
    function render(s) {
      last = s;
      var m = mine(), t = own(), d = m ? s.duration : (t ? t.duration : 0);
      root.classList.toggle("is-playing", m && s.playing);
      root.classList.toggle("is-loading", m && s.loading && !s.error);
      if (!dragging) draw(m ? s.time : 0, d);
      if (durEl) durEl.textContent = fmt(d);
      if (bar) bar.setAttribute("aria-valuemax", Math.floor(d));
      if (playBtn) playBtn.setAttribute("aria-label", m && s.playing ? "Pause" : "Play");
      if (prevBtn) prevBtn.disabled = !(target() && from(target(), -1));
      if (nextBtn) nextBtn.disabled = !(target() && from(target(), 1));
      if (msg) { msg.hidden = !(m && s.error); msg.textContent = m && s.error ? "This track couldn't be loaded. Try again in a moment." : ""; }
      root.classList.toggle("is-muted", s.muted);
      if (vfill) vfill.style.width = (s.muted ? 0 : s.volume * 100) + "%";
      if (vbar) { vbar.setAttribute("aria-valuenow", s.muted ? 0 : Math.round(s.volume * 100)); vbar.setAttribute("aria-valuetext", s.muted ? "muted" : Math.round(s.volume * 100) + "%"); }
    }
    function at(e, el) { var r = (el || bar).getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); }

    // Volume: the speaker opens/closes the line above it; a click anywhere else closes it. Sliding to the
    // left end mutes (the speaker shows it), sliding back up unmutes.
    var volBox = q(".mp-vol"), vbar = q(".mp-vbar"), vfill = q(".mp-vfill"), volBtn = q(".mp-volbtn"), vdrag = false;
    var vline = vbar && vbar.querySelector(".mp-bar-line");
    function volOpen(on) {
      if (!volBox) return;
      volBox.classList.toggle("open", on);
      if (volBtn) volBtn.setAttribute("aria-expanded", on ? "true" : "false");
    }
    if (volBox && !canVolume) volBox.hidden = true;
    if (volBtn) volBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); volOpen(!volBox.classList.contains("open")); });
    document.addEventListener("pointerdown", function (e) { if (volBox && volBox.classList.contains("open") && !volBox.contains(e.target)) volOpen(false); });
    if (vbar) {
      vbar.addEventListener("pointerdown", function (e) {
        vdrag = true; vbar.classList.add("dragging");
        try { vbar.setPointerCapture(e.pointerId); } catch (x) {}
        setVolume(at(e, vline));
      });
      vbar.addEventListener("pointermove", function (e) { if (vdrag) setVolume(at(e, vline)); });
      vbar.addEventListener("pointerup", function () { vdrag = false; vbar.classList.remove("dragging"); });
      vbar.addEventListener("pointercancel", function () { vdrag = false; vbar.classList.remove("dragging"); });
      vbar.addEventListener("click", function (e) { e.stopPropagation(); });
      vbar.addEventListener("keydown", function (e) {
        var up = e.key === "ArrowRight" || e.key === "ArrowUp", down = e.key === "ArrowLeft" || e.key === "ArrowDown";
        if (!up && !down) return;
        e.preventDefault(); e.stopPropagation(); // the popup's own arrow keys change track
        setVolume((audio.muted ? 0 : vol) + (up ? 0.1 : -0.1));
      });
    }
    // the scroll wheel over the speaker or the line: up = louder, down = softer (the page doesn't scroll)
    if (volBox) volBox.addEventListener("wheel", function (e) {
      if (!e.deltaY) return;
      e.preventDefault();
      setVolume((audio.muted ? 0 : vol) + (e.deltaY < 0 ? 0.05 : -0.05));
    }, { passive: false });
    function dur() { var t = own(); return mine() ? last.duration : (t ? t.duration : 0); }
    function go(frac) {
      var d = dur();
      if (!mine() && target()) play(target()); // a click on the line of a track not playing yet starts it there
      seek(frac * d);
    }
    if (playBtn) playBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggle(target()); });
    // nothing playing yet (the hero): previous/next step from the track shown
    if (prevBtn) prevBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (cur < 0 && target()) { var id = from(target(), -1); if (id) play(id); } else prev(); });
    if (nextBtn) nextBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (cur < 0 && target()) { var id = from(target(), 1); if (id) play(id); } else next(); });
    if (bar) {
      bar.addEventListener("pointerdown", function (e) {
        if (!own()) return;
        dragging = true; bar.classList.add("dragging");
        try { bar.setPointerCapture(e.pointerId); } catch (x) {}
        draw(at(e) * dur(), dur());
      });
      bar.addEventListener("pointermove", function (e) { if (dragging) draw(at(e) * dur(), dur()); });
      bar.addEventListener("pointerup", function (e) { if (!dragging) return; dragging = false; bar.classList.remove("dragging"); go(at(e)); });
      bar.addEventListener("pointercancel", function () { dragging = false; bar.classList.remove("dragging"); render(state()); });
      bar.addEventListener("click", function (e) { e.stopPropagation(); });
      bar.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault(); e.stopPropagation(); // the popup's own arrow keys change track
        if (mine()) seek(last.time + (e.key === "ArrowRight" ? 5 : -5));
      });
    }
    subs.push(render);
    render(state());
  }

  /* The now-playing bar. opts.isOpen(): is the popup showing the music right now (then the bar hides);
     opts.open(id): open that track's popup again (without restarting it). */
  function miniBar(opts) {
    var svg = 'fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"';
    var el = document.createElement("div");
    el.className = "mp-mini";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Now playing");
    el.innerHTML = '<span class="mp-bar-line"><span class="mp-bar-fill"></span></span>' +
      '<button type="button" class="mp-mini-open"><img class="mp-mini-img" alt="" width="40" height="40" data-lqip=""><span class="mp-mini-title"></span></button>' +
      '<span class="mp-btns">' +
      '<button type="button" class="mp-btn mp-prev" aria-label="Previous track"><svg ' + svg + '><line x1="6" y1="6" x2="6" y2="18"/><polygon points="18,6 9,12 18,18"/></svg></button>' +
      '<button type="button" class="mp-btn mp-play" aria-label="Play"><svg class="mp-i-play" ' + svg + '><polygon points="8,5 19,12 8,19"/></svg><svg class="mp-i-pause" ' + svg + '><line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/></svg></button>' +
      '<button type="button" class="mp-btn mp-next" aria-label="Next track"><svg ' + svg + '><line x1="18" y1="6" x2="18" y2="18"/><polygon points="6,6 15,12 6,18"/></svg></button>' +
      '</span><span class="mp-vol"><button type="button" class="mp-btn mp-volbtn" aria-label="Volume" aria-expanded="false">' +
      '<svg class="mp-i-vol" ' + svg + '><polygon points="4,9.5 8,9.5 13,5.5 13,18.5 8,14.5 4,14.5"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/></svg>' +
      '<svg class="mp-i-muted" ' + svg + '><polygon points="4,9.5 8,9.5 13,5.5 13,18.5 8,14.5 4,14.5"/><line x1="16.5" y1="9.5" x2="21.5" y2="14.5"/><line x1="21.5" y1="9.5" x2="16.5" y2="14.5"/></svg></button>' +
      '<span class="mp-vbar" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100"><span class="mp-bar-line"><span class="mp-vfill"></span></span></span></span>' +
      '<button type="button" class="mp-mini-x" aria-label="Stop the music">&#x2715;</button>';
    document.body.appendChild(el);
    var img = el.querySelector(".mp-mini-img"), title = el.querySelector(".mp-mini-title"), shownId = null;
    el.querySelector(".mp-mini-open").addEventListener("click", function () { if (cur >= 0) opts.open(tracks[cur].id); });
    el.querySelector(".mp-mini-x").addEventListener("click", stop);
    // The footer ("Join the List", the legal links) stays reachable: while it shows, the bar rises above it. (It used
    // to hide instead, but pages that fit one screen, a track's own page, always show their footer.)
    var foot = document.querySelector("#footerWrap > footer, body > footer"), liftQueued = false; // baseof.html wraps it
    function lift() {
      liftQueued = false;
      var over = innerHeight - foot.getBoundingClientRect().top; // how much of the footer is on screen
      el.style.bottom = over > 0 ? Math.round(over + 14) + "px" : "";
    }
    function queueLift() { if (!liftQueued) { liftQueued = true; requestAnimationFrame(lift); } }
    if (foot) ["scroll", "resize", "load", "sitelayout"].forEach(function (ev) { addEventListener(ev, queueLift, { passive: true }); });
    // any of the site's popups open (a work, a book, a lightbox, Filters, the inquiry's selector): the bar steps aside.
    // The list is baseof.html's POPUPS (plus the inquiry selector); a popup is open with the class open or active.
    var OPEN = POPUPS.split(",").map(function (s) { s = s.trim(); return s + ".open, " + s + ".active"; }).join(", ");
    // (the fog's copies of the page hold an open popup's copy too, still "open" while it fades: never count those)
    var COPIES = "#siteMirror, #headerBleed, #footerBleed, #headerMirrorEcho, #footerMirrorEcho";
    function popupNow() {
      try { return [].some.call(document.querySelectorAll(OPEN), function (n) { return !n.closest(COPIES); }); } catch (e) { return false; }
    }
    var popup = popupNow();
    if ("MutationObserver" in window) new MutationObserver(function () { var p = popupNow(); if (p !== popup) { popup = p; emit(); } })
      .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    bind(el);
    var shown = null;
    subs.push(function (s) {
      var on = !!s.track && !opts.isOpen() && !popup;
      if (on && foot) queueLift();
      if (on !== shown) { shown = on; el.classList.toggle("show", on); el.inert = !on; }
      if (s.track && s.track.id !== shownId) {
        shownId = s.track.id;
        img.src = s.track.thumb || s.track.cover || "";
        title.textContent = s.track.side ? s.track.title + " — Side " + s.track.side : s.track.title;
        el.querySelector(".mp-mini-open").setAttribute("aria-label", "Open " + title.textContent);
      }
    });
    emit();
  }

  // Every page other than Production's (baseof.html loads this file there while music is carried): every track, in
  // the grid's play order, the bar (its title opens the track's own page), and on with the music.
  function everywhere() {
    if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", everywhere); return; }
    document.documentElement.classList.add("mp-bar-on"); // the bar's slot above the footer (baseof.html)
    api.setTracks(CONF.tracks || [], { artist: CONF.artist });
    miniBar({ isOpen: function () { return false; }, open: function (id) { var t = tracks[index(id)]; if (t && t.href) location.href = t.href; } });
    carryOn();
  }

  var api = window.musicPlayer = {
    audio: audio, autoNext: false, allTracks: CONF.tracks || [],
    setTracks: function (list, o) { tracks = list; artist = (o && o.artist) || ""; emit(); },
    setQueue: function (fn) { queue = fn; emit(); },
    play: play, pause: pause, toggle: toggle, next: next, prev: prev, seek: seek, stop: stop, setVolume: setVolume, toggleMute: toggleMute,
    bind: bind, miniBar: miniBar, refresh: emit, state: state, queue: function () { return queue(); },
    on: function (fn) { subs.push(fn); fn(state()); },
    carryOn: carryOn, everywhere: everywhere
  };
})();
