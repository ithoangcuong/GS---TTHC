import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml, safeUrl, remaining, countdown, date, number, reportDateRange} from '../web/ui.js';
import {renderPage} from '../web/pages.js';

function context(path, data, search='sourceSystem=MOC') {
  const params=new URLSearchParams(search);
  return {
    state:{sources:[{id:'MOC',name:'Bộ Xây dựng',enabled:1}],catalogs:{agencies:[],departments:[],officers:[],procedures:[]}},
    route:()=>path.split('/').filter(Boolean),query:()=>new URLSearchParams(params),can:()=>true,
    api:async()=>data,
    link:(target,overrides={})=>{const next=new URLSearchParams(params);for(const [key,value] of Object.entries(overrides)) value == null ? next.delete(key) : next.set(key,String(value));return target+'?'+next;}
  };
}
test('HTML and source links reject untrusted markup and executable URLs',()=>{
  assert.equal(escapeHtml('<script>"&\'</script>'),'&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  assert.equal(safeUrl('javascript:alert(1)'),'');
  assert.equal(safeUrl('data:text/html,test'),'');
  assert.equal(safeUrl('https://motcua.moc.gov.vn/'),'https://motcua.moc.gov.vn/');
});
test('Vietnam timestamps and countdown distinguish missing, completed and overdue',()=>{
  assert.match(date('2026-10-04T17:00:00Z'),/05\/10\/2026/);
  assert.equal(number(null),'—');
  assert.equal(remaining(null),'Chưa có ngày hẹn');
  assert.equal(remaining('2026-10-05T00:00:00Z',Date.parse('2026-10-05T01:04:00Z')),'Quá hạn 1 giờ 4 phút');
  assert.equal(countdown({normalizedStatus:'COMPLETED',dueAt:'2020-01-01T00:00:00Z'}),'Hoàn thành');
  assert.equal(countdown({needsReview:true}),'Cần xác minh hạn trả');
});
test('report periods use Vietnamese calendar dates including UTC boundary and Monday',()=>{
  const now=new Date('2026-10-04T18:00:00Z');
  assert.deepEqual(reportDateRange('day',now),{receivedFrom:'2026-10-05',receivedTo:'2026-10-05'});
  assert.deepEqual(reportDateRange('week',now),{receivedFrom:'2026-10-05',receivedTo:'2026-10-05'});
  assert.deepEqual(reportDateRange('month',now),{receivedFrom:'2026-10-01',receivedTo:'2026-10-05'});
  assert.deepEqual(reportDateRange('quarter',new Date('2026-08-16T00:00:00Z')),{receivedFrom:'2026-07-01',receivedTo:'2026-08-16'});
});
test('dashboard KPI drill downs retain selected source and exact risk / overdue filters',async()=>{
  const html=await renderPage(context('/dashboard',{metrics:{total:12,warning:2,highRisk:3,overdue:4,criticalOverdue:1},bySource:[],byAgency:[],priority:[]}));
  assert.match(html,/sourceSystem=MOC&amp;risk=high/);
  assert.match(html,/sourceSystem=MOC&amp;overdue=true/);
  assert.doesNotMatch(html,/style=|onclick=/);
});
test('case detail escapes API data, keeps official source dates and exposes histories',async()=>{
  const html=await renderPage(context('/cases/id',{case:{id:'id',caseCode:'CASE-01',sourceSystem:'MOC',procedureName:'<img src=x onerror=alert(1)>',normalizedStatus:'PROCESSING',dueAt:'2026-10-08T09:04:34+07:00',riskScore:82,riskReasons:[{message:'Còn hai bước',rule:'REMAINING_STEPS'}],sourceUrl:'javascript:alert(1)'},history:[{type:'DUE_DATE_CHANGED',createdAt:'2026-10-05T10:00:00+07:00',changes:{dueAt:{from:null,to:'2026-10-08T09:04:34+07:00'}}}],alerts:[]}));
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html,/<img|href="javascript:|style=/);
  assert.match(html,/08\/10\/2026/);
  assert.match(html,/DUE_DATE_CHANGED/);
  assert.match(html,/REMAINING_STEPS/);
});
test('source mapping objects and disabled numeric sources render accurately',async()=>{
  const html=await renderPage(context('/sources/MOC',{source:{id:'MOC',name:'Bộ Xây dựng',enabled:0,hostname:'motcua.moc.gov.vn',records:4},fieldMappings:{maHoSo:'caseCode'},statusMappings:{'Đang xử lý':'PROCESSING'},jobs:[]}));
  assert.match(html,/Bật nguồn/);
  assert.match(html,/maHoSo/);
  assert.match(html,/Mã hồ sơ/);
  assert.match(html,/Đang xử lý/);
});
test('group drilldown keeps source identity and filters only unassigned agency rows',async()=>{
  const html=await renderPage(context('/dashboard',{metrics:{total:3},bySource:[{id:'MOC',name:'Ministry',total:3}],byAgency:[{id:null,name:'Unassigned',total:1}],priority:[]}));
  assert.match(html,/href="\/agencies\?sourceSystem=MOC&amp;page=1"/);
  assert.match(html,/href="\/cases\?sourceSystem=MOC&amp;agencyMissing=true&amp;page=1"/);
});
