#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const PROJECT = 'demo-geoguess-admission';
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
// No provider setup or credential generation precedes the fail-closed guards.
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
const appRoot = path.resolve(__dirname, '../../..');
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const toolRequire = createRequire('/workspace/.geoguess-emulator-tools/package.json');
assert.equal(appRequire('firebase/package.json').version, '8.10.1');
assert.equal(toolRequire('firebase/package.json').version, '11.10.0');
assert.equal(toolRequire('@firebase/rules-unit-testing/package.json').version, '4.0.1');
const firebase = appRequire('firebase/app');
appRequire('firebase/database'); appRequire('firebase/auth');
const { initializeTestEnvironment } = toolRequire('@firebase/rules-unit-testing');
const { ref, get, set, update } = toolRequire('firebase/database');
const babel = appRequire('@babel/core');
const modules = new Map();
function sourceModule(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false,
        plugins: [appRequire.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    const requireLocal = id => {
        if (id.startsWith('.')) return sourceModule(path.resolve(path.dirname(filename), `${id}.js`));
        assert.equal(id, '@turf/distance');
        return appRequire(id);
    };
    new Function('require', 'module', 'exports', code)(requireLocal, module, module.exports);
    return module.exports;
}
const { createRoundClient } = sourceModule(path.join(appRoot, 'src/event/round.js'));

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const setup = { id:'r1', panoramaId:'synthetic-observer', heading:20, pitch:0, answer:{lat:0,lng:0}, difficulty:2000 };
const apps=[];
function sdkClient() {
 const app=firebase.initializeApp({apiKey:'demo-key',projectId:PROJECT,databaseURL:`https://${PROJECT}.firebaseio.com`},`observer_${apps.length}`);apps.push(app);
 const auth=app.auth();auth.useEmulator('http://127.0.0.1:9099',{disableWarnings:true});
 const database=app.database();database.useEmulator('127.0.0.1',9009);return{app,auth,database};
}
async function waitFor(predicate,label) {const end=Date.now()+10000;while(!predicate()){assert.ok(Date.now()<end,label);await pause(10);}}
test('actual SDK observers suppress offline accepted/rejected optimistic deadlines and remain signed out', {timeout:55000},async()=>{
 let env;const stops=[];
 try{
  env=await initializeTestEnvironment({projectId:PROJECT,database:{host:'127.0.0.1',port:9009,rules:fs.readFileSync(path.join(__dirname,'rules.json'),'utf8')}});await env.clearDatabase();
  for(const accepted of [true,false]){
   const eventId=accepted?'observer_accept':'observer_reject';const host=sdkClient();
   await host.auth.createUserWithEmailAndPassword(`observer-${apps.length}-${Date.now()}@example.invalid`,require('node:crypto').randomBytes(18).toString('hex'));
   await env.withSecurityRulesDisabled(c=>set(ref(c.database(),`events/${eventId}`),{hostUid:host.auth.currentUser.uid,private:{round:setup},public:{phase:'guessing',round:{id:'r1',panoramaId:setup.panoramaId,heading:20,pitch:0}}}));
   let rawAcked=false;let queued=false;
   const injected={ref(target){return target===undefined?{update(changes){host.database.goOffline();const raw=host.database.ref().update(changes);raw.then(()=>{rawAcked=true},()=>{rawAcked=true});queued=true;return raw}}:host.database.ref(target)}};
   const service=createRoundClient(injected,{ensureUser:async()=>host.auth.currentUser});const states=[];const errors=[];const target=Date.now()+60000;
   stops.push(service.subscribeTiming(eventId,state=>states.push({...state,rawAcked}),error=>errors.push(error)));
   await waitFor(()=>states.some(s=>s.connected&&s.timing===null),'initial confirmed untimed state');
   const first=service.setDeadline(eventId,target);const result=assert.rejects(first,e=>e.code==='unavailable');
   await waitFor(()=>queued,'offline write queued');await result;
   assert.ok(!states.some(s=>s.connected&&s.timing?.deadlineMs===target),'optimistic value unconfirmed');
   if(!accepted)await env.withSecurityRulesDisabled(c=>update(ref(c.database(),`events/${eventId}/public`),{phase:'closed'}));
   host.database.goOnline();await waitFor(()=>rawAcked,'raw server ACK');
   await waitFor(()=>states.some(s=>s.connected&&s.rawAcked&&(accepted?s.timing?.deadlineMs===target:s.timing===null)),'observer recovers confirmed result');
   assert.ok(!states.some(s=>s.connected&&s.timing?.deadlineMs===target&&!s.rawAcked),'observer never outruns ACK');
   if(!accepted)assert.ok(!states.some(s=>s.connected&&s.timing?.deadlineMs===target),'rejected value never confirmed');
   assert.ok(errors.every(e=>e.code==='unavailable'));
   const presenter=sdkClient();let identityCalls=0;const publicStates=[];
   const reader=createRoundClient(presenter.database,{ensureUser(){identityCalls++;throw Error('No presenter identity')}});
   stops.push(reader.subscribeTiming(eventId,state=>publicStates.push(state)));
   await waitFor(()=>publicStates.some(s=>s.connected),'signed-out public observer');assert.equal(identityCalls,0);assert.equal(presenter.auth.currentUser,null);
  }
 }finally{stops.forEach(stop=>stop());await Promise.all(apps.map(async app=>{await app.auth().signOut();app.database().goOffline();await app.delete()}));if(env)await env.cleanup();}
});
