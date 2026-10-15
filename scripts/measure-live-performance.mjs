// Read-only business probes. Login/logout are limited to this diagnostic session.
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const url='https://script.google.com/macros/s/AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE/exec';
const executablePath=[process.env.BROWSER_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
const report={checkedAt:new Date().toISOString(),authenticated:false,measurements:[]};
let frame,token='';
async function probe(action,payload={}) {
  return frame.evaluate(({action,payload,token})=>new Promise(resolve=>{
    const start=performance.now(),timer=setTimeout(()=>resolve({action,error:'TIMEOUT',totalMs:Math.round(performance.now()-start)}),60000);
    google.script.run.withSuccessHandler(result=>{clearTimeout(timer);resolve({action,totalMs:Math.round(performance.now()-start),serverMs:result?.timing?.serverMs??null,ok:result?.ok===true,error:result?.error?.code,data:result?.data});}).withFailureHandler(()=>{clearTimeout(timer);resolve({action,error:'CONNECTION_ERROR'});}).rpc(action,payload,token);
  }),{action,payload,token});
}
try {
  const page=await browser.newPage(),start=performance.now();
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  for(let i=0;i<120;i++) {
    frame=page.frames().find(f=>f.name()==='userHtmlFrame')||frame;
    for(const candidate of page.frames())if(await candidate.locator('#account-login').count()){frame=candidate;break;}
    if(frame&&await frame.locator('#account-login').isVisible().catch(()=>false))break;
    await page.waitForTimeout(500);
  }
  if(!frame||!await frame.locator('#account-login').count())throw new Error('Login page unavailable');
  report.loginPageMs=Math.round(performance.now()-start);
  for(let i=0;i<3;i++){const {data,...measurement}=await probe('auth.bootstrap');report.measurements.push(measurement);}
  if(process.argv.includes('--login') && !existsSync('data/account-bootstrap-private/credentials.json')) report.authenticatedProbeSkipped='NO_LOCAL_CREDENTIALS';
  if(process.argv.includes('--login') && existsSync('data/account-bootstrap-private/credentials.json')) {
    const credentials=JSON.parse(readFileSync('data/account-bootstrap-private/credentials.json','utf8'));
    const login=await probe('auth.login',{username:credentials.username,password:credentials.adminPassword});
    token=login.data?.sessionToken||'';
    report.login={ok:login.ok,error:login.error,totalMs:login.totalMs,serverMs:login.serverMs};
    if(token&&!login.data.mustChangePassword) {
      report.authenticated=true;
      for(const action of ['auth.bootstrap','dashboard.summary','cases.list','reports.summary']) {
        for(let i=0;i<2;i++) {
          const {data,...measurement}=await probe(action);report.measurements.push(measurement);console.log(JSON.stringify(measurement));
        }
      }
      for(let i=0;i<2;i++) {
        const {data,...measurement}=await probe('cases.list',{submittedFrom:'2026-01-01',submittedTo:'2026-12-31'});
        report.measurements.push({...measurement,filter:'submitted-date'});console.log(JSON.stringify({...measurement,filter:'submitted-date'}));
      }
    } else report.authenticatedProbeSkipped=token?'PASSWORD_CHANGE_REQUIRED':login.error||'LOGIN_FAILED';
  }
} finally {
  if(token&&frame)await probe('auth.logout').catch(()=>{});
  await browser.close();
  mkdirSync('data/preview',{recursive:true});
  const label=process.argv.includes('--before')?'before':'after';
  writeFileSync('data/preview/live-performance-'+label+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
