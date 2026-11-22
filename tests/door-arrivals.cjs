// Door arrivals (Louis, council #12445, #12449, #12473), in a real Chromium: node tests/door-arrivals.cjs <built site dir> <work paths...>
// Needs the playwright package. Serves the build on localhost:8137; four visitors per work: outside, opened door, finished game, mid-game.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.argv[2];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0].split('#')[0]); let f = path.join(ROOT, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { if (fs.existsSync(f + '.html')) f += '.html'; else { r.writeHead(404, {'content-type': types['.html']}); return r.end(fs.readFileSync(path.join(ROOT, '404.html'))); } }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(8137);
const B = 'http://localhost:8137';
let pass = 0, failn = 0; const ok = (c, m) => { c ? pass++ : failn++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
(async () => {
  const br = await chromium.launch();
  const works = process.argv.slice(3);
  for (const w of works) {
    for (const [label, cookies, known] of [['outside', [], false], ['opened door', [{ name: 'door-session', value: 'open', url: B }], true],
      ['finished game', [{ name: 'visitor-door', value: encodeURIComponent(JSON.stringify({ stage: 4, deadline: null, locked: false })), url: B }], true],
      ['mid-game', [{ name: 'visitor-door', value: encodeURIComponent(JSON.stringify({ stage: 1, deadline: Date.now() + 200000, locked: false })), url: B }], false]]) {
      const ctx = await br.newContext(); await ctx.addCookies(cookies); const pg = await ctx.newPage();
      await pg.goto(B + w, { waitUntil: 'load' }); await pg.waitForTimeout(300);
      ok(new URL(pg.url()).pathname === w, `${w} ${label}: stays on the work (${pg.url()})`);
      const vis = async (sel) => pg.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'), sel);
      ok(await vis('#siteHeader') === known, `${w} ${label}: header ${known ? 'shown' : 'hidden'}`);
      const arrows = await pg.evaluate(() => !!document.querySelector('#prevBtnDesktop, #nextBtnDesktop'));
      if (arrows) ok(await vis('#prevBtnDesktop, #nextBtnDesktop') === known, `${w} ${label}: arrows ${known ? 'shown' : 'hidden'}`);
      ok(await vis('.sp-back, .photo-back') === known, `${w} ${label}: 'Back to' ${known ? 'shown' : 'hidden'}`);
      ok(await vis('#footerWrap a[href]'), `${w} ${label}: footer link visible`);
      if (await pg.evaluate(() => !!document.querySelector('.mp-side'))) {
        ok(await vis('.mp-side.active'), `${w} ${label}: its own side shown`);
        ok(await vis('.mp-side:not(.active)') === known, `${w} ${label}: other side ${known ? 'shown' : 'hidden'} (Louis #12498)`);
      }
      if (label === 'outside' || label === 'opened door') {
        await pg.evaluate(() => { const a = document.querySelector('#footerWrap a[href^="/"], #footerWrap a[href*="andrada.one"]'); a.addEventListener('click', (e) => e.preventDefault()); a.click(); });
        const c = (await ctx.cookies()).find((x) => x.name === 'visitor-door');
        ok(label === 'outside' ? !!c && JSON.parse(decodeURIComponent(c.value)).stage === 1 : !c, `${w} ${label}: footer ${label === 'outside' ? 'starts' : 'does not start'} the game`);
      }
      await ctx.close();
    }
  }
  await br.close(); srv.close(); console.log(`${pass} ok, ${failn} failed`); process.exit(failn ? 1 : 0);
})();
