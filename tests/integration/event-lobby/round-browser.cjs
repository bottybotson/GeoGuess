#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const PROJECT = 'demo-geoguess-admission';
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
const tools = createRequire('/workspace/.geoguess-emulator-tools/package.json');
const { initializeTestEnvironment } = tools('@firebase/rules-unit-testing');
const { set, get, ref } = tools('firebase/database');
const { chromium } = require('/workspace/.geoguess-tools/node_modules/playwright');
const BASE = 'http://127.0.0.1:8087';
const EVENT = 'browser_round';
const GOOGLE_FIXTURE = `
(() => {
 const fixture = window.__mapsFixture = { panoramas: [], maps: [], guess: {lat: 10,lng: 20} };
 function emit(target,name,value){for(const callback of (target.handlers?.[name] || []))callback(value);}
 class Panorama {
  constructor(element,options){this.options=options;this.handlers={};fixture.panoramas.push(this);element.textContent='Synthetic Street View fixture';setTimeout(()=>{this.status='OK';emit(this,'status_changed')},0);}
  getStatus(){return this.status;} setVisible(value){this.visible=value;}
 }
 class MapView {
  constructor(element,options){this.handlers={};this.options=options;fixture.maps.push(this);element.dataset.mapsFixture='ready';element.addEventListener('click',()=>emit(this,'click',{latLng:{lat:()=>fixture.guess.lat,lng:()=>fixture.guess.lng}}));}
 }
 class Marker {constructor(options){this.map=options.map;this.position=options.position;}setMap(map){this.map=map;}setPosition(position){this.position=position;}}
 window.google={maps:{Map:MapView,Marker,StreetViewPanorama:Panorama,StreetViewStatus:{OK:'OK',ZERO_RESULTS:'ZERO_RESULTS',UNKNOWN_ERROR:'UNKNOWN_ERROR'},event:{addListener(target,name,callback){(target.handlers[name] ||= []).push(callback);return{remove(){target.handlers[name]=target.handlers[name].filter(x=>x!==callback)}}}}}};
})();
`;

test('one untimed routed round with real auth/rules and synthetic Google widgets', {timeout:120000}, async()=>{
 let env,browser;
 try{
  const email=`host-${randomBytes(5).toString('hex')}@example.test`;
  const password=randomBytes(16).toString('hex');
  const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),
  });
  assert.equal(response.ok,true,'Could not provision local host');
  const hostUid=(await response.json()).localId;
  assert.equal(typeof hostUid,'string');
  env=await initializeTestEnvironment({projectId:PROJECT,database:{host:'127.0.0.1',port:9009,rules:fs.readFileSync(path.join(__dirname,'../event-round/rules.json'),'utf8')}});
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(c=>set(ref(c.database(),`events/${EVENT}`),{
   hostUid,private:{round:{id:'r1',panoramaId:'synthetic-public-pano',heading:37,pitch:-4,answer:{lat:10,lng:20},difficulty:2000}},public:{title:'Local one-round smoke',phase:'lobby'},
  }));
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  async function context(){
   const c=await browser.newContext({viewport:{width:390,height:844}});
   await c.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='maps.googleapis.com'&&url.pathname==='/maps/api/js'){
     const callback=url.searchParams.get('callback')||'vueGoogleMapsInit';
     return route.fulfill({contentType:'application/javascript',body:GOOGLE_FIXTURE+`\nwindow[${JSON.stringify(callback)}]();`});
    }
    return url.hostname==='127.0.0.1'&&['8087','9009','9099'].includes(url.port)?route.continue():route.abort();
   });
   await c.addInitScript(()=>{
    const Native=window.WebSocket;
    window.WebSocket=class extends Native{constructor(url,...args){const u=new URL(url,location.href);if(u.hostname!=='127.0.0.1'||!['8087','9009','9099'].includes(u.port))throw new Error('Nonlocal socket blocked');super(url,...args);}};
   });
   return c;
  }
  const shared=await context();
  const second=await context();
  const audience=await context();
  let audienceSignups=0;
  audience.on('request',r=>{if(r.url().includes('accounts:signUp'))audienceSignups++;});
  const presenter=await audience.newPage();
  await presenter.goto(`${BASE}/event/${EVENT}/present?adminToken=not-for-join-link`,{waitUntil:'domcontentloaded'});
  await presenter.getByRole('heading',{name:'Local one-round smoke',exact:true}).waitFor({timeout:30000});
  const a=await shared.newPage();const b=await second.newPage();const host=await shared.newPage();
  for(const[page,nickname]of[[a,'Alex'],[b,'Taylor']]){
   await page.goto(`${BASE}/event/${EVENT}/join`,{waitUntil:'domcontentloaded'});
   await page.getByLabel('Nickname',{exact:true}).waitFor({timeout:30000});
   await page.waitForFunction(()=>!document.querySelector('input[name="nickname"]').disabled);
   await page.getByLabel('Nickname',{exact:true}).fill(nickname);
   await page.getByLabel('Nickname',{exact:true}).press('Enter');
   await page.getByRole('status').filter({hasText:'You’re in the lobby'}).waitFor({timeout:30000});
  }
  await host.goto(`${BASE}/event/${EVENT}/host`,{waitUntil:'domcontentloaded'});
  await host.getByLabel('Host email',{exact:true}).fill(email);
  await host.getByLabel('Password',{exact:true}).fill(password);
  await host.getByRole('button',{name:'Sign in',exact:true}).click();
  await host.getByRole('button',{name:'Start game',exact:true}).waitFor({timeout:30000});
  await host.getByRole('button',{name:'Start game',exact:true}).click();
  for(const[page,guess]of[[a,{lat:10,lng:20}],[b,{lat:11,lng:21}]]){
   await page.locator('[data-maps-fixture="ready"]').waitFor({timeout:30000});
   await page.evaluate(value=>{window.__mapsFixture.guess=value},guess);
   await page.locator('.event-guess-map').click({position:{x:40,y:40}});
   await page.getByRole('button',{name:'Submit my guess',exact:true}).click();
   await page.getByRole('status').filter({hasText:'Your guess is saved.'}).waitFor({timeout:30000});
   assert.equal(await page.evaluate(()=>window.__mapsFixture.panoramas[0].options.pano),'synthetic-public-pano');
   assert.deepEqual(await page.evaluate(()=>window.__mapsFixture.panoramas[0].options.pov),{heading:37,pitch:-4});
  }
  await a.reload({waitUntil:'domcontentloaded'});
  await a.getByRole('status').filter({hasText:'Your guess is saved.'}).waitFor({timeout:30000});
  assert.equal(await a.getByRole('button',{name:'Submit my guess',exact:true}).isDisabled(),true);
  await host.getByRole('button',{name:'Close guessing',exact:true}).click();
  await host.getByRole('button',{name:'Reveal results',exact:true}).click();
  for(const page of[a,b,host,presenter])await page.getByRole('heading',{name:'Round results',exact:true}).waitFor({timeout:30000});
  let stored;
  await env.withSecurityRulesDisabled(async c=>{stored=(await get(ref(c.database(),`events/${EVENT}`))).val();});
  assert.equal(stored.public.phase,'reveal');
  assert.equal(Object.keys(stored.public.participants).length,2);
  assert.equal(Object.hasOwn(stored.public.participants,hostUid),false);
  const results=Object.values(stored.public.reveal.results).sort((x,y)=>x.nickname.localeCompare(y.nickname));
  assert.equal(results[0].nickname,'Alex');assert.equal(results[0].points,5000);assert.equal(results[0].distance,0);
  assert.equal(results[1].nickname,'Taylor');assert.ok(results[1].distance>0);assert.ok(results[1].points<5000);
  assert.equal(audienceSignups,0,'Public reveal must not create an anonymous presenter');
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }finally{if(browser)await browser.close();if(env)await env.cleanup();}
});
