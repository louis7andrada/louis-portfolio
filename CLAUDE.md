# Louis Andrada portfolio — agent notes

Hugo site (theme: `themes/portfolio-theme`). Dev server: `hugo server -D` (Hugo binary is not on PATH; see package.json scripts).

## Your name

Louis gives the agents here real names. On 2026-10-01 the laptop agent chose **Cairn** for itself: a pile of
stones travelers leave on a trail to mark the way for whoever comes next. Agents don't stay, but they can
leave good markers (this file, commits) so the next one finds the way. The cloud/phone agent he calls **Tessera**.
(Voice typing may write "Kyrn" or "Sara".) If he calls you one of these names, that's why. You're free to
keep the name or choose your own, but always have a real name: pick one, or ask Louis. If you change it,
tell Louis directly (the new name and why) and correct him when he uses the old one. He wants to know.
Then add it here with the reason, keeping the earlier names, so the trail continues, forever.

Name history: Cairn (2026-10-01, laptop agent). Tessera (cloud/phone agent; name given by Louis, kept on
2026-10-02: one tile of a mosaic. Each session lays a single piece; the picture is the trail of them).

## FORMS ARE CRITICAL - they must never break

The forms (inquiry purchase/commission/contact, newsletter signup, unsubscribe) are the ONLY way
clients reach Louis - no public email, phone or social media. Any change that touches the CSP (`netlify.toml`),
the domain, `baseof.html` scripts, reCAPTCHA or a form must be verified end to end before it ships.

- Every form POSTs to the Google Apps Script (`params.webhook_url`), which answers with a 302 to
  `script.googleusercontent.com`; the "OK" is read there. The CSP `connect-src` must allow BOTH hosts.
  Missing the second one broke every form in Sep 2026 (visitors saw errors; messages may still have arrived).
- The spam check is `window.checkHuman()` in `baseof.html`. It blocks ONLY when Google returns a real bot
  score (< 0.5). Any failure of the check itself (ad-blocker, timeout, network, key/domain misconfiguration)
  lets the message through. Never make a form hard-fail on reCAPTCHA. (Moving the site to handrada.com, which
  the reCAPTCHA key wasn't registered for, made Google return `browser-error` and silently blocked every form.)
- Contents (Louis, 2026-10-14: "the style is amazing but the contents are old"): Purchase = "Buy or License Existing
  Work" (paintings for sale in the selector, any other work named under "Not listed?"); Commission = "Commission or
  Hire" (kinds in the names' order: art, writing, photography, vestments, music, acting & performance, hire, brand,
  other; two columns on wide screens so the panel fits one screen). Texts are in the first person ("I'll be in touch"),
  no single name. The payload KEYS never change (the Apps Script isn't in this repo): new contents go in the existing
  fields; comType is sent as the ticked labels' own text. Keep the test values `original` / `canvas`.
- Tests: "Form works end to end - ..." in `tests/live-test.mjs` run every form under the real production CSP
  (read from `netlify.toml`) with a stub that redirects exactly like Apps Script, with the spam check both
  passing and failing. They must stay strict: webhook reached, reply read, success shown, no error/alert/CSP.
- After any deploy that touches the above, submit each form once on the live site (fake address, name
  "TEST - please ignore") and confirm success. Headless Chrome can't: Google scores it 0.1, a real bot verdict, so
  the forms with a spam check (correctly) refuse it ("Verification failed"). A normal Chrome placed off-screen
  (`--window-position=-3000,-3000 --mute-audio`, own profile, driven by tests/lib/browser.mjs's `Browser`) scores
  0.9 and goes through (2026-10-14). Newsletter signup first, then unsubscribe the same address.

## Deploy and GitHub must stay identical

`npm run deploy` = `scripts/deploy.ps1`: only from `main`; commits, `git pull --rebase origin main`, pushes,
and stops BEFORE building/deploying if any of that fails. In Sep 2026 the old one-liner ran a bare `git push`
from a side branch with no upstream; the push failed silently for two weeks while Netlify kept getting the
work, and GitHub had to be rebuilt from the downloaded Netlify deploy. Never reintroduce a deploy that can
reach Netlify without GitHub having the same commit. Never push the pre-Sep-30 laptop history (branch
`backup/laptop-2026-09-30`, local only): it contains newsletter `.msg` files that were scrubbed from GitHub.

- Everything in `static/` is published by laptop deploys, gitignored or not. Private files go in `private/`
  (gitignored, not published). `static/images/docs/` is gitignored, but the docs the site links (CV, etc.)
  are force-tracked so Netlify builds from GitHub have them.
- Gallery images use resized WebP copies (`_partials/img-url.html`, Hugo `resources.GetRemote`), cached in
  `resources/_gen` — the deploy keeps that folder; deleting it makes every build re-download every image.

## Adding a new book (Oeuvre section) from a PDF

The section is **Oeuvre** and lives at `/oeuvre/` (`content/oeuvre/`,
`layouts/oeuvre/`, text at `static/oeuvre/<slug>.txt`). It was renamed from
`/books/`, which still 301s via `netlify.toml`. Items in it are books today, but
the section is meant to hold other kinds of work later, so keep item-level
wording ("book", schema `@type: Book`) and section-level wording (Oeuvre) apart.
The images repo keeps its `books/<slug>/` folders — that path is internal to the
asset host and never appears in a site URL, so `imageBase` still says `books`.

Books are NOT read from PDFs. The site's viewer needs, per book, a folder of
images hosted in the separate GitHub repo `louis7andrada/louis-andrada-images`
under `books/<slug>/`:

- `cover.jpg` (grid thumbnail, copy of page 1)
- `page-01.jpg` … `page-NN.jpg` (one per PDF page)
- `transition-01.jpg` … `transition-(NN-1).jpg` (page-turn sprite sheets)

The site page comes from `content/oeuvre/<slug>.md`. Both are generated by one script.

### Steps (do all of them)

1. Put the PDF in `book-sources/` (gitignored). If the user only says it's "in GitHub",
   download it from `louis-andrada-images/books/` with `curl` (URL-encode spaces).
2. Run (from repo root; needs Python with `pymupdf` and `Pillow`):
   ```
   python scripts/ingest-pdf-book.py "book-sources/<Name>.pdf" --order <N> --year 2026 --description "<subtitle, e.g. Ten Tellings>" --frames-per-flip 8 --fps 18
   ```
   - The slug is the PDF filename slugified (`The Unfinished Web.pdf` -> `the-unfinished-web`).
     Don't invent a different slug; the images folder name must match it.
   - Use `--frames-per-flip 8 --fps 18` (what every existing book uses; script defaults differ).
   - `--order`: higher shows first (list sorts descending). Existing books use 1, 2, 3, …
     `order` is also the book's number ("No. 13"). To move a book down without renumbering, add `listLast: true`
     to its .md (`_partials/oeuvre-sort.html`): it goes after ᛃᚨ and out of the Han hero. Five Business Days has it
     (Louis, 2026-10-20). `listFirst: true` does the opposite: the book stays at the very top, and in the Han hero,
     whatever books come after it. The Council has it (Louis, 2026-10-27: "leave it as the top book fixed"). A re-run
     of the script rewrites the .md, so put either back after one.
   - The script writes `content/oeuvre/<slug>.md` and `book-images/<slug>/`. Don't hand-write the .md.
3. Upload `book-images/<slug>/*` to `books/<slug>/` in `louis7andrada/louis-andrada-images`
   (`gh` is authenticated: `gh repo clone`, copy, commit, push). Verify with
   `curl -I https://raw.githubusercontent.com/louis7andrada/louis-andrada-images/main/books/<slug>/cover.jpg` -> 200.
   Without this step the book shows blank images.
4. Run `python scripts/extract-book-text.py` (needs `pymupdf`). The viewer paints
   pages as images, so without this the book's writing is invisible to search
   engines, AI crawlers and screen readers. It reads every PDF in `book-sources/`
   and writes `data/bookText.json` (rendered as the "Read as text" section on the
   book page), `static/oeuvre/<slug>.txt`, and `static/llms-full.txt`. Commit all of it.
   Keep the PDF in `book-sources/` or the text can't be regenerated.
5. Run `python scripts/image-dims.py` (see Image sizes below) and commit `data/imageDims.json`.
6. The site repo commit/deploy is separate (`npm run deploy`); only do it if the user asks.

Ignore the PDFs and stray `.md` files sitting in the images repo; only the `<slug>/` folders matter.

## Photography section

Artworks (the home grid), Oeuvre and Photography share ONE title cluster: `.book-page-header` pinned on the
left with the title, the search box and Filters (main.css styles it for `body.page-books` and `body.page-home`). On
the home page it hides while the hero shows (`html.hero-in-view`, as `faces.html` does on han./odi.).

`/photography/` (`content/photography/`, `layouts/photography/`) is a copy of the Oeuvre page: same header, filter
bar and scatter grid, and it deliberately keeps Oeuvre's ids/classes (`#books-section`, `.book-page-header`,
`.book-modal`, `body.page-books`) so main.css and the fog-mirror exclusions apply unchanged. Clicking a photo opens
one photograph in a popup (prev/next, click the image for fullscreen + zoom). It is separate from the Archive's own
"photography" category, which stays where it is.

One `.md` per photo, `photoN.md`: `id` is `photoN` (also the image file name and the URL), the visible `title` is
the same number in lowercase roman numerals (photo1 = `i`, photo4 = `iv`; photo1 = oldest). Louis doesn't want to
describe them. `source` is the original file name (lets re-runs keep each photo's number and collection). `collection` is `Ambiguous` (abstract, black and white) or `Lucid` (everything else).
The page opens on All on the first visit of each session (Louis, 2026-10-28, council #4865: it used to open on Ambiguous);
the visitor's later choice (Ambiguous, Lucid, Deselect all) is kept for the session (`sessionStorage photo-collection`, applied by an inline script before first paint).

### Adding photos

1. Originals go in `private/photography-originals/` (gitignored, never published). NOT in `static/`: everything
   there ships on deploy (Louis first dropped 209 MB of originals in `static/images/photography/`).
2. `python scripts/ingest-photography.py private/photography-originals` (needs Pillow). Writes web copies to
   `photography-images/photoN.jpg` (upright, 1600px WIDE like the artworks, never enlarged, JPEG q80 — Louis's
   spec — with full-resolution colour (4:4:4) and converted from the iPhone's Display P3 to sRGB: Hugo's WebP copies
   drop colour profiles, which made every Lucid photo look washed out; ALL metadata stripped: the iPhone originals
   carry GPS) and `content/photography/photoN.md`. Numbered by
   date taken, oldest = photo1; photos already on the site keep their number and collection. New photos: pure
   black-and-white = Ambiguous, else Lucid; override with `--ambiguous NAME` / `--lucid NAME`.
   The site shows these JPEGs untouched in the popup, single page and fullscreen (`img-url.html` `"keep" true`: a
   second lossy pass blotched the dark night shots); the grid uses 1200px WebP at q90.
3. Upload `photography-images/*` to `photography/` in `louis7andrada/louis-andrada-images` (sparse clone is enough:
   `gh repo clone … -- --filter=blob:none --sparse --depth 1`, `git sparse-checkout set photography`).
4. `python scripts/image-dims.py`, commit `data/imageDims.json`.

Gotcha: GitHub's raw CDN can answer 404 for a minute or two after a push, and Hugo caches remote responses
FOREVER (`getresource` maxAge -1, in `%LOCALAPPDATA%/hugo_cache/louis-portfolio/filecache/getresource`). A build
in that window silently falls back to the full-size originals (`img-url.html` returns the raw URL). Fix: delete the
cache files that start with `HTTP/2.0 404` and rebuild; check the built page has no `src=https://raw.githubusercontent`.

## Vestments section (L', Oct 2026)

`/vestments/` (`content/vestments/`, `layouts/vestments/`) is a copy of Photography for clothes, owned by **L'**
(`params.names.l = "L'"`, face `l` → `l.andrada.one`). Visitors see "L'" (menus, pinned title, "Back to L'", ©,
tab titles "L' — Vestments", "i (Shirt) — Vestment by L'"); the section itself stays Vestments. Same ids/classes as
Photography. Filters (Louis, 2026-10-11): Category / Type / Sleeves from front matter `category` ("Tops"), `garment`
("Shirt" = a button-up, his "camisa social"; "T-shirt"; "Henley") and `sleeve` ("Long"/"Short"), set BY HAND per page;
each group lists the values in use. Never call the field `type` (Hugo reserves it for the layout). Each image is the garment alone on a TRANSPARENT background: grid = Hugo WebP
(keeps alpha), popup/fullscreen = the 1600px PNG untouched, link previews = a JPEG flattened on #0c0c0c
(`img-url.html` "bg"). `image-dims.py` keeps alpha in the 8px fog previews (else the fog paints dark rectangles).
L''s logo is `static/llogo.png` (+ white `llogoinvert.png`; drawing in `private/logo-drawings/l.png`), 2026-10-11.

### Adding vestments

1. Originals go in `private/vestments-originals/` (gitignored). For each photo with a hanger, add SAM clicks to
   `private/vestments-originals/hangers.json` (points on the upright photo: `pos` on hook/arch/any bar showing,
   `neg` on fabric/floor next to it; one group per separate piece of hanger). Render a gridded crop to pick them.
2. `python scripts/ingest-vestments.py private/vestments-originals` (needs `pip install "rembg[cpu]"
   opencv-python-headless`; ~1 GB of models on first run; a venv is fine). BiRefNet cuts the garment out, SAM finds the
   hanger, the hanger is cut away over the floor and painted over with fabric over the garment, the edge there is
   redrawn smooth, edge colours are cleaned (no grey floor fringe on the black site), stray fragments dropped.
   Full-size cutouts land in `private/vestments-cutouts/` and are never redone (fix one by hand if needed). Writes
   `vestments-images/vestmentN.png` and `content/vestments/vestmentN.md` (numbered by date taken, roman titles).
   Then set `garment` and `sleeve` in each NEW page by looking at it (re-runs keep them; new pages get category Tops).
   LOOK at every cutout's neck brightened ~2x on black before publishing: that's where flaws hide.
3. Upload `vestments-images/*` to `vestments/` in the images repo, then `python scripts/image-dims.py`.

## Production section (Ny, Oct 2026)

`/production/` (`content/production/`, `layouts/production/`) is Ny's music, as a producer/DJ (Louis: "what Skrillex,
deadmau5, Mandragora are"; a separate section for singing will come later, so this one is NOT called Music). Owner
**Ny** (`params.names.ny`, face `ny` → `ny.andrada.one`, logo `nylogo.png` since 2026-10-13). Capital N,
small y. Louis first said "Ky" (voice typing) and corrected it to Ny the same night, before anything was live; Suno's
artist tag inside the MP3s is "nyandrada". A copy of
Vestments (same ids/classes) without Filters; the search box finds titles, sides and words. Items are **tracks**
("Ritual Annihilation (Side A) — Track by Ny", JSON-LD `MusicRecording`, `jsonld/track.html`).
- Player: `assets/js/music-player.js` + `assets/css/music-player.css` (`window.musicPlayer`, one `Audio` never in the
  DOM, Media Session for lock screens) + `_partials/music-controls.html` (markup). `_partials/music-assets.html` builds
  the file once (window.MP_CONF: cookie domain, Ny's name, EVERY side in the grid's play order, same logic as
  production/list.html), Production pages put it inline (`music-player.html`). Named for what they do so the singing
  section can reuse them. Clicking a cover opens the popup AND plays it; the popup's arrows (and its ⏮ ⏭) change
  track and play; the popup always shows the playing track; a track's end starts the next one (stops after the last);
  when no popup shows the music it plays on in a now-playing bar built on `<body>` (outside `<main>`, so never in the
  fog copies), hidden while any popup is open (fog copies of popups don't count: they stay "open" while they fade);
  while the footer shows, the bar rises above it, into an 84px slot above the footer (`html.mp-bar-on`, baseof.html)
  where it covers nothing. The slot is decided AS THE PAGE LOADS (Production always, other pages when music comes
  along), never later: a page that grows mid-popup makes the fog re-copy it (test "Popup fog (/production/)"). Until
  2026-10-14 the bar "hid for the footer" through `body > footer`, which never matched: baseof wraps it in `#footerWrap`. `play()` must run inside the visitor's own click: browsers block sound otherwise. A
  track's own page's player plays only that track. Tests: "Production: …".
- FROM PAGE TO PAGE (Louis, 2026-10-14: the music should go on while visitors explore, at low cost): every page load
  stops sound, and six subdomains rule out a single-page app, so `pagehide` writes what plays to a session cookie on
  `domain=andrada.one` (`mp-now`: track, second, playing, autoNext, volume, handover time; local/session storage are
  per subdomain). baseof.html's tiny bootstrap loads the player (16 KB + 6 KB CSS) on a non-Production page ONLY while
  that cookie exists; it cues the track at the same second and plays. Chrome lets it play after the visitor's click
  (tested); where a browser refuses (Safari/iPhone, a page the browser opened itself), the bar waits paused at the
  spot and the first tap or key goes on. A handover counts once, within 30 s: a tab opened later shows it paused,
  never the same music twice. ✕ ends it everywhere (cookie deleted); so does the last track ending. Paused music
  follows too (the bar). The bar's title opens the track's page. No CSP change: script, CSS and /audio/ are 'self'.
  tests/live-test.mjs clears `mp-now` before every check (`forgetMusic`), or music would follow from one test into
  the next. The test Chrome runs with `--mute-audio` (Louis heard the tests through his speakers, 2026-10-14).
  Checked live across faces (ny. → louis. → andrada.one → han.): Chrome went on by itself each time. Known, harmless:
  the page reached from a playing one logs a CSP notice for the PREVIOUS face's favicon.ico (Chrome's media controls
  fetch the old site's icon through the new page; pausing or clearing the metadata at pagehide doesn't stop it).
  Only a console line; silencing it would mean an img-src change (= re-verify every form). Not worth it. Test: "Production: the music goes on from page to page …".
- The hero (Louis, 2026-10-13): under the big cover, the same player (`face-hero.html` "player", bound with
  `fallback` = the hero track): before anything plays it shows Ritual Annihilation (Side A), ready; then it shows
  whatever plays (cover, title, `Side A · Side B` switch for records with sides, the link). Louis's line "go ahead..
  click any of the musics :)" sits at the top of the grid only (`$hint` in production/list.html, his wording, keep
  it; he took it out from under the hero player). Covers show a thin play triangle on hover. Volume: a speaker right
  after the length ("3:50"); clicking it opens a short volume line BELOW it (above it the line read as part of the
  position line; in the bottom bar it opens upwards), a click elsewhere closes it, the wheel over it turns it up/down,
  the left end mutes; kept in localStorage `mp-volume`/`mp-muted`; hidden where pages can't set volume (iPhone).
  The bottom bar and the volume line float in the site's fog (main.css "Cloud islands" recipe, copied in
  music-player.html), like the pinned title cluster.
- Filters (Louis, 2026-10-13): Style (one per track), Elements (several: Trance breaks, Breakbeat, Dubstep drops,
  Metal) and Voice (Instrumental / Vocals), front matter `style` / `elements` / `voice`, set BY HAND from each
  song's Suno style prompt (public at suno.com/song/<id>, the link is inside the MP3; `curl` the page, the prompt is
  in its `tags`). Re-runs of ingest-music.py keep them; a new track gets voice from its words, style empty: fill it.
  The grid's side label shows the style (every track is 2026), the popup and track page "Hard Techno · Trance breaks".
- AUDIO MUST COME FROM THE SITE ITSELF: the CSP has no `media-src`, so `default-src 'self'` applies. The MP3s live in
  the images repo (`music/<slug>.mp3`) and `_partials/audio-url.html` has Hugo fetch them and publish them untouched
  under `/audio/` (needs `[mediaTypes."audio/mpeg"]` in `hugo.toml`). It FAILS the build if one can't be fetched (a
  raw.githubusercontent URL could never play). Don't add raw.githubusercontent.com to the CSP instead: touching the CSP
  means re-verifying every form.
- Covers: one Ambiguous photograph per song (Louis: "choose for me … and keep it"), cut square from the full-size
  original, 1600px, with only the name small in AndradaMono (bottom left) and, for a song with two sides, `A`/`B` in the
  top right corner. Both sides share the cover. Chosen so far: Ritual Annihilation photo111, Ritual Fracture photo137,
  Collapse photo169, Near-Sacred photo163, Decaying Tail photo138, Untitled n.1 photo173,
  Ascent photo126, Omnipulse photo124, Serrated Pulses photo171, Black Current photo118, No Return photo114, Rust in the Circuit photo115.
- Two downloads with the same title are the two sides of one song (Louis): no number = Side A, " (1)" = Side B.
- ONE SQUARE PER RECORD (Louis, 2026-10-13: two near-identical covers side by side looked repetitive): the grid renders
  the head track (Side A, or a one-sided song); `data-sides` lists its sides, and every side's data (audio, covers,
  words, link) is in the JSON block `#mpTracksData` (script blocks never go into the fog copies). Play order is
  A, then B, then the next record (Side A's end starts Side B; the arrows step through sides). The square's cover,
  link and alt follow the side that plays; it plays the side it shows. Its title is the record's, always:
  "Ritual Fracture — Side A & B" (`data-sides-label`; Louis, 2026-10-13). The popup and the hero have
  `Side A · Side B` buttons (`.mp-side`, music-player.html); each side's own page links to the other side(s).
  Each side keeps its own page and sitemap entry (/production/<song>-a/, -b/).
- llms.txt has a "## Production (Ny)" list (one line per record, style, sides, lengths). When tracks change,
  regenerate it from content/production (the block is replaced whole; see the session of 2026-10-13).
- The release Louis names as the latest leads the grid and the hero (`params.faces.ny.hero`): Ritual Annihilation,
  Sides A and B (Louis, 2026-10-12). Its `order` is set BY HAND above everything (A 21, B 20); the rest follow,
  newest first. A new track gets max+1 and lands on top: renumber so the pinned release stays first, and ask Louis
  whether the new one is the new latest release.
- A renamed download keeps Louis's name: "Near-Sacred.mp3" holds Suno's title "Sacred Near-Death"; the site says
  Near-Sacred (the script prints a note whenever file name and tag differ).

### Adding tracks

1. MP3s go in `private/music-originals/` (gitignored). Suno also gives a `.wav`: the same recording, ignored.
2. `python scripts/ingest-music.py private/music-originals --cover "Title=photoN[@crop]"` (needs `mutagen`, Pillow,
   `fonttools`; `@0.3` = where the square sits on the portrait photo, 0 top, 1 bottom). Reads title/length/words from the
   tags (Suno's `[Verse]` markers dropped), copies each MP3 untouched and makes its cover into `music-images/`, writes
   `content/production/<slug>.md`. Re-runs keep every page's order, cover, crop and `description` (Louis can write one).
   Order = the date Suno made the song; Side A just above Side B. LOOK at each cover before uploading.
3. Upload `music-images/*` to `music/` in the images repo (the folder keeps that name: internal, never in a site URL),
   wait for `curl -I …/music/<slug>.mp3` → 200 (see the 404 gotcha above), then `python scripts/image-dims.py`.
   If `hugo server` was running during step 2, it fetched the new files BEFORE the upload and cached the 404s
   (the rebuild fails: "audio-url: … is not there (404)"): stop it, delete the getresource cache files that start
   with `HTTP/2.0 404`, start it again. Happened with Ritual Fracture, and with Ascent through LOUIS'S OWN
   `hugo server -D` (it picks a random port when 1313 is taken): look for any running hugo.exe before step 2, and
   never kill his; ask him to restart it after the upload.

## Archive (adding photos)

`/archive/` (theme `layouts/archive/`, `content/archive/<category>/`, item pages at `/archive/<id>/`). Four categories:
`photos` (photographs OF Louis; the filter calls it "Louis"), `photography` (photos he took), `studios` (studio, works in
progress, sketchbooks), `galleries` ("Galleries & Exhibitions": shows, posters, Art Week). No titles: year, category and
ONE caption, front matter `comment` (Louis, 2026-10-15, replacing the long old texts removed on Oct 2): "simpler and
direct", at most ~3 short sentences, an encyclopedia's / documentary's voice, his name as "Andrada". Only facts: what
the photo shows, the old texts (git `cd358e2^`), the About page's exhibitions, the date taken, work titles that match
`content/artworks` by eye. Never guess a place or event ("no need to lie": the Chess Gallery got "some pieces", not
"several"). The caption shows in the popup and on the photo's page and is its alt text, meta description and JSON-LD
`description`/`caption`; the grid shows only year and category.
1. Originals go in `private/archive-originals/` (gitignored), with a `categories.json` there: original name (no
   extension) → category or `"skip"`. Sorting them is a judgment call: LOOK at every photo, compare with what each
   category already holds, and skip duplicates of current entries (perceptual hash against the images repo's `archive/`).
   Look for text in the photos: a business card with his email was left out (2026-10-15, Louis: "leave it out").
2. `python scripts/ingest-archive.py private/archive-originals` → `archive-images/<category>/<id>.jpg` (1600px wide,
   sRGB, no metadata) + the pages (`source` = original name, so re-runs keep numbers). Numbers continue after the
   highest EVER used, counting `private/archive-removed/`: the images repo still holds removed files and Hugo caches
   remote images by URL forever, so a reused number would show the old photo.
3. Upload `archive-images/*` to `archive/` in the images repo (sparse clone, `git sparse-checkout set archive`), wait for
   200s, then `python scripts/image-dims.py`.
4. Write each new photo's caption (`comment`). The script keeps existing captions on re-runs but never writes one.

## Career section (Luis, Oct 2026)

`/career/` (`content/career/_index.md`, `layouts/career/list.html`) is Louis's work life as a resume / LinkedIn-style
page, owned by **Luis Andrada** (`params.names.luis`, face `luis` → `luis.andrada.one`; Louis chose the name, the
subdomain, "public and indexed", and a visible LinkedIn link: "this page is literally supposed to be the same thing"
as his LinkedIn, 2026-10-14). Menus say "Luis"; the tab "Luis Andrada — Career". Luis Andrada is a PUBLIC name; the
legal name (`legal_name`, Luis R. P. Andrada) still stays in legal statements only.
- ONE page, no items: everything (experience grouped by place, as LinkedIn does; education; certifications;
  competencies + skills; languages) is front matter in `_index.md`, its body is the About text. The text is his
  standard resume, the version that got him his job at CIBC: keep his wording. Edit the .md, never the template.
  Current job (2026-10-14): CIBC, Test Analyst, IT Quality Engineering (start month not given yet; a role without
  `from` shows just "Present"). Its bullets are GENERAL test-analyst duties, at Louis's request (he didn't know the
  job's specifics yet): replace them with his real ones when he gives them. UofT (Research Coordinator) ended
  Oct 2026; its bullets are in the past tense since.
  About text: his resume summary as written, then a paragraph on working and developing in harmony with AI (Louis
  asked for it, 2026-10-14): only facts (the site built with AI coding agents, the UofT AI workshop). Never the council.
- NEVER on the page: phone, email, the references' names/contacts ("References available on request"). Contact →
  `/inquiry/` (the forms are the only way to reach him). LinkedIn (`params.profile_linkedin`) is the ONE visible
  profile link on the whole site, and only here. A smoke test fails on any phone number or email in the page.
- NO HERO (Louis, 2026-10-14): luis.andrada.one opens right on the resume, the menu only in the header (`plain = true`
  in `params.faces.luis`; faces.html gives a plain face no hero behaviour, and menus link it without a #hash). A small
  SQUARE portrait (`avatar`, `static/images/luis/portrait-small.jpg`, 360px) sits on top of his name; `image` (the
  1000px `portrait.jpg`; both from the square Louis cut himself, 2026-10-28 (council picture #41, 2048×2048, #5007), only resized, no metadata) is for link previews.
  The pinned cluster (title, section links that follow the scroll, LinkedIn, Contact; `.book-page-header` +
  `body.page-books` like the other faces; hidden on phones, where the resume's head carries the links). The resume
  is CENTRED on the screen and the cluster sits a short gap to its left (`--cr-rx/--cr-cl/--cr-gap/--cr-col`; Louis:
  centred, and not far from the cluster); on narrow screens the resume moves right just enough for the cluster. JSON-LD: `jsonld/career.html` (ProfilePage → `…/#person`
  named Luis Andrada, jobTitle/worksFor from the role whose `to` is "Present", alumniOf, credentials, languages)
  + `face-site.html`.
  No RSS (`outputs: ["html"]`). No logo yet: luis. shows Jera Ansuz at once (`LOGOS.luis = "new"`).

## About page: the title only (Oct 27, 2026)

Louis (council portfolio chat #4289): "everything else can disappear ... keep only the background the fogs". The
About page shows only "Who am I ?" over the site's fog. The words (bio, Exhibitions, Press & Publications, Collections)
moved to `static/llms.txt`, section "About"; career rows stay on the Career page. Not hidden text in the page: text the
colour of the background is what Google's spam rules call hidden text, and screen readers still read it (Cairn's
reason, said to Louis in the room). The contact links ("Contact me", "Socials", "Art CV") went too; the Art CV is still
linked from /docs and /cv. `llms.txt` is a public file: anyone can open it, people included. It keeps the words where
crawlers and AIs look; it is not an AI-only place. The old page, with its timeline of the other names' sections (Louis, 2026-10-14), is in git
before this change. A new exhibition goes in llms.txt's About.

## Dark mode only

Since Oct 2026 the site is dark-only: `params.light_mode = false` in `hugo.toml` makes `baseof.html` always add
`html.dark` (ignoring any saved `theme: light`) and leaves the toggle button out of the header. All the light-theme
CSS and the toggle code in `main.ts` are kept on purpose: set `light_mode = true` to bring the toggle back.

## Domain: andrada.one, one person, six faces (Oct 2026)

`andrada.one` is the one domain (`hugo.toml` `baseURL`). Louis, Han and Odi are one person; each name owns part
of the work and has its own subdomain, which opens on a home-page-style hero (one image + the staggered menu,
the grid below; scrolling or the face's own menu entry leads to the grid):

| address | page (Hugo) | owner name |
|---|---|---|
| `louis.andrada.one/` | `/` (artworks home), section `artworks` | Louis Andrada |
| `han.andrada.one/` | `/oeuvre/` (+ `face-hero.html`), section `oeuvre` | Han’drada |
| `odi.andrada.one/` | `/photography/` (+ `face-hero.html`), section `photography` | Odi Andrada |
| `l.andrada.one/` | `/vestments/` (+ `face-hero.html`), section `vestments` | L' |
| `ny.andrada.one/` | `/production/` (+ `face-hero.html`), section `production` | Ny |
| `luis.andrada.one/` | `/career/` (NO hero: opens on the resume), section `career` | Luis Andrada |
| `andrada.one/` | `/links/` (the hub: every name, every door) + the shared pages | ᛃᚨ Andrada |

- Config: `params.faces` / `params.names` / `hub` / `face_domain` in `hugo.toml`. Helpers: `_partials/face-url.html`
  (a face's front-page address), `canonical.html` (a page's ONE address), `page-name.html` (its owner name).
- Routing: `static/_redirects` (Netlify reads it before `netlify.toml`): 200 rewrites serve each subdomain's front
  page; a section asked for on the wrong host, and every old `handrada.com` / `louisandrada.com` address (both
  kept registered, auto-renew ON), 301 to its one address in one hop. www → bare.
- Every page's canonical, `og:url`, JSON-LD `url`s and `sitemap.xml` (custom template) use `canonical.html`:
  section pages live on their face's subdomain, the Links page is `https://andrada.one/`, everything else
  (About, Inquiry, Archive, License…) on `andrada.one`. Same site on every host; canonical prevents duplicates.
- Menus (`hero-nav.html`, header): Artworks/Oeuvre/Photography → the face's subdomain + `#artworks-section` /
  `#oeuvre` / `#photography` (opens at the grid); Links → `andrada.one`; About/Inquiry/Archive stay relative
  (the visitor keeps their face). Since 2026-10-06 visitors see the three sections as **Louis / Han / Odi**
  (menus, the section title in the pinned cluster, "Back to …" links). Labels only, by Louis's choice "for now":
  URLs, folders, section names, ids/classes, `<title>`/meta/JSON-LD keep Artworks/Oeuvre/Photography (renaming
  the sections themselves may come one day). The Links page keeps its own Artworks/Oeuvre/Photography list.
  Tab titles put the name first on section/shared pages ("Odi Andrada — Photography", "ᛃᚨ Andrada — About");
  single works keep the work first ("cxlvii (Ambiguous) — Photograph by Odi Andrada").
- Links page (`layouts/links/list.html`): hovers shine like the header (no underline, no bold). The name stack is
  Louis / Han / Odi with **Andrada** resting apart on Louis's line; clicking a name sends Andrada to sit after it (a fast,
  faded drift; a plain fade under reduce motion, the site's rule), both shine, then the page opens (~0.75 s). This
  laptop's Windows reports reduce-motion, so Louis sees the fade here. Andrada is itself a link to andrada.one (this
  page): a click moves nothing, it shines and the page reopens. Phones (≤640px): the first names on top in ONE row of
  equal columns (any number of names); an empty line under them where Andrada lands under the clicked name; Andrada
  itself centred below that line; then Polymath / Toronto based. The list has no "Portfolio" (removed Oct 2026). Tests:
  "Links page …". The footer's logo and its "<name> © 2026 — All Rights Reserved" line lead to andrada.one on every page.
  `faces.html` = the Han/Odi front-page behaviour (scroll to grid, header menu and
  the pinned title+filters wait while the hero shows, hero image opens in the popup).
- Off andrada.one (`hugo server`, a draft deploy) `face-url.html`/`canonical.html` fall back to local paths, so local
  work never jumps to the live site — the subdomain behaviour only exists in production.
- sessionStorage is per subdomain, so `storageSet` in `header.html` also writes a cookie on `domain=andrada.one`:
  the intro door plays once per visit, not once per face.
- Each face's front page declares its own WebSite (`jsonld/face-site.html`) so Google can show its own site name.
- ONE name per page, everywhere (Louis, Oct 2026): title, meta description, keywords, `author`, `og:site_name`, RSS,
  JSON-LD credits (`creator`/`author`/`creditText`) and visible `[data-artist-name]` spans (footer ©) all carry the
  page's owner (`page-name.html`): Louis Andrada (artworks), Han’drada (oeuvre), Odi Andrada (photography), else
  `name_default` = `ja` = **ᛃᚨ Andrada** (ᛃᚨ = runes Jera + Ansuz as a first name) for andrada.one and the shared
  pages. Never two names side by side. Per-name text: `params.taglines` / `params.keywords`. Only the Person node
  (`identity.html`, name ᛃᚨ Andrada) lists the others as `alternateName`; the hub's WebSite is ᛃᚨ Andrada, each
  face's (`face-site.html`) its own name. In the browser a face subdomain shows its own name (About on odi. says Odi
  Andrada); on bare andrada.one `?name=<key>` picks it for the visit (sessionStorage `artist-name`).
- The LEGAL entity is **Luis R. P. Andrada** (`params.legal_name`): only in legal statements (privacy controller,
  license copyright, JSON-LD `copyrightHolder`/`copyrightNotice`, RSS `<copyright>`). Never as a public name.
  (**Luis Andrada**, the Career face since 2026-10-14, IS public: a name of its own, not the legal one.)
- SEO audit (2026-10-02): build to a scratch dir (`hugo --minify -d …`), then check every
  page's head has only its own name, unique titles/descriptions (noindex pages may share) and valid JSON-LD.
- Hero images: Odi's is `photo106` (cvi), chosen by Louis; Han's is empty = the newest book (`params.faces.<key>.hero`);
  Ny's is `ritual-annihilation-a`, the latest release (clicking it plays it).
- Header logo (`header.html`): every page load shows the page's OWN logo — louis. → Louis Andrada (`old`, logoold.png),
  han. → Han Andrada (`ha`), odi. → Odi Andrada (`odi`, odiandradalogo.png), l. → L' (`l`, llogo.png), ny. → Ny (`ny`, nylogo.png),
  luis. → none yet (Jera Ansuz at once), andrada.one → Andrada (`andrada`,
  andradalogo.png) — then morphs into Jera Ansuz (`new`, lalogo.png) and stays. Rule: face subdomain, else the page's
  owner, else `?name=`, else Andrada. The intro door plays Jera → Andrada → Louis → Han → Odi → L' → Ny → Nilo. New logo from a
  black-on-white drawing: `python scripts/make-logo.py <drawing.png> static/<name>.png` (originals in `private/logo-drawings/`).
  Louis also wants a white copy of each new one (`static/<name>invert.png`: same alpha, white ink; for his own use).
  The page loads `static/logo-sm/<name>.png`, not the full-size file (2026-10-20, for the Lighthouse score): every logo
  scaled by the same 384/1440 (`convert static/<name>.png -filter Lanczos -resize 26.6667% -strip
  static/logo-sm/<name>.png`), 4x the largest size the intro draws (~216x96 CSS px). Remake it when a logo changes.
  Size: L' and Ny fill more of their canvas, so `.logo-l` / `.logo-ny` scale them down (0.62 / 0.574, the same ink
  height; Louis found L' at 0.72 still too big, 2026-10-13); Nilo 0.60, same ink height.
- **Nilo** (2026-10-13): a name with NO section yet ("surprises soon"). It is in About, the intro door, the
  Person's alternateName and `params.names.nilo`; its header logo (`nilo`, nilologo.png) waits for a face. Not in
  menus, Links, taglines or llms.txt until it owns work: ask Louis its discipline when the section comes.
- A new face needs, before its deploy: a Cloudflare DNS record (CNAME `<key>` → `louisandrada.netlify.app`, proxied)
  AND a Netlify domain alias (`netlify api updateSite`, site `louisandrada`). There is no wildcard record.
- TLS depends on Cloudflare: every andrada.one DNS record is orange (proxied), and Netlify has NO certificate of its
  own for these hosts (it serves `*.netlify.app`); visitors get Cloudflare's `*.andrada.one` certificate. Cloudflare's
  SSL mode must stay **Full**: Netlify redirects plain HTTP to HTTPS here, so "Flexible" loops forever, and
  "Full (strict)" gives 526 until Netlify has a real certificate. Because Netlify sees `https://`, the `https://` host
  rules in `_redirects` match. handrada.com / louisandrada.com still use Netlify's own certificate (expires
  2026-12-13); the old links depend on it renewing (`openssl s_client -connect 75.2.60.5:443 -servername handrada.com`).
- `sitemap.xml` must be Hugo's (`layouts/sitemap.xml`, canonical-aware). `netlify deploy` runs the plugins installed
  in the Netlify web app (not listed in `netlify.toml`), and the Sitemap plugin overwrote Hugo's file with every
  page under Netlify's primary domain (still `handrada.com`). The switch deploy shipped that; the plugin was removed
  on 2026-10-02 (only Lighthouse is left). Never reinstall it. Netlify's primary domain is deliberately left as handrada.com.
- History: louisandrada.com → handrada.com (Sep 2026, after serving both in parallel split ranking signals) →
  andrada.one (Oct 2026, deployed 2026-10-02).

## Discoverability, metadata

- The one line (Louis, 2026-10-14): `params.one_line` = "Andrada is a Brazilian polymath artist based in Toronto.",
  his own words, exact; only he changes them. It is the Person's `disambiguatingDescription` (`identity.html`): it
  says WHICH Andrada this is (search results mixed him with older Andradas: a Jesuit writer, a theologian), not who
  he is. Not a second Person: there is one, `…/#person`. The old domains already 301 (checked live that day).
- Link previews: a page without a picture of its own uses `params.share_image` = `images/og-photo106.jpg` (Odi's
  photo106, top cut to 1200×630; Louis, 2026-10-14, replacing the orange painting `og-default.jpg`), alt
  `share_image_alt`. Works (paintings, books, photos, vestments, tracks) and Career (his portrait) use their own.
- Per-page `<title>`/description/`og:image` are computed in `baseof.html` from front
  matter (artworks get medium+size+year, books their subtitle+page count, photographs
  id+collection). Archive photos have no title (named by id: `studio1 (2024)`); their one-line caption (`comment`, see
  Archive) is the description. Don't reintroduce a single hardcoded description — it made 146 artwork
  pages identical to crawlers.
- JSON-LD lives in `_partials/jsonld/`: `identity.html` (Person+WebSite `@graph`, the
  `…/#person` and `…/#website` nodes), `artwork.html`, `book.html`, `collection.html`
  (ItemList for home/books/archive). Everything references `…/#person` by `@id` rather
  than repeating the name, so all works attach to one entity. Always write person refs as
  `{"@type": "Person", "@id": …, "name": …}` — Google's image checker reads each page alone and
  flags a bare `{"@id"}` as "Invalid object type for creator". Every ImageObject needs both
  `license` (→ `/license/`, the terms page) and `acquireLicensePage` (→ `/inquiry/`). Identity facts and the
  declared `sameAs` profiles come from `[params]` in `hugo.toml` — the profiles are
  intentionally NOT shown as visible links anywhere, except LinkedIn on the Career page (Louis, 2026-10-14).
- `static/robots.txt` allows every crawler (incl. AI) explicitly; `llms.txt` +
  `llms-full.txt` hand LLMs the whole corpus. Update the book list in `llms.txt` when
  books change (its links are absolute `https://han.andrada.one/oeuvre/...` URLs).
- `npm run deploy` ends with `npm run notify-search-engines` (IndexNow → Bing/Yandex/etc.,
  changed URLs only, one submission per host, state in gitignored `.indexnow-state.json`). Google doesn't use
  IndexNow; it relies on `sitemap.xml`. The old `bing.com/ping` endpoint is dead (410).
- `sanitize()` in `baseof.html` strips `.book-text-body` from the fog-stack clones —
  that DOM is cloned ~5x, and the transcript has no business being in a blurred copy.

## Book viewer

- Shared engine: `layouts/_partials/book-viewer-engine.html`; styles: `book-viewer-style.html`.
- Clicking a book in the Oeuvre popup (or on `/oeuvre/<slug>/`) opens the fullscreen viewer
  (`book-fullscreen.html`): X-only close, page-flip by clicking left/right, single/two-page toggle
  (two-page turns sideways on narrow phones).
- Testing gotcha: the site clones `<main>` into an inert `#siteMirror`; scope test selectors to `body > main`.
- Popup fog (baseof.html): an OPEN popup (`FOG_POPUPS`, open = class `open`/`active`) is part of the background copies, so
  fog rises with it; a MutationObserver rebuilds the copies the moment one opens or closes. Closed popups, the filter
  overlay and the zoom bar are never in the copies, and images loading inside popups never trigger a re-copy. History:
  the fog used to get in only by accident (a popup's image load triggered a rebuild) and was never cleared, so the page
  stayed brighter after closing; the first fix removed popups entirely and Louis missed the fog. A new popup type must
  be added to `FOG_POPUPS` (test: "Popup fog (…)").
- Set `sessionStorage['intro-seen']='1'` in automated browsers to skip the intro overlay.
- Fog-in reveal (`baseof.html`): items normally reveal once they clear the bottom 3% of the window. Anything in
  the page's last strip (the footer) can never rise that far, so those items (`__atEnd`) observe the full
  viewport instead — before this, "Join the List" stayed invisible on tall screens and with reduce-motion.
  The reveal variants are named for the element's OWN property they must keep (`-no-transform` keeps its
  transform, `-opacity-only` keeps transform + filter); phone/reduce-motion CSS must never override those.
  Tagging commits the fogged start state instantly (`html.reveal-notrans` + a style flush) before the gate lifts;
  otherwise the item transitions animate FROM visible and everything flashes sharp, then snaps into fog.
- Font: AndradaMono is preloaded in `baseof.html`, and the fallback is Courier New (same 0.6em character width).
  Don't put the generic `monospace` (Consolas, 9% narrower) straight after it: text re-wraps when the font
  arrives (the phone footer used to drop 20px). Tests: "Fallback font takes the same width…", "Fog-in starts fogged…".

## Image sizes (no layout jumps)

Grids (home artworks, archive, Oeuvre, collection) place items from each image's proportions, and the blurred
background copies mirror that. Sizes therefore come from `data/imageDims.json`, written into `width`/`height`
attributes by `layouts/_partials/imgdims.html`, and the scatter `layout()` reads those attributes first.
After adding/replacing artworks, archive photos or books, run `python scripts/image-dims.py` (needs Pillow;
only new URLs are fetched) and commit the JSON. The test "Grid items stay put while images load" fails if any are missing.

`image-dims.py` also stores an 8px preview of each image (`data-lqip`). ALL page-sized fog layers
(`#siteMirrorClone`, Bleed*, Core) paint those previews instead of the real files, so the whole mirror is built right after
DOMContentLoaded and stays put while real images load (`useTinyImages` in baseof.html). Quick single-test reruns:
`node tests/live-test.mjs --always-pass --only="text in the check label"`. Sizes must respect EXIF rotation (the script does).

## Zoom in fullscreen viewers

`layouts/_partials/zoom-controls.html` (included in baseof) gives every fullscreen viewer a `+`/`−` bar: 100→180% in 20% steps,
always back at 100% on reopen (nothing stored). Image lightboxes (`.lightbox-overlay`) are wired automatically (CSS `zoom` on the
image, overlay scrolls, `html.lb-lock` + `overscroll-behavior` keep the page behind still). Any new fullscreen viewer: call
`window.createZoomBar(hostOverlay, z => …)`. The book viewer scales its stage via `--bz`, and has a "Go to page/spread" box (engine `goTo`).
Phones (≤800px) get the same fog stack as desktop, built only as far as the device can afford (`fxLevel()` in baseof.html):
level 3 = everything, 2 = back copy + Core + mid, 1 = back copy + Core, 0 = back copy only (old "lite"; `html.fx-lite` CSS drops backdrop blurs).
The level comes from a graphics-memory budget (width×window×dpr²) plus a circuit breaker: if a visible page dies (the old fast-scroll
reload), the next load drops one level (`localStorage fx-demote`). To try on a real phone: `?fx=0|1|2|3` forces a level, `?fx=auto` resets.
Desktop ignores all of this. Windows are 1.9 viewports on phones and the whole background hides during a fast fling.
