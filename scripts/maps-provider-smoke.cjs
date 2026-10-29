#!/usr/bin/env node
// Cloud-only, read-only live Google probe. Needs the existing external Playwright
// installation and VUE_APP_API_KEY. Uses a public landmark, not event data.
// Direct Chromium proxy trust currently fails; route.fetch verifies real Google
// TLS using the platform's Node trust. No synthetic provider or TLS bypass.
// The intercepted localhost document does not verify actual hosting or Firebase.
const {chromium}=require('/workspace/.geoguess-tools/node_modules/playwright');
(async()=>{
 if(!process.env.VUE_APP_API_KEY){console.log('Browser key is absent');process.exitCode=1;return;}
 let browser;
 const failures=new Set();const providerErrors=new Set();
 const imageKinds=[];let verifiedImageResponses=0;let verifiedPanoramaTileResponses=0;let imageReadyResolve;const imageReady=new Promise(resolve=>{imageReadyResolve=resolve;});
 try{
 const options={executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
 if(process.env.HTTPS_PROXY)options.proxy={server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'};
 browser=await chromium.launch(options);const page=await browser.newPage();page.on('console',message=>{const match=message.text().match(/Google Maps JavaScript API error:\s*([A-Za-z0-9_]+)/);if(match)providerErrors.add(match[1]);});
 await page.route('http://127.0.0.1:8087/maps-preflight',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="panorama" style="height:500px;width:700px"></div>'}));
 // Route Google requests through Playwright's TLS-verifying request transport.
 // This is real provider data, not a synthetic API; certificate checks stay on.
 await page.route('https://**/*',async r=>{
  const host=new URL(r.request().url()).hostname;
  if(!['maps.googleapis.com','maps.gstatic.com','streetviewpixels-pa.googleapis.com','lh3.googleusercontent.com','fonts.googleapis.com','fonts.gstatic.com'].includes(host)){failures.add(host+':not-allowed');return r.abort();}
  try{const response=await r.fetch({timeout:20000,maxRedirects:0});if(response.ok()&&(response.headers()['content-type']||'').startsWith('image/')){verifiedImageResponses++;if(imageKinds.length<12)imageKinds.push({host,path:new URL(r.request().url()).pathname});if(host==='streetviewpixels-pa.googleapis.com'||/\/(?:tile|cbk|vt)(?:\/|$)/.test(new URL(r.request().url()).pathname)){verifiedPanoramaTileResponses++;imageReadyResolve();}}await r.fulfill({response});}
  catch{failures.add(host+':verified-fetch-failed');await r.abort();}
 });
 await page.goto('http://127.0.0.1:8087/maps-preflight');
 const outcome=await page.evaluate(key=>new Promise(resolve=>{
 let done=false;const finish=value=>{if(!done){done=true;resolve(value)}};
 setTimeout(()=>finish({status:'timeout'}),45000);
 window.__providerAuthFailed=false;window.gm_authFailure=()=>{window.__providerAuthFailed=true;finish({status:'provider-auth-failure'});};
 window.mapsReady=()=>{
  const service=new google.maps.StreetViewService();
  service.getPanorama({location:{lat:48.8584,lng:2.2945},radius:100},(data,status)=>{
   if(status!=='OK'||!data?.location?.pano)return finish({status:'metadata-'+status});
   const view=new google.maps.StreetViewPanorama(document.getElementById('panorama'),{pano:data.location.pano,pov:{heading:0,pitch:0},visible:true});
   google.maps.event.addListener(view,'status_changed',()=>{if(view.getStatus()==='OK')finish({status:'panorama-provider-ok',actualGoogleData:true});else if(view.getStatus())finish({status:'panorama-'+view.getStatus()});});
  });
 };
 const script=document.createElement('script');script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=mapsReady';script.onerror=()=>finish({status:'script-load-failed'});document.head.appendChild(script);
 }),process.env.VUE_APP_API_KEY);
 if(outcome.status==='panorama-provider-ok'){let timer;await Promise.race([imageReady,new Promise(resolve=>{timer=setTimeout(resolve,15000);})]);clearTimeout(timer);}
 const authFailureObserved=await page.evaluate(()=>window.__providerAuthFailed===true);
 await page.screenshot({path:'/tmp/geoguess-real-streetview-preflight.png'});
 console.log(JSON.stringify({outcome,authFailureObserved,providerErrors:[...providerErrors],verifiedImageResponses,verifiedPanoramaTileResponses,imageKinds,failedHosts:[...failures]}));
 if(outcome.status!=='panorama-provider-ok'||authFailureObserved||providerErrors.size||verifiedPanoramaTileResponses===0)process.exitCode=1;
 }catch{console.log('Real provider preflight could not complete; credentials not logged');process.exitCode=1;}
 finally{if(browser)await browser.close();}
})();
