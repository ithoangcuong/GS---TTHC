import test from 'node:test';
import assert from 'node:assert/strict';
import { gasRuntime } from './helpers/apps-script.mjs';
const changed='SYNTHETIC-personal-password-2026!', next='SYNTHETIC-recovered-password-2026!';
function fixture(){
  const gas=gasRuntime(['Utils','Crypto','Passwords','SheetRepository','Settings','Audit','Permissions','Users','Sources','Auth','Router','Setup'],{WEB_APP_URL:'https://script.google.com/macros/s/SYNTHETIC/exec',RECOVERY_EMAIL_ENABLED:'true'});
  gas.context.setupTthcMonitor_();gas.context.bootstrapAdmin_();
  gas.rpc=(action,payload={},token='')=>gas.plain(gas.app.Router.rpc(action,payload,token));
  const login=gas.rpc('auth.login',{username:'admin',password:gas.properties.get('BOOTSTRAP_PASSWORD')});assert.equal(login.ok,true);
  const updated=gas.rpc('auth.changePassword',{currentPassword:gas.properties.get('BOOTSTRAP_PASSWORD'),newPassword:changed},login.data.sessionToken);assert.equal(updated.ok,true);gas.session=updated.data.sessionToken;
  gas.token=()=>gas.mail.at(-1).body.match(/token=(tthc\.r\.[a-f0-9]{64})/)[1];
  return gas;
}
function verifyEmail(gas){
  assert.equal(gas.rpc('auth.recovery.enroll',{email:'owner@example.test',currentPassword:changed},gas.session).ok,true);
  const token=gas.token();assert.equal(gas.rpc('auth.recovery.verify',{token}).ok,true);return token;
}
test('verified email recovery changes password once, revokes sessions and keeps secrets encrypted',()=>{
  const gas=fixture();
  assert.equal(gas.rpc('auth.recovery.enroll',{email:'attacker@example.test',currentPassword:'wrong'},gas.session).ok,false);assert.equal(gas.mail.length,0);
  const verification=verifyEmail(gas);assert.equal(gas.rpc('auth.recovery.verify',{token:verification}).ok,false);
  const user=gas.app.Repo.read('USERS')[0];
  gas.app.Repo.writeBatch('COLLECTOR_TOKENS',[{token_id:'collector',token_hash:'hash',user_id:user.user_id,status:'ACTIVE'}],'token_hash');
  assert.equal(gas.rpc('auth.recovery.request',{username:'admin',email:'attacker@example.test'}).ok,true);
  assert.equal(gas.mail.at(-1).to,'owner@example.test');
  const token=gas.token(),snapshot=JSON.stringify([...gas.sheets].map(([name,sheet])=>[name,sheet.rows]));
  assert.ok(!snapshot.includes(token));assert.ok(!snapshot.includes('owner@example.test'));
  assert.equal(gas.rpc('auth.recovery.reset',{token,newPassword:next}).ok,true);
  assert.equal(gas.rpc('auth.recovery.reset',{token,newPassword:changed}).ok,false);
  assert.equal(gas.rpc('auth.session',{},gas.session).ok,false);
  assert.equal(gas.app.Repo.read('COLLECTOR_TOKENS')[0].status,'REVOKED');
  assert.equal(gas.rpc('auth.login',{username:'admin',password:changed}).ok,false);
  assert.equal(gas.rpc('auth.login',{username:'admin',password:next}).ok,true);
});
test('unverified and unknown accounts return identical messages and never send recovery mail',()=>{
  const gas=fixture(),a=gas.rpc('auth.recovery.request',{username:'admin'}),b=gas.rpc('auth.recovery.request',{username:'unknown'});
  assert.deepEqual(a.data,b.data);assert.equal(gas.mail.length,0);
  for(let i=0;i<4;i++)gas.rpc('auth.recovery.request',{username:'unknown'});
  assert.equal(gas.rpc('auth.recovery.request',{username:'unknown'}).error.code,'RATE_LIMITED');
  gas.properties.delete('RECOVERY_EMAIL_ENABLED');assert.equal(gas.rpc('auth.recovery.request',{username:'admin'}).error.code,'RECOVERY_UNAVAILABLE');
});
test('expired, replaced and disabled-account reset links cannot change credentials',()=>{
  const gas=fixture();verifyEmail(gas);
  gas.rpc('auth.recovery.request',{username:'admin'});const previous=gas.token();
  gas.rpc('auth.recovery.request',{username:'admin'});const current=gas.token();
  assert.equal(gas.rpc('auth.recovery.reset',{token:previous,newPassword:next}).ok,false);
  const row=gas.app.Repo.read('SETTINGS').find(row=>row.key.startsWith('recovery:reset:'));
  const value=gas.app.Crypto.decrypt(row.value);value.expiresAt=Date.now()-1;
  gas.app.Repo.writeBatch('SETTINGS',[{...row,value:gas.app.Crypto.encrypt(value)}],'key');
  assert.equal(gas.rpc('auth.recovery.reset',{token:current,newPassword:next}).ok,false);
  gas.rpc('auth.recovery.request',{username:'admin'});const disabled=gas.token();
  const user=gas.app.Repo.read('USERS')[0];gas.app.Repo.writeBatch('USERS',[{...user,status:'DISABLED'}],'user_id');
  assert.equal(gas.rpc('auth.recovery.reset',{token:disabled,newPassword:next}).ok,false);
  assert.equal(gas.app.Repo.read('USERS')[0].password_hash,user.password_hash);
});
