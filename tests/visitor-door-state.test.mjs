import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let html=readFileSync('themes/portfolio-theme/layouts/_partials/visitor-door-state.html','utf8');
let js=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('{{ site.Params.face_domain | default "" }}','"andrada.one"');
let jar=''; const document={get cookie(){return jar},set cookie(x){jar=x.split(';')[0]}}; const window={name:""};
vm.runInNewContext(js,{window,document,location:{hostname:'louis.andrada.one'},Number,JSON,Date,encodeURIComponent,decodeURIComponent});
let d=window.visitorDoor; assert.equal(d.read(),null); d.begin(1000); assert.equal(d.read().deadline,23000); let s=d.update(d.read(),23000); assert.equal(s.locked,true); s=d.unlock(s,23000); assert.equal(s.deadline,34000); s=d.update(d.read(),34000); s=d.unlock(s,34000); assert.equal(s.deadline,45000); s=d.update(d.read(),45000); assert.equal(s.finalOpenedAt,45000); d.finish(s); assert.equal(d.read().stage,4); console.log('actual visitor cookie-state VM: pass');
const blockedWindow={name:''}; const blockedDocument={get cookie(){throw Error('blocked')},set cookie(_){throw Error('blocked')}}; vm.runInNewContext(js,{window:blockedWindow,document:blockedDocument,location:{hostname:'louis.andrada.one'},Number,JSON,Date,encodeURIComponent,decodeURIComponent}); blockedWindow.visitorDoor.begin(1000); assert.equal(blockedWindow.visitorDoor.read().stage,1); assert.ok(blockedWindow.name.startsWith('visitor-door:')); console.log('blocked-cookie same-tab fallback: pass');
// Someone who opened the door the usual way this visit gets no game from a work's footer (Louis, council #12445).
for (const [name, cookie, want] of [['door-session=open', '', true], ['', 'door-session=open', true], ['', 'other=1', false], ['visitor-door:x', '', false]]) {
  const w = {name}; const doc = {get cookie(){return cookie}, set cookie(_){}};
  vm.runInNewContext(js,{window:w,document:doc,location:{hostname:'louis.andrada.one'},Number,JSON,Date,encodeURIComponent,decodeURIComponent});
  assert.equal(w.visitorDoor.openedNormally(), want, `openedNormally name=${name} cookie=${cookie}`);
}
console.log('already-opened visitors start no game: pass');
