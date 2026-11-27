const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../themes/portfolio-theme/layouts/_partials/fullscreen-invite.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\{\{.*?\}\}/, '"example.com"');
function setup(stored, shared, supported = true) {
  const window = {}, timers = [], events = new Map();
  let buttons = 0, dismissed = 0;
  const document = {
    cookie: 'fs-invite=' + shared, fullscreenEnabled: supported, readyState: 'complete',
    documentElement: { requestFullscreen() {} },
    getElementById() { return null; },
    body: { appendChild() { buttons++; } },
    createElement() { return { classList: { add(c) { if (c === 'fs-gone') dismissed++; } }, addEventListener() {}, contains() { return false; } }; },
    addEventListener(type, callback) { events.set(type, callback); },
    removeEventListener(type) { events.delete(type); }
  };
  vm.runInNewContext(source, { window, document, location: { hostname:'example.com' },
    sessionStorage: { getItem: () => stored, setItem: (_, value) => { stored = value; } },
    requestAnimationFrame() {}, setTimeout(fn, delay) { if (delay === 700) timers.push(fn); }, clearTimeout() {} });
  return { window, events, run() { timers.splice(0).forEach(fn => fn()); }, buttons: () => buttons, dismissed: () => dismissed };
}
let test = setup('pending', 'shown');
test.run();
assert.equal(test.buttons(), 0);
test = setup('pending', 'pending');
test.window.fsInviteWait();
test.window.fsInviteWait();
test.run();
assert.equal(test.buttons(), 1);
assert.equal(test.events.has('pointerdown'), false);
test.events.get('click')({target:{}});
assert.equal(test.dismissed(), 1);
test = setup('pending', 'pending', false);
test.run();
assert.equal(test.buttons(), 0);
console.log('4 checks passed');
