import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let html=readFileSync('themes/portfolio-theme/layouts/_partials/visitor-door-state.html','utf8');
let js=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('{{ site.Params.face_domain | default "" }}','"andrada.one"');
let jar=''; const document={get cookie(){return jar},set cookie(x){jar=x.split(';')[0]}}; const window={name:""};
vm.runInNewContext(js,{window,document,location:{hostname:'louis.andrada.one'},Number,JSON,Date,encodeURIComponent,decodeURIComponent});
let d=window.visitorDoor; assert.equal(d.read(),null); d.begin(1000); assert.equal(d.read().deadline,214000); let s=d.update(d.read(),214000); assert.equal(s.locked,true); s=d.unlock(s,214000); assert.equal(s.deadline,356000); s=d.update(d.read(),356000); s=d.unlock(s,356000); assert.equal(s.deadline,427000); s=d.update(d.read(),427000); assert.equal(s.finalOpenedAt,427000); d.finish(s); assert.equal(d.read().stage,4); console.log('actual visitor cookie-state VM: pass');
const blockedWindow={name:''}; const blockedDocument={get cookie(){throw Error('blocked')},set cookie(_){throw Error('blocked')}}; vm.runInNewContext(js,{window:blockedWindow,document:blockedDocument,location:{hostname:'louis.andrada.one'},Number,JSON,Date,encodeURIComponent,decodeURIComponent}); blockedWindow.visitorDoor.begin(1000); assert.equal(blockedWindow.visitorDoor.read().stage,1); assert.ok(blockedWindow.name.startsWith('visitor-door:')); console.log('blocked-cookie same-tab fallback: pass');

