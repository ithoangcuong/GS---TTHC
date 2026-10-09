import {e, number, date, countdown, badge, portalLink, option, field, empty, table, pagination, toast, downloadCsv, reportDateRange, icon, safeUrl, STATUS_LABELS, ALERT_LABELS, ROLE_LABELS, FIELD_LABELS} from './ui.js';

let importState = freshImport();
let currentResult = null;
function freshImport() { return {step:0,fileName:'',base64:'',preview:null,sourceSystem:'',mapping:{},validation:null,result:null}; }
function sourceId(source) { return source.id || source.sourceSystem || source.sourceId; }
function enabled(source) { return source.enabled !== false && source.enabled !== 0; }
function entityName(row, type = '') { return row.name || row.displayName || row[`${type}Name`] || row.procedureName || row.id; }
function list(value) { return Array.isArray(value) ? value : []; }
function heading(title, description, actions = '', eyebrow = 'GIÁM SÁT TẬP TRUNG') {
  return `<div class="page-heading"><div><div class="eyebrow">${e(eyebrow)}</div><h1>${e(title)}</h1><p>${e(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}
function panel(title, subtitle, body, actions = '') {
  return `<section class="panel"><div class="panel-heading"><div><h2>${e(title)}</h2>${subtitle ? `<p>${e(subtitle)}</p>` : ''}</div>${actions}</div>${body}</section>`;
}
function qs(ctx, omit = []) {
  const params = ctx.query(); for (const key of omit) params.delete(key); return params.size ? '?' + params.toString() : '';
}
function sourceOptions(ctx, selected) {
  return option('','Tất cả nguồn',selected) + ctx.state.sources.map(source=>option(sourceId(source),source.name || sourceId(source),selected)).join('');
}
function catalogOptions(ctx, catalog, selected, label = 'Tất cả') {
  const singular = {agencies:'agency',departments:'department',officers:'officer',procedures:'procedure'}[catalog];
  return option('',label,selected) + list(ctx.state.catalogs[catalog]).map(row=>option(catalog === 'procedures' ? row.code || row.procedureCode || row.id : row.id,entityName(row,singular),selected)).join('');
}
function filters(ctx, {advanced = false, dates = false, reports = false} = {}) {
  const params = ctx.query();
  return `<form class="filters" id="filters-form">
    ${field('Nguồn dữ liệu',`<select name="sourceSystem">${sourceOptions(ctx,params.get('sourceSystem'))}</select>`)}
    ${field('Cơ quan',`<select name="agencyId">${catalogOptions(ctx,'agencies',params.get('agencyId'),'Tất cả cơ quan')}</select>`)}
    ${advanced ? `<label class="field search-field"><span>Tìm kiếm hồ sơ</span><input name="q" type="search" placeholder="Mã hồ sơ, thủ tục, người nộp…" value="${e(params.get('q'))}" autocomplete="off"></label>` : field('Cán bộ',`<select name="officerId">${catalogOptions(ctx,'officers',params.get('officerId'),'Tất cả cán bộ')}</select>`)}
    <button class="button secondary" type="submit">${icon('search')}Áp dụng</button><button class="button ghost" type="button" id="reset-filters">Đặt lại</button>
    ${advanced ? `<div class="advanced-filters">
      ${field('Phòng / đơn vị',`<select name="departmentId">${catalogOptions(ctx,'departments',params.get('departmentId'),'Tất cả phòng')}</select>`)}
      ${field('Cán bộ',`<select name="officerId">${catalogOptions(ctx,'officers',params.get('officerId'),'Tất cả cán bộ')}</select>`)}
      ${field('Thủ tục',`<select name="procedureCode">${catalogOptions(ctx,'procedures',params.get('procedureCode'),'Tất cả thủ tục')}</select>`)}
      ${field('Trạng thái',`<select name="normalizedStatus">${option('','Tất cả trạng thái',params.get('normalizedStatus'))}${Object.entries(STATUS_LABELS).map(([key,label])=>option(key,label,params.get('normalizedStatus'))).join('')}</select>`)}
      ${field('Mức cảnh báo',`<select name="alertLevel">${option('','Tất cả mức',params.get('alertLevel'))}${Object.entries(ALERT_LABELS).filter(([key])=>key !== 'REVIEW').map(([key,label])=>option(key,label,params.get('alertLevel'))).join('')}</select>`)}
      ${field('Nguy cơ',`<select name="risk">${option('','Tất cả',params.get('risk'))}${option('high','Nguy cơ cao',params.get('risk'))}</select>`)}
      ${field('Sắp xếp',`<select name="sort">${[['priority','Ưu tiên xử lý'],['dueAt','Ngày hẹn trả'],['riskScore','Điểm nguy cơ'],['receivedAt','Ngày tiếp nhận'],['updatedAt','Cập nhật gần nhất']].map(([key,label])=>option(key,label,params.get('sort') || 'priority')).join('')}</select>`)}
      ${field('Thứ tự',`<select name="order">${option('asc','Tăng dần',params.get('order') || 'asc')}${option('desc','Giảm dần',params.get('order'))}</select>`)}
      ${field('Kích thước trang',`<select name="pageSize">${[25,50,100].map(value=>option(value,`${value} hồ sơ`,params.get('pageSize') || 25)).join('')}</select>`)}
    </div>` : ''}
    ${dates || reports ? `<div class="advanced-filters">
      ${field('Tiếp nhận từ',`<input name="receivedFrom" type="date" value="${e(params.get('receivedFrom'))}">`)}
      ${field('Tiếp nhận đến',`<input name="receivedTo" type="date" value="${e(params.get('receivedTo'))}">`)}
      ${field('Hẹn trả từ',`<input name="dueFrom" type="date" value="${e(params.get('dueFrom'))}">`)}
      ${field('Hẹn trả đến',`<input name="dueTo" type="date" value="${e(params.get('dueTo'))}">`)}
      ${reports ? field('Kỳ báo cáo',`<select id="report-period" aria-label="Chọn kỳ báo cáo"><option value="">Tùy chọn</option><option value="day">Hôm nay</option><option value="week">Tuần này</option><option value="month">Tháng này</option><option value="quarter">Quý này</option></select>`) : ''}
    </div>` : ''}
  </form>`;
}
function risk(record) {
  const score = Number(record.riskScore);
  if (!Number.isFinite(score)) return '<span class="muted">—</span>';
  return `<span class="risk-value">${number(score)}<span class="risk-track" aria-hidden="true"><span class="risk-fill percent-${Math.round(Math.max(0,Math.min(100,score)))}"></span></span></span>`;
}
function caseTable(ctx, items, compact = false) {
  if (!items.length) return empty('Không có hồ sơ phù hợp','Hãy điều chỉnh bộ lọc hoặc đồng bộ dữ liệu từ nguồn được cấp quyền.');
  const rows = items.map(record => `<tr>
    <td><a class="cell-primary text-link" href="${e(ctx.link(`/cases/${encodeURIComponent(record.id)}`))}" data-nav>${e(record.caseCode)}</a><span class="cell-secondary"><span class="source-pill">${e(record.sourceSystem)}</span></span></td>
    <td><span class="cell-title cell-primary" title="${e(record.procedureName)}">${e(record.procedureName || record.procedureCode || 'Chưa có thủ tục')}</span><span class="cell-secondary">${e(record.agencyName || 'Chưa có cơ quan')}</span></td>
    ${compact ? '' : `<td>${e(record.applicantName || '—')}</td><td>${e(record.departmentName || '—')}<span class="cell-secondary">${e(record.officerName || 'Chưa có cán bộ')}</span></td><td>${e(date(record.receivedAt,false))}</td>`}
    <td>${e(date(record.effectiveDueAt || record.extensionDueAt || record.dueAt || record.originalDueAt,false))}<span class="cell-secondary">${countdown(record)}</span></td>
    ${compact ? '' : `<td>${badge(record.normalizedStatus)}</td>`}
    <td>${badge(record.alertLevel)}</td><td>${risk(record)}</td></tr>`);
  return table(compact ? ['Mã hồ sơ / nguồn','Thủ tục / cơ quan','Ngày hẹn trả','Cảnh báo','Nguy cơ'] : ['Mã hồ sơ / nguồn','Thủ tục / cơ quan','Người nộp','Phòng / cán bộ','Tiếp nhận','Ngày hẹn trả','Trạng thái','Cảnh báo','Nguy cơ'],rows);
}
function groupTable(ctx, items, type) {
  if (!items.length) return empty('Chưa có số liệu tổng hợp','Số liệu được tính từ hồ sơ trong phạm vi quyền và bộ lọc hiện tại.');
  const config = {
    source:{label:'Nguồn dữ liệu',field:'sourceSystem',next:'/agencies'},
    agency:{label:'Cơ quan',field:'agencyId',next:'/departments'},
    department:{label:'Phòng / đơn vị',field:'departmentId',next:'/officers'},
    officer:{label:'Cán bộ',field:'officerId',next:'/cases'},
    procedure:{label:'Thủ tục',field:'procedureCode',next:'/cases'}
  }[type];
  const groupScope = row => {
    const id = row.id || row.code;
    const missing = { agencyId: 'agencyMissing', departmentId: 'departmentMissing', officerId: 'officerMissing', procedureCode: 'procedureMissing' }[config.field];
    return { [config.field]: id || null, ...(missing ? { [missing]: id ? null : 'true' } : {}), page: 1 };
  };
  const rows = items.map(row=>`<tr><td><a class="text-link" href="${e(ctx.link(config.next,groupScope(row)))}" data-nav>${e(row.name || row.id)}</a></td><td>${number(row.total)}</td><td>${number(row.active)}</td><td>${number(row.warning)}</td><td>${number(row.highRisk)}</td><td class="text-overdue">${number(row.overdue)}</td><td class="text-critical">${number(row.criticalOverdue)}</td><td>${row.onTimeRate == null ? '—' : `${number(row.onTimeRate)}%`}</td><td><a href="${e(ctx.link('/cases',groupScope(row)))}" class="text-link" data-nav>Hồ sơ →</a></td></tr>`);
  return table([config.label,'Tổng số','Đang xử lý','Sắp hạn','Nguy cơ cao','Trễ hạn','Trễ nghiêm trọng','Tỷ lệ đúng hạn','Chi tiết'],rows);
}
function metrics(ctx, values, report = false) {
  const definitions = report ? [
    ['total','Tổng hồ sơ',{},'dashboard','', 'Theo bộ lọc hiện tại'],['completed','Đã hoàn thành',{normalizedStatus:'COMPLETED'},'cases','','Bao gồm đúng hạn và trễ hạn'],
    ['onTime','Hoàn thành đúng hạn',{normalizedStatus:'COMPLETED',completionTiming:'onTime'},'shield','','Theo ngày hẹn trả chính thức'],['completedLate','Hoàn thành trễ hạn',{normalizedStatus:'COMPLETED',completionTiming:'late'},'alerts','overdue','Theo ngày hoàn thành tại nguồn']
  ] : [
    ['total','Tổng hồ sơ',{},'cases','','Trong phạm vi đang theo dõi'],['warning','Sắp đến hạn',{alertLevel:'WARNING'},'bell','warning','Theo ngưỡng cảnh báo cấu hình'],
    ['highRisk','Nguy cơ trễ',{risk:'high'},'alerts','high_risk','Các hồ sơ cần ưu tiên xử lý'],['overdue','Đã trễ hạn',{overdue:'true'},'alerts','overdue','Bao gồm trễ nghiêm trọng']
  ];
  return `<div class="metrics">${definitions.map(([key,label,params,symbol,color,note])=>`<a class="metric ${color}" href="${e(ctx.link('/cases',{alertLevel:null,risk:null,normalizedStatus:null,overdue:null,completionTiming:null,needsReview:null,bucket:null,...params,page:1}))}" data-nav><div class="metric-label">${label}</div><div class="metric-symbol">${icon(symbol)}</div><div class="metric-value">${number(values[key] ?? 0)}</div><div class="metric-note">${note} ↗</div></a>`).join('')}</div>`;
}
async function dashboard(ctx) {
  const data = await ctx.api('/dashboard'+qs(ctx,['page','pageSize'])); const m = data.metrics || {};
  const definitions = [['safe','An toàn','safe-color'],['watch','Theo dõi','watch-color'],['warning','Sắp đến hạn','warning-color'],['highRisk','Nguy cơ cao','risk-color'],['overdue','Trễ hạn','overdue-color'],['criticalOverdue','Trễ nghiêm trọng','critical-color']];
  const counts={...m,overdue:Math.max(0,Number(m.overdue || 0)-Number(m.criticalOverdue || 0))};
  const distributionTotal = definitions.reduce((sum,[key])=>sum+Number(counts[key] || 0),0);
  const distribution = distributionTotal ? `<div class="distribution" role="img" aria-label="Phân bố cảnh báo">${definitions.filter(([key])=>counts[key]).map(([key,,color])=>`<span class="${color} proportion-${Math.max(1,Math.round(100*Number(counts[key])/distributionTotal))}"></span>`).join('')}</div>` : '';
  return heading('Tổng quan điều hành','Theo dõi tiến độ, nhận diện rủi ro và ưu tiên hồ sơ cần xử lý.',`<a class="button secondary" href="${e(ctx.link('/reports'))}" data-nav>${icon('reports')}Báo cáo</a><button class="button" data-refresh>${icon('sync')}Làm mới</button>`)
    + filters(ctx) + metrics(ctx,m)
    + `<div class="dashboard-grid">${panel('Giám sát theo nguồn','Chọn nguồn để xem cơ quan → phòng → cán bộ.',groupTable(ctx,list(data.bySource),'source'),`<a class="text-link" href="${e(ctx.link('/sources'))}" data-nav>Tất cả nguồn →</a>`)}
    ${panel('Phân bố cảnh báo','Kết quả từ bộ quy tắc đang áp dụng.',`<div class="panel-body">${distribution}<div class="legend">${definitions.map(([key,label,color])=>`<div class="legend-row"><span><i class="dot ${color}" aria-hidden="true"></i>${label}</span><strong>${number(counts[key] || 0)}</strong></div>`).join('')}</div><a class="notice mt-20 mb-0" href="${e(ctx.link('/cases',{needsReview:'true',alertLevel:null,risk:null,overdue:null,page:1}))}" data-nav>${number(m.needsReview || 0)} hồ sơ cần xác minh thông tin hạn trả →</a></div>`)}</div>`
    + panel('Hồ sơ cần ưu tiên hôm nay','Ưu tiên theo mức cảnh báo, ngày hẹn trả và điểm nguy cơ.',caseTable(ctx,list(data.priority),true),`<a class="text-link" href="${e(ctx.link('/cases',{sort:'priority',page:1}))}" data-nav>Xem danh sách →</a>`)
    + panel('Theo cơ quan','Đang xử lý và cảnh báo theo cơ quan.',groupTable(ctx,list(data.byAgency),'agency'));
}
async function cases(ctx) {
  const data = await ctx.api('/cases'+qs(ctx)); currentResult=data;
  const exportParams=ctx.query(); exportParams.set('format','csv');
  return heading('Danh sách hồ sơ','Dữ liệu hồ sơ tập trung, có truy xuất nguồn và lịch sử thay đổi.',`<a class="button secondary" href="${e('/api/reports/export?'+exportParams)}" data-export>${icon('reports')}Xuất dữ liệu</a>`)
    + filters(ctx,{advanced:true,dates:true}) + panel(`${number(data.total)} hồ sơ`,'Tìm kiếm, lọc và phân trang tại máy chủ.',caseTable(ctx,list(data.items))+pagination(data));
}
function detailItem(label,value,wide=false,html=false) { return `<div${wide ? ' class="wide"' : ''}><dt>${e(label)}</dt><dd>${html ? value : e(value || '—')}</dd></div>`; }
function reasonText(reason) { return typeof reason === 'string' ? reason : reason.message || reason.reason || reason.description || JSON.stringify(reason); }
async function caseDetail(ctx,id) {
  const data = await ctx.api('/cases/'+encodeURIComponent(id)); const record=data.case;
  const histories = Array.isArray(data.history) ? data.history : Object.values(data.history || {}).flat();
  histories.sort((a,b)=>new Date(b.createdAt || b.changedAt || b.syncedAt || 0)-new Date(a.createdAt || a.changedAt || a.syncedAt || 0));
  return heading(record.caseCode || 'Chi tiết hồ sơ',`${record.sourceName || record.sourceSystem} · ${STATUS_LABELS[record.normalizedStatus] || record.normalizedStatus}`,`<a class="button secondary" href="${e(ctx.link('/cases'))}" data-nav>← Danh sách</a>${portalLink(record.sourceUrl)}`)
    + `<div class="detail-grid"><div>${panel('Thông tin hồ sơ','Thời gian được hiển thị theo múi giờ Việt Nam.',`<div class="panel-body"><dl class="detail-list">
      ${detailItem('Nguồn dữ liệu',`${record.sourceName || ''} (${record.sourceSystem})`)}${detailItem('Mã bản ghi nguồn',record.sourceRecordId || record.sourceCaseId)}
      ${detailItem('Thủ tục',record.procedureName,true)}${detailItem('Mã thủ tục',record.procedureCode)}${detailItem('Người nộp',record.applicantName)}
      ${detailItem('Ngày nộp',date(record.submittedAt))}${detailItem('Ngày tiếp nhận',date(record.receivedAt))}
      ${detailItem('Ngày hẹn ban đầu',date(record.originalDueAt))}${detailItem('Ngày hẹn tại nguồn',date(record.dueAt))}
      ${detailItem('Ngày gia hạn',date(record.extensionDueAt))}${detailItem('Hạn trả hiệu lực',date(record.effectiveDueAt || record.extensionDueAt || record.dueAt || record.originalDueAt))}
      ${detailItem('Ngày hoàn thành',date(record.completedAt))}${detailItem('Thời gian còn lại',countdown(record),false,true)}
      ${detailItem('Cơ quan',record.agencyName)}${detailItem('Phòng / đơn vị',record.departmentName)}${detailItem('Cán bộ xử lý',record.officerName)}${detailItem('Trạng thái nguồn',record.sourceStatus)}
      ${detailItem('Trạng thái chuẩn',badge(record.normalizedStatus),false,true)}${detailItem('Bước xử lý',record.currentStep == null ? 'Chưa có dữ liệu' : `${record.currentStep}${record.totalSteps ? ` / ${record.totalSteps}` : ''}`)}
      ${detailItem('Nguồn cập nhật',date(record.lastSourceUpdateAt))}${detailItem('Đồng bộ gần nhất',date(record.lastSyncedAt))}
    </dl></div>`)}
    ${panel('Lịch sử thay đổi','Các sự kiện thực tế được ghi nhận khi đồng bộ.',histories.length ? `<div class="panel-body"><ol class="timeline">${histories.map(history=>`<li><strong>${e(history.type || history.event || 'Đồng bộ hồ sơ')}</strong><p>${e(date(history.createdAt || history.changedAt || history.syncedAt))}</p>${history.changes ? `<pre class="json-view">${e(JSON.stringify(history.changes,null,2))}</pre>` : history.description ? `<p>${e(history.description)}</p>` : ''}${history.before || history.after ? `<pre class="json-view">${e(JSON.stringify({trước:history.before,sau:history.after},null,2))}</pre>` : ''}</li>`).join('')}</ol></div>` : empty('Chưa có lịch sử','Các thay đổi trạng thái, hạn trả và phân công sẽ được ghi nhận khi dữ liệu thay đổi.'))}</div>
    <div>${panel('Cảnh báo & nguy cơ','Kết quả quy tắc có thể truy vết.',`<div class="panel-body">${badge(record.alertLevel)}<div class="score-large">${number(record.riskScore)}<small> / 100</small></div><h3>Lý do nguy cơ</h3>${list(record.riskReasons).length ? `<ul class="reason-list">${record.riskReasons.map(reason=>`<li>${e(reasonText(reason))}${reason.rule || reason.code ? `<span class="cell-secondary">Quy tắc: ${e(reason.rule || reason.code)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Chưa có lý do nguy cơ được ghi nhận.</p>'}${record.needsReview ? '<div class="notice warning">Thông tin nghiệp vụ cần xác minh trước khi kết luận trễ hạn.</div>' : ''}</div>`)}
    ${panel('Cảnh báo liên quan','Thông tin cảnh báo và xác nhận đã tiếp nhận.',list(data.alerts).length ? `<div class="panel-body">${data.alerts.map(alert=>`<div class="mb-20">${badge(alert.level)}<p class="alert-message">${e(alert.message)}</p><p class="cell-secondary">${e(typeof alert.reason === 'object' ? JSON.stringify(alert.reason) : alert.reason || '')}</p><small>${e(alert.status)} · ${e(date(alert.lastDetectedAt || alert.createdAt,false))}</small>${alert.acknowledgedAt ? `<p class="cell-secondary">Đã tiếp nhận: ${e(date(alert.acknowledgedAt))}</p>` : ctx.can('write') && alert.status !== 'RESOLVED' ? `<div><button class="button secondary small" data-ack="${e(alert.id)}">Xác nhận đã tiếp nhận</button></div>` : ''}</div>`).join('')}</div>` : empty('Chưa có cảnh báo','Cảnh báo xuất hiện khi hồ sơ đáp ứng quy tắc.'))}
    ${record.metadata && Object.keys(record.metadata).length ? panel('Dữ liệu bổ sung','Trường đặc thù do nguồn cung cấp.',`<div class="panel-body"><pre class="json-view">${e(JSON.stringify(record.metadata,null,2))}</pre></div>`) : ''}</div></div>`;
}
async function alerts(ctx) {
  const data = await ctx.api('/alerts'+qs(ctx));
  const rows = list(data.items).map(alert=>`<tr><td>${badge(alert.level)}</td><td><a href="${e(ctx.link('/cases/'+encodeURIComponent(alert.caseId)))}" data-nav class="text-link">${e(alert.caseCode || alert.caseId)}</a><span class="cell-secondary">${e(alert.sourceSystem)}</span></td><td class="wrap">${e(alert.message)}<span class="cell-secondary">${e(typeof alert.reason === 'object' ? JSON.stringify(alert.reason) : alert.reason || '')}</span></td><td>${e(date(alert.lastDetectedAt || alert.createdAt,false))}</td><td>${e(alert.status)}${alert.acknowledgedAt ? `<span class="cell-secondary">${e(date(alert.acknowledgedAt,false))}</span>` : ''}</td><td>${!alert.acknowledgedAt && ctx.can('write') ? `<button class="button secondary small" data-ack="${e(alert.id)}">Tiếp nhận</button>` : '—'}</td></tr>`);
  return heading('Cảnh báo cần xử lý','Ưu tiên hồ sơ trễ nghiêm trọng, trễ hạn và có nguy cơ cao.') + filters(ctx,{advanced:true})
    + panel(`${number(data.total)} cảnh báo`,'Xác nhận tiếp nhận không thay đổi kết luận hạn trả của hồ sơ.',rows.length ? table(['Mức độ','Hồ sơ / nguồn','Nội dung & lý do','Phát hiện gần nhất','Trạng thái','Tiếp nhận'],rows)+pagination(data) : empty('Không có cảnh báo phù hợp','Các cảnh báo sẽ xuất hiện tự động khi dữ liệu đáp ứng quy tắc đã cấu hình.'));
}
async function sources(ctx) {
  const data = await ctx.api('/sources'); ctx.state.sources=list(data.items);
  const cards = data.items.map(source=>{
    const id = sourceId(source), last=source.lastSync || source.lastJob || {};
    return `<article class="source-card"><div class="source-card-header"><span class="source-pill">${e(id)}</span>${badge(!enabled(source) ? 'DISABLED' : source.status || 'READY',!enabled(source) ? 'Đã tắt' : undefined)}</div><h2><a href="${e(ctx.link('/sources/'+encodeURIComponent(id)))}" data-nav>${e(source.name)}</a></h2><div class="domain">${e(source.hostname || source.domain)}</div><div class="source-stats"><div><strong>${number(source.records ?? source.caseCount ?? source.totalCases ?? 0)}</strong>Hồ sơ giám sát</div><div><strong>${number(last.recordsFailed ?? source.recordsFailed ?? 0)}</strong>Lỗi lần gần nhất</div></div><span class="cell-secondary">Đồng bộ: ${e(date(source.lastSyncedAt || source.lastSyncAt || last.completedAt,false))}</span>${source.lastError ? `<p class="error-inline">${e(source.lastError)}</p>` : ''}<div class="source-card-footer"><a class="text-link" href="${e(ctx.link('/sources/'+encodeURIComponent(id)))}" data-nav>Chi tiết →</a>${portalLink(source.url || source.baseUrl || `https://${source.hostname || source.domain}/`,'Mở hệ thống ↗')}</div></article>`;
  });
  return heading('Nguồn dữ liệu','Quản lý kết nối, ánh xạ và tình trạng đồng bộ của các cổng Bộ, ngành.',ctx.can('write') ? '<button class="button secondary" id="create-collector-token">'+icon('shield')+'Cấp mã kết nối Collector</button>' : '')
    + '<div id="collector-token-output"></div>'
    + '<div class="notice">Người sử dụng tự đăng nhập hợp lệ vào cổng nguồn. Chỉ dữ liệu hồ sơ được phép xem được gửi về hệ thống trung tâm.</div>'
    + (cards.length ? `<div class="source-grid">${cards.join('')}</div>` : empty('Chưa có nguồn','Quản trị viên cần đăng ký nguồn dữ liệu trước khi đồng bộ.'));
}
async function sourceDetail(ctx,id) {
  const data = await ctx.api('/sources/'+encodeURIComponent(id)); const source=data.source, last=source.lastSync || {};
  const mappings=Array.isArray(data.fieldMappings) ? data.fieldMappings : Object.entries(data.fieldMappings || {}).map(([sourceField,value])=>({sourceField,...(typeof value === 'string' ? {canonicalField:value} : value)}));
  const statuses=Array.isArray(data.statusMappings) ? data.statusMappings : Object.entries(data.statusMappings || {}).map(([sourceStatus,normalizedStatus])=>({sourceStatus,normalizedStatus}));
  const jobs=list(data.jobs);
  return heading(source.name,`${sourceId(source)} · ${source.hostname || source.domain}`,`<a class="button secondary" href="${e(ctx.link('/sources'))}" data-nav>← Nguồn dữ liệu</a>${portalLink(source.url || source.baseUrl || `https://${source.hostname || source.domain}/`)}${ctx.can('manage') ? `<button class="button secondary" data-toggle-source="${e(id)}" data-enabled="${enabled(source)}">${enabled(source) ? 'Tắt nguồn' : 'Bật nguồn'}</button>` : ''}`)
    + `<div class="detail-grid"><div>${panel('Tình trạng nguồn','Thông tin vận hành gần nhất.',`<div class="panel-body"><dl class="detail-list">${detailItem('Trạng thái',badge(!enabled(source) ? 'DISABLED' : source.status),false,true)}${detailItem('Phiên bản Adapter',source.adapterVersion || source.adapter?.version || 'Chưa có thông tin')}${detailItem('Đồng bộ gần nhất',date(source.lastSyncedAt || source.lastSyncAt))}${detailItem('Hồ sơ giám sát',number(source.records ?? source.caseCount ?? source.totalCases))}${detailItem('Tạo mới lần gần nhất',number(last.recordsCreated))}${detailItem('Cập nhật lần gần nhất',number(last.recordsUpdated))}${detailItem('Lỗi gần nhất',source.lastError,true)}${detailItem('Khả năng thu thập',source.adapterStatus || source.integrationStatus || 'Cần cấu hình dữ liệu nguồn thực tế',true)}</dl></div>`)}
    ${panel('Ánh xạ trường','Cấu hình tách biệt với bộ xử lý dữ liệu trung tâm.',mappings.length ? table(['Trường nguồn','Trường chuẩn','Biến đổi','Bắt buộc','Hoạt động'],mappings.map(mapping=>`<tr><td>${e(mapping.sourceField)}</td><td>${e(FIELD_LABELS[mapping.canonicalField] || mapping.canonicalField)}</td><td>${e(mapping.transform || '—')}</td><td>${mapping.required ? 'Có' : 'Không'}</td><td>${mapping.enabled === false ? 'Tắt' : 'Bật'}</td></tr>`)) : empty('Chưa có ánh xạ','Cần mẫu HTML hoặc JSON thực tế để cấu hình ánh xạ an toàn.'))}
    ${panel('Lịch sử đồng bộ','Kết quả từng lượt đồng bộ của nguồn.',jobTable(jobs))}</div><div>
    ${panel('Ánh xạ trạng thái','Trạng thái chuẩn được sử dụng trong các bộ quy tắc.',statuses.length ? table(['Trạng thái nguồn','Trạng thái chuẩn'],statuses.map(mapping=>`<tr><td>${e(mapping.sourceStatus)}</td><td>${badge(mapping.normalizedStatus)}</td></tr>`)) : empty('Chưa có ánh xạ','Trạng thái chưa có ánh xạ sẽ cần xác minh.'))}
    <div class="notice warning">Adapter chỉ được xác nhận hoạt động sau khi kiểm thử với dữ liệu và phiên truy cập hợp lệ trên cổng thực tế.</div></div></div>`;
}
async function groups(ctx,type) {
  const data = await ctx.api('/dashboard'+qs(ctx,['page','pageSize']));
  const config = {agencies:['Cơ quan','agency','byAgency'],departments:['Phòng / đơn vị','department','byDepartment'],officers:['Cán bộ','officer','byOfficer'],procedures:['Thủ tục','procedure','byProcedure']}[type];
  let items=list(data[config[2]]);
  if (type === 'procedures' && !data.byProcedure) {
    // Catalog entries link to server-filtered cases; totals are not inferred client-side.
    items=list(ctx.state.catalogs.procedures).map(item=>({id:item.code || item.procedureCode || item.id,name:entityName(item,'procedure'),total:null,active:null,warning:null,highRisk:null,overdue:null,criticalOverdue:null,onTimeRate:null}));
  }
  const sort=ctx.query().get('groupSort') || 'overdue';
  items=[...items].sort((a,b)=>Number(b[sort] || 0)-Number(a[sort] || 0));
  return heading(`Giám sát theo ${config[0].toLowerCase()}`,'Chọn một dòng để xem cấp quản lý tiếp theo và hồ sơ liên quan.') + filters(ctx)
    + panel(config[0],'Số liệu theo bộ lọc và phạm vi quyền được cấp.',groupTable(ctx,items,config[1]),`<label class="checkbox-label">Sắp xếp <select class="standalone-input" id="group-sort">${[['overdue','Trễ hạn'],['highRisk','Nguy cơ cao'],['total','Tổng hồ sơ'],['onTimeRate','Tỷ lệ đúng hạn']].map(([key,label])=>option(key,label,sort)).join('')}</select></label>`);
}
function jobTable(jobs) {
  return jobs.length ? table(['Nguồn','Bắt đầu','Kết thúc','Trạng thái','Đọc','Tạo mới','Cập nhật','Bỏ qua','Lỗi'],jobs.map(job=>`<tr><td>${e(job.sourceId || job.sourceSystem)}</td><td>${e(date(job.startedAt,false))}</td><td>${e(date(job.completedAt,false))}</td><td>${badge(job.status)}</td><td>${number(job.recordsFetched ?? job.total)}</td><td>${number(job.recordsCreated ?? job.created)}</td><td>${number(job.recordsUpdated ?? job.updated)}</td><td>${number(job.recordsSkipped ?? job.skipped)}</td><td>${number(job.recordsFailed ?? job.failed)}${job.error ? `<span class="cell-secondary">${e(job.error)}</span>` : ''}</td></tr>`)) : empty('Chưa có lượt đồng bộ','Kết quả nhập dữ liệu và đồng bộ Collector được ghi nhận tại đây.');
}
async function sync(ctx) { const data=await ctx.api('/sync-jobs'+qs(ctx)); return heading('Lịch sử đồng bộ','Theo dõi kết quả Collector và nhập dữ liệu, bao gồm các dòng lỗi.')+filters(ctx)+panel('Các lượt đồng bộ','Nhật ký đồng bộ được lưu để truy vết.',jobTable(list(data.items))); }
async function notifications(ctx) {
  const data = await ctx.api('/notifications');
  return heading('Thông báo','Thông tin và cảnh báo trong phạm vi quản lý của bạn.')+panel('Thông báo trong hệ thống','Thông báo được tạo từ dữ liệu thực tế.',list(data.items).length ? `<div class="panel-body"><ol class="timeline">${data.items.map(item=>`<li><strong>${e(item.title || item.message)}</strong>${item.title ? `<p>${e(item.message)}</p>` : ''}<p>${e(date(item.createdAt))}</p>${item.caseId ? `<a class="text-link" href="${e(ctx.link('/cases/'+encodeURIComponent(item.caseId)))}" data-nav>Chi tiết hồ sơ →</a>` : ''}</li>`).join('')}</ol></div>` : empty('Chưa có thông báo','Bạn sẽ nhận thông báo khi có sự kiện phù hợp với phạm vi quản lý.'));
}
async function reports(ctx) {
  const data=await ctx.api('/reports'+qs(ctx,['page','pageSize'])); const metricsData=data.metrics || {};
  const exportLink = format => { const params=ctx.query(); params.set('format',format); return '/api/reports/export?'+params; };
  return heading('Báo cáo tổng hợp','Tổng hợp tiến độ theo kỳ, nguồn dữ liệu và cấp quản lý.',`<a class="button secondary" href="${e(exportLink('csv'))}">${icon('import')}Xuất CSV</a><a class="button" href="${e(exportLink('xlsx'))}">${icon('reports')}Xuất Excel</a>`)
    + filters(ctx,{reports:true}) + metrics(ctx,metricsData,true)
    + `<div class="notice">Tỷ lệ đúng hạn: <strong>${metricsData.onTimeRate == null ? '—' : number(metricsData.onTimeRate)+'%'}</strong> · Tỷ lệ trễ: <strong>${metricsData.overdueRate == null ? '—' : number(metricsData.overdueRate)+'%'}</strong> · Đang xử lý: <strong>${number(metricsData.active)}</strong></div>`
    + panel('Theo nguồn','Số liệu thống kê trong kỳ báo cáo.',groupTable(ctx,list(data.bySource),'source'))
    + panel('Theo cơ quan','Chọn cơ quan để xem cấp quản lý tiếp theo.',groupTable(ctx,list(data.byAgency),'agency'))
    + panel('Theo phòng / đơn vị','Tổng hợp tiến độ và cảnh báo.',groupTable(ctx,list(data.byDepartment),'department'))
    + panel('Theo cán bộ','Tổng hợp khối lượng và tiến độ xử lý.',groupTable(ctx,list(data.byOfficer),'officer'));
}

function importErrors(errors) {
  return errors.length ? table(['Dòng','Nội dung lỗi'],errors.slice(0,100).map(error=>`<tr><td>${number(error.row)}</td><td class="wrap">${e(error.error || error.message)}</td></tr>`)) : '';
}
function importPage(ctx) {
  if (!ctx.can('write')) return empty('Bạn chưa được cấp quyền','Vai trò chỉ xem không được nhập dữ liệu.');
  const s=importState;
  const steps=['Chọn tệp','Xem trước','Nguồn & ánh xạ','Kiểm tra','Kết quả'];
  let content='';
  if (s.step === 0) content=`<form id="import-upload-form"><div class="file-drop">${icon('import')}<h2 class="mt-12">Chọn tệp dữ liệu hồ sơ</h2><p>Tệp CSV UTF-8 hoặc Excel (.xlsx). Chỉ nhập dữ liệu được phép sử dụng.</p><label class="sr-only" for="import-file">Tệp dữ liệu</label><input id="import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></div><div class="form-actions"><button class="button" type="submit">Đọc dữ liệu →</button><small>Giới hạn kích thước và số dòng được kiểm tra tại máy chủ.</small></div></form>`;
  if (s.step === 1) {
    const rows=list(s.preview.rows).slice(0,10).map(row=>`<tr>${s.preview.headers.map((header,index)=>`<td>${e(Array.isArray(row) ? row[index] : row[header])}</td>`).join('')}</tr>`);
    content=`<div class="notice">${e(s.fileName)} · ${number(s.preview.totalRows)} dòng · Xem trước tối đa 10 dòng.</div>${table(s.preview.headers,rows)}<div class="form-actions"><button class="button secondary" data-import-step="0">← Chọn lại tệp</button><button class="button" data-import-step="2">Chọn nguồn & ánh xạ →</button></div>`;
  }
  if (s.step === 2) {
    const rawCanonical = ctx.state.catalogs.canonicalFields || Object.keys(FIELD_LABELS);
    const canonical = Array.isArray(rawCanonical) ? rawCanonical.map(item=>typeof item === 'string' ? item : item.name || item.key || item.field).filter(Boolean) : Object.keys(rawCanonical);
    content=`<form id="import-mapping-form">${field('Nguồn dữ liệu',`<select name="sourceSystem" required>${option('','Chọn nguồn dữ liệu',s.sourceSystem)}${ctx.state.sources.filter(enabled).map(source=>option(sourceId(source),source.name,s.sourceSystem)).join('')}</select>`,'Khóa chống trùng bao gồm nguồn và ID nguồn hoặc mã hồ sơ.')}
      <div class="notice warning mt-20">Ánh xạ mã hồ sơ, trạng thái và ngày hẹn trả theo dữ liệu thực tế. Ngày thiếu múi giờ được kiểm tra theo định dạng Việt Nam tại máy chủ.</div>
      <div>${s.preview.headers.map((header,index)=>`<label class="mapping-row"><span>${e(header)}</span><span aria-hidden="true">→</span><select name="column-${index}">${option('','Bỏ qua cột này',s.mapping[header])}${canonical.map(name=>option(name,FIELD_LABELS[name] || name,s.mapping[header])).join('')}</select></label>`).join('')}</div>
      <div class="form-actions"><button class="button secondary" type="button" data-import-step="1">← Xem trước</button><button class="button" type="submit">Kiểm tra dữ liệu →</button></div></form>`;
  }
  if (s.step === 3) {
    const result=s.validation;
    content=`<div class="stat-inline"><div><strong>${number(result.totalRows)}</strong><span>Tổng dòng</span></div><div><strong class="text-safe">${number(result.valid)}</strong><span>Dòng hợp lệ</span></div><div><strong class="text-overdue">${number(result.invalid)}</strong><span>Dòng không hợp lệ</span></div></div>
      ${result.invalid ? '<div class="notice warning">Các dòng lỗi được báo riêng. Bạn có thể nhập các dòng hợp lệ hoặc chỉnh sửa tệp và kiểm tra lại.</div>' : '<div class="notice">Dữ liệu đã qua kiểm tra. Hồ sơ trùng trong cùng nguồn sẽ được cập nhật.</div>'}
      ${importErrors(list(result.errors))}${list(result.errors).length ? '<button class="button secondary small mt-15" id="download-import-errors">Tải báo cáo lỗi CSV</button>' : ''}
      <form id="import-commit-form"><div class="form-actions"><label class="checkbox-label"><input type="checkbox" required>Tôi xác nhận nguồn và ánh xạ phù hợp với dữ liệu được phép sử dụng.</label></div><div class="form-actions"><button class="button secondary" type="button" data-import-step="2">← Điều chỉnh ánh xạ</button><button class="button" type="submit" ${!result.valid ? 'disabled' : ''}>Nhập ${number(result.valid)} dòng hợp lệ</button></div></form>`;
  }
  if (s.step === 4) {
    const result=s.result;
    content=`<div class="notice">Đã hoàn tất lượt nhập dữ liệu ${e(result.id || '')}.</div><div class="stat-inline">${[['total','Tổng dòng'],['created','Tạo mới'],['updated','Cập nhật'],['skipped','Bỏ qua'],['failed','Lỗi']].map(([key,label])=>`<div><strong>${number(result[key])}</strong><span>${label}</span></div>`).join('')}</div>${importErrors(list(result.errors))}${list(result.errors).length ? '<button class="button secondary small" id="download-import-errors">Tải báo cáo lỗi CSV</button>' : ''}<div class="form-actions"><button class="button secondary" id="new-import">Nhập tệp khác</button><a class="button" href="${e(ctx.link('/cases',{sourceSystem:s.sourceSystem,page:1}))}" data-nav>Xem hồ sơ →</a></div>`;
  }
  return heading('Nhập Excel / CSV','Xem trước, ánh xạ và kiểm tra trước khi cập nhật kho hồ sơ.')+`<div class="stepper" aria-label="Tiến trình nhập dữ liệu">${steps.map((step,index)=>`<div class="step ${index === s.step ? 'active' : ''}" ${index === s.step ? 'aria-current="step"' : ''}><strong>${index+1}</strong>${e(step)}</div>`).join('')}</div>`+panel(steps[s.step],s.fileName || 'Chọn tệp để bắt đầu.',`<div class="panel-body">${content}<div id="import-error" class="error-inline" role="alert"></div></div>`);
}

async function settings(ctx) {
  if (!ctx.can('manage')) return empty('Bạn chưa được cấp quyền','Cấu hình nghiệp vụ yêu cầu quyền quản trị.');
  const data=await ctx.api('/settings'); currentResult=data;
  const config=data.defaultRule?.config || data.defaultRule || list(data.rules).find(rule=>rule.scopeType === 'GLOBAL')?.config || {};
  const calendar=data.calendar || {};
  const scopes=[['GLOBAL','Toàn hệ thống'],['SOURCE','Theo nguồn'],['AGENCY','Theo cơ quan'],['PROCEDURE','Theo thủ tục']];
  const thresholds=[['watchSeconds','Theo dõi trước hạn (giờ)'],['warningSeconds','Sắp hạn trước hạn (giờ)'],['highRiskSeconds','Nguy cơ cao trước hạn (giờ)'],['criticalOverdueSeconds','Trễ nghiêm trọng sau hạn (giờ)']];
  const ruleRows=list(data.rules).map((rule,index)=>`<tr><td>${e(scopes.find(([key])=>key === rule.scopeType)?.[1] || rule.scopeType)}</td><td>${e(rule.scopeId)}</td><td>${number(Number(rule.config?.warningSeconds)/3600)} giờ</td><td>${number(Number(rule.config?.highRiskSeconds)/3600)} giờ</td><td>${number(Number(rule.config?.criticalOverdueSeconds)/3600)} giờ</td><td><button class="button secondary small" data-edit-rule="${index}">Chỉnh sửa</button></td></tr>`);
  return heading('Cấu hình nghiệp vụ','Quy tắc cảnh báo và lịch làm việc cần được người phụ trách xác nhận.')
    + '<div class="notice warning">Ngưỡng hiển thị là cấu hình khởi tạo theo ví dụ yêu cầu. Cần xác nhận phạm vi áp dụng, thời gian tạm dừng, bổ sung và lịch ngày làm việc trước khi vận hành chính thức. Ngày hẹn trả do nguồn cung cấp được giữ nguyên.</div>'
    + `<div class="detail-grid"><div>${panel('Quy tắc cảnh báo','Ưu tiên cấu hình riêng theo thủ tục / cơ quan / nguồn trước cấu hình chung.',`<form class="panel-body" id="rule-form"><div class="form-grid">
      ${field('Phạm vi',`<select name="scopeType" id="rule-scope-type">${scopes.map(([key,label])=>option(key,label,'GLOBAL')).join('')}</select>`)}${field('Đối tượng',`<select name="scopeId" id="rule-scope-id"><option value="*">Toàn hệ thống</option></select>`)}
      ${thresholds.map(([key,label])=>field(label,`<input name="${key}" type="number" min="0" step="0.01" value="${config[key] != null ? e(Number(config[key])/3600) : ''}" required>`)).join('')}
      ${field('Điểm nguy cơ cao',`<input name="highRiskScore" type="number" min="1" max="100" step="1" value="${e(config.highRiskScore)}" required>`)}
      ${field('Trạng thái chưa rõ nghiệp vụ',`<select name="uncertainStatusPolicy">${option('REVIEW','Yêu cầu xác minh',config.uncertainStatusPolicy)}${option('USE_SOURCE_DUE','Dùng ngày hẹn chính thức từ nguồn',config.uncertainStatusPolicy)}</select>`,'Áp dụng cho chờ bổ sung, chờ người dân, tạm dừng và trạng thái chưa rõ.')}
    </div><div class="form-actions"><button class="button" type="submit">Lưu quy tắc</button><small>Kết quả cảnh báo sẽ được tính lại.</small></div></form>`)}
    ${panel('Quy tắc đã lưu','Cấu hình có thể truy vết trong nhật ký kiểm toán.',ruleRows.length ? table(['Phạm vi','Đối tượng','Sắp hạn','Nguy cơ cao','Trễ nghiêm trọng','Thao tác'],ruleRows) : empty('Chưa có cấu hình riêng','Bạn có thể bổ sung cấu hình theo nguồn, cơ quan hoặc thủ tục.'))}</div><div>
    ${panel('Lịch làm việc','Chỉ dùng khi cần tính SLA từ số ngày xử lý, không sửa ngày hẹn chính thức.',`<form class="panel-body" id="calendar-form"><h3>Ngày làm việc trong tuần</h3><div class="checkbox-group">${[[1,'T2'],[2,'T3'],[3,'T4'],[4,'T5'],[5,'T6'],[6,'T7'],[0,'CN']].map(([value,label])=>`<label class="checkbox-label"><input type="checkbox" name="weekdays" value="${value}" ${list(calendar.workingWeekdays).includes(value) ? 'checked' : ''}>${label}</label>`).join('')}</div>
      <div class="mt-20">${field('Ngày nghỉ / lễ',`<textarea name="holidays" placeholder="YYYY-MM-DD">${e(list(calendar.holidays).map(item=>typeof item === 'string' ? item : item.date).join('\n'))}</textarea>`,'Một ngày mỗi dòng, định dạng YYYY-MM-DD.')}</div>
      <div class="mt-15">${field('Ngày làm bù',`<textarea name="workingDates" placeholder="YYYY-MM-DD">${e(list(calendar.workingDates).join('\n'))}</textarea>`,'Ngày làm việc ngoại lệ, một ngày mỗi dòng.')}</div>
      <div class="form-actions"><label class="checkbox-label"><input type="checkbox" name="confirmed" ${calendar.confirmed ? 'checked' : ''}>Lịch đã được người phụ trách nghiệp vụ xác nhận</label></div><div class="form-actions"><button class="button" type="submit">Lưu lịch làm việc</button></div></form>`)}
    <div class="notice">Hồ sơ thiếu hạn trả chính thức hoặc có trạng thái chưa rõ nghiệp vụ được đưa vào diện cần xác minh.</div></div></div>`;
}
function scopeForm(ctx,scope={}) {
  return `<div class="wide">${field('Nguồn được cấp quyền',`<select name="sourceSystems" multiple size="5">${ctx.state.sources.map(source=>`<option value="${e(sourceId(source))}" ${list(scope.sourceSystems).includes(sourceId(source)) ? 'selected' : ''}>${e(source.name)}</option>`).join('')}</select>`,'Dùng Ctrl / Cmd để chọn nhiều nguồn. Phạm vi rỗng cho vai trò quản trị phải được quản trị viên xác nhận.')}</div>
    ${field('Phạm vi cơ quan',`<select name="agencyId">${catalogOptions(ctx,'agencies',scope.agencyId,'Chưa giới hạn cơ quan')}</select>`)}
    ${field('Phạm vi phòng',`<select name="departmentId">${catalogOptions(ctx,'departments',scope.departmentId,'Chưa giới hạn phòng')}</select>`)}
    ${field('Phạm vi cán bộ',`<select name="officerId">${catalogOptions(ctx,'officers',scope.officerId,'Chưa giới hạn cán bộ')}</select>`)}`;
}
function userForm(ctx,user=null) {
  return `<form class="panel-body" id="user-form" data-user-id="${e(user?.id || '')}"><div class="form-grid">
    ${user ? detailItem('Tên đăng nhập',user.username,false,false) : field('Tên đăng nhập',`<input name="username" required maxlength="120" autocomplete="off">`)}
    ${user ? detailItem('Họ và tên',user.displayName) : field('Họ và tên',`<input name="displayName" required maxlength="200">`)}
    ${!user ? field('Mật khẩu khởi tạo',`<input name="password" type="password" autocomplete="new-password" minlength="12" required maxlength="256">`,'Ít nhất 12 ký tự.') : field('Tình trạng',`<select name="active">${option('true','Hoạt động',String(user.active !== false))}${option('false','Đã khóa',String(user.active !== false))}</select>`)}
    ${field('Vai trò',`<select name="role">${Object.entries(ROLE_LABELS).map(([key,label])=>option(key,label,user?.role || 'VIEWER')).join('')}</select>`)}${scopeForm(ctx,user?.scope)}
    </div><div class="form-actions"><button class="button" type="submit">${user ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>${user ? '<button class="button secondary" type="button" data-refresh>Hủy</button>' : ''}</div></form>`;
}
async function users(ctx) {
  if (!ctx.can('admin')) return empty('Bạn chưa được cấp quyền','Quản lý tài khoản yêu cầu vai trò Quản trị hệ thống.');
  const data=await ctx.api('/admin/users'); currentResult=data;
  if (data.provider?.provider === 'google_sheets') {
    const provider = data.provider; const storage = data.storage || {};
    const rows=list(data.items).map(user=>`<tr><td><span class="cell-primary">${e(user.displayName)}</span><span class="cell-secondary">${e(user.email)}</span></td><td>${e(ROLE_LABELS[user.role] || user.role)}</td><td class="wrap">${e(JSON.stringify(user.scope || {}))}</td><td>${badge(user.active ? 'SAFE' : 'DISABLED',user.active ? 'Hoạt động' : 'Đã khóa')}</td><td>${user.lastLoginKnown ? 'Đã đăng nhập' : 'Chưa đăng nhập'}</td></tr>`);
    return heading('Phân quyền trên Google Sheet','Đăng nhập bằng Google. Vai trò, phạm vi và trạng thái lấy từ bảng quản lý.',`<a class="button secondary" href="${e(safeUrl(provider.sheetUrl))}" target="_blank" rel="noopener noreferrer">Mở Google Sheet</a> <button class="button" id="refresh-sheet-permissions">Cập nhật quyền ngay</button>`)
      + panel('Kết nối bảng quản lý',`Tab ${provider.sheetName} · cập nhật mỗi ${provider.refreshSeconds} giây.`,`<div class="panel-body"><div class="detail-grid">${detailItem('Quyền được cập nhật lần cuối',date(provider.lastSuccessAt))}${detailItem('Trạng thái',provider.ready ? 'Đã xác nhận quyền' : 'Chưa xác nhận được quyền')}${detailItem('Lưu dữ liệu',storage.provider === 'sqlite' ? 'SQLite' : 'Google Sheet')}${detailItem('Đang chờ ghi lên Sheet',String(storage.pendingEvents ?? 0))}</div><p>Thêm email, đổi vai trò, phạm vi hoặc đặt active = FALSE trực tiếp trên tab ${e(provider.sheetName)}. Tài khoản được tạo khi đăng nhập Google lần đầu. Thay đổi quyền sẽ thu hồi phiên đăng nhập và token đồng bộ.</p>${provider.lastError ? `<div class="notice warning">${e(provider.lastError)}</div>` : ''}${storage.lastError ? `<div class="notice warning">${e(storage.lastError.message || storage.lastError)}</div>` : ''}</div>`)
      + panel('Danh sách email và quyền','Email phải khớp tài khoản Google đã xác minh.',rows.length ? table(['Tài khoản Google','Vai trò','Phạm vi','Tình trạng','Sử dụng'],rows) : empty('Chưa có email được cấp quyền'));
  }
  const rows=list(data.items).map((user,index)=>`<tr><td><span class="cell-primary">${e(user.displayName || user.username)}</span><span class="cell-secondary">${e(user.username)}</span></td><td>${e(ROLE_LABELS[user.role] || user.role)}</td><td class="wrap">${e(JSON.stringify(user.scope || {}))}</td><td>${badge(user.active === false ? 'DISABLED' : 'SAFE',user.active === false ? 'Đã khóa' : 'Hoạt động')}</td><td><button class="button secondary small" data-edit-user="${index}">Chỉnh sửa</button></td></tr>`);
  return heading('Người dùng','Cấp vai trò và giới hạn nguồn, cơ quan, phòng hoặc cán bộ theo nhu cầu quản lý.')
    + panel('Tài khoản hệ thống','Phạm vi dữ liệu luôn được kiểm tra tại máy chủ.',rows.length ? table(['Tài khoản','Vai trò','Phạm vi','Tình trạng','Thao tác'],rows) : empty('Chưa có tài khoản'))
    + `<div id="user-editor">${panel('Tạo tài khoản','Vai trò và phạm vi cần phù hợp với quyền truy cập được cấp.',userForm(ctx))}</div>`;
}
async function roles(ctx) {
  if (!ctx.can('admin')) return empty('Bạn chưa được cấp quyền','Thông tin vai trò yêu cầu quyền quản trị.');
  const data=await ctx.api('/admin/roles');
  const rows=list(data.items).map(item=>{
    const role=typeof item === 'string' ? {id:item,name:item} : item;
    return `<tr><td><span class="cell-primary">${e(ROLE_LABELS[role.id || role.name || role.role] || role.displayName || role.name)}</span><span class="cell-secondary">${e(role.id || role.name || role.role)}</span></td><td class="wrap">${e(role.description || '')}</td><td class="wrap">${e(list(role.permissions).map(permission=>typeof permission === 'string' ? permission : permission.name).join(', ') || 'Theo chính sách máy chủ')}</td></tr>`;
  });
  return heading('Vai trò & quyền','Danh sách vai trò và các thao tác được cấp bởi chính sách máy chủ.')+panel('Phân quyền hệ thống','Quyền thao tác kết hợp với phạm vi dữ liệu của mỗi tài khoản.',table(['Vai trò','Mô tả','Quyền'],rows));
}
async function audit(ctx) {
  if (!ctx.can('admin')) return empty('Bạn chưa được cấp quyền','Nhật ký kiểm toán yêu cầu quyền Quản trị hệ thống.');
  const data=await ctx.api('/audit-logs'+qs(ctx));
  const rows=list(data.items).map(log=>`<tr><td>${e(date(log.createdAt))}</td><td>${e(log.username || log.displayName || log.actorName || log.userId || log.actorId)}</td><td>${e(log.action)}</td><td>${e(log.entityType || log.resource || '—')}<span class="cell-secondary">${e(log.entityId || log.resourceId)}</span></td><td class="wrap"><details><summary>Xem dữ liệu</summary><pre class="json-view">${e(JSON.stringify(log.details || log.metadata || {},null,2))}</pre></details></td></tr>`);
  return heading('Nhật ký kiểm toán','Truy vết các thao tác đăng nhập, cấu hình, nhập dữ liệu, đồng bộ và tiếp nhận cảnh báo.')+panel('Sự kiện kiểm toán','Nhật ký không chứa mật khẩu, mã bí mật hoặc phiên cổng nguồn.',rows.length ? table(['Thời gian','Người thực hiện','Thao tác','Đối tượng','Chi tiết'],rows)+pagination(data) : empty('Chưa có sự kiện','Các thao tác sẽ được ghi nhận khi sử dụng hệ thống.'));
}

export async function renderPage(ctx) {
  const [page='dashboard',id]=ctx.route();
  if (page === 'dashboard') return dashboard(ctx);
  if (page === 'cases') return id ? caseDetail(ctx,id) : cases(ctx);
  if (page === 'alerts') return alerts(ctx);
  if (page === 'sources') return id ? sourceDetail(ctx,id) : sources(ctx);
  if (['agencies','departments','officers','procedures'].includes(page)) return groups(ctx,page);
  if (page === 'imports' || page === 'import') return importPage(ctx);
  if (page === 'reports') return reports(ctx);
  if (page === 'settings') return settings(ctx);
  if (page === 'users') return users(ctx);
  if (page === 'roles') return roles(ctx);
  if (page === 'audit') return audit(ctx);
  if (page === 'sync') return sync(ctx);
  if (page === 'notifications') return notifications(ctx);
  return empty('Không tìm thấy trang','Đường dẫn này không tồn tại.',`<a class="button" href="${e(ctx.link('/dashboard',{},true))}" data-nav>Về tổng quan</a>`);
}

async function action(button,callback) {
  if (button) button.disabled=true;
  try { await callback(); } catch(error) { toast(error.message,'error'); }
  finally { if (button?.isConnected) button.disabled=false; }
}
function saveScope(form) {
  const values=new FormData(form);
  return {sourceSystems:values.getAll('sourceSystems'),agencyId:values.get('agencyId') || null,departmentId:values.get('departmentId') || null,officerId:values.get('officerId') || null};
}
function bindUserForm(ctx) {
  document.querySelector('#user-form')?.addEventListener('submit',event=>{
    event.preventDefault(); const form=event.currentTarget, values=new FormData(form);
    action(form.querySelector('button[type="submit"]'),async()=>{
      const id=form.dataset.userId;
      const payload={role:values.get('role'),scope:saveScope(form)};
      if (id) payload.active=values.get('active') === 'true';
      else Object.assign(payload,{username:values.get('username'),displayName:values.get('displayName'),password:values.get('password')});
      await ctx.api('/admin/users'+(id ? '/'+encodeURIComponent(id) : ''),{method:id ? 'PATCH' : 'POST',body:payload});
      toast(id ? 'Đã cập nhật tài khoản.' : 'Đã tạo tài khoản.'); await ctx.refresh();
    });
  });
}
function bindRuleScope(ctx,selectedId='*') {
  const type=document.querySelector('#rule-scope-type')?.value, select=document.querySelector('#rule-scope-id');
  if (!select) return;
  if (type === 'GLOBAL') select.innerHTML=option('*','Toàn hệ thống','*');
  else if (type === 'SOURCE') select.innerHTML=ctx.state.sources.map(source=>option(sourceId(source),source.name,selectedId)).join('');
  else select.innerHTML=catalogOptions(ctx,type === 'AGENCY' ? 'agencies' : 'procedures',selectedId,'Chọn đối tượng');
  select.required=true;
}
function bindSettings(ctx) {
  if (!ctx.can('admin')) {
    for (const control of document.querySelectorAll('#rule-form input, #rule-form select, #rule-form button, #calendar-form input, #calendar-form textarea, #calendar-form button, [data-edit-rule]')) control.disabled=true;
    return;
  }
  document.querySelector('#rule-scope-type')?.addEventListener('change',()=>bindRuleScope(ctx));
  for (const button of document.querySelectorAll('[data-edit-rule]')) button.addEventListener('click',()=>{
    const rule=currentResult.rules[Number(button.dataset.editRule)]; const form=document.querySelector('#rule-form');
    form.elements.scopeType.value=rule.scopeType; bindRuleScope(ctx,rule.scopeId);
    for (const key of ['watchSeconds','warningSeconds','highRiskSeconds','criticalOverdueSeconds']) form.elements[key].value=Number(rule.config[key])/3600;
    form.elements.highRiskScore.value=rule.config.highRiskScore; form.elements.uncertainStatusPolicy.value=rule.config.uncertainStatusPolicy || 'REVIEW';
    form.scrollIntoView({behavior:'smooth',block:'center'});
  });
  document.querySelector('#rule-form')?.addEventListener('submit',event=>{
    event.preventDefault(); const form=event.currentTarget, values=new FormData(form);
    action(form.querySelector('button'),async()=>{
      const config={}; for (const key of ['watchSeconds','warningSeconds','highRiskSeconds','criticalOverdueSeconds']) config[key]=Math.round(Number(values.get(key))*3600);
      config.highRiskScore=Number(values.get('highRiskScore')); config.uncertainStatusPolicy=values.get('uncertainStatusPolicy');
      await ctx.api('/settings/rules',{method:'PUT',body:{scopeType:values.get('scopeType'),scopeId:values.get('scopeId'),config}});
      toast('Đã lưu quy tắc và tính lại cảnh báo.'); await ctx.refresh();
    });
  });
  document.querySelector('#calendar-form')?.addEventListener('submit',event=>{
    event.preventDefault(); const form=event.currentTarget,values=new FormData(form);
    action(form.querySelector('button'),async()=>{
      const dates=name=>String(values.get(name)).split(/[\n,]/).map(value=>value.trim()).filter(Boolean);
      const calendar={confirmed:values.has('confirmed'),workingWeekdays:values.getAll('weekdays').map(Number),holidays:dates('holidays'),workingDates:dates('workingDates')};
      if ([...calendar.holidays,...calendar.workingDates].some(value=>!/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error('Ngày nghỉ và ngày làm bù phải có định dạng YYYY-MM-DD.');
      await ctx.api('/settings/calendar',{method:'PUT',body:{calendar}}); toast('Đã lưu lịch làm việc.'); await ctx.refresh();
    });
  });
}

async function fileBase64(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=()=>reject(new Error('Không đọc được tệp dữ liệu.')); reader.readAsDataURL(file);
  });
}
function proposeMapping(headers,canonicalFields) {
  const aliases={caseCode:['mahoso','masohoso','casecode'],procedureCode:['mathutuc','procedurecode'],procedureName:['tenthutuc','thutuc','procedurename'],applicantName:['nguoinop','hoten','applicantname'],receivedAt:['ngaytiepnhan','receivedat'],submittedAt:['ngaynop','submittedat'],dueAt:['ngayhentra','ngayhen','dueat'],sourceStatus:['trangthai','trangthainguon','sourcestatus'],agencyName:['coquan','coquanthuchien','agencyname'],departmentName:['phong','phongban','departmentname'],officerName:['canbo','canboxuly','officername'],completedAt:['ngayhoanthanh','completedat'],sourceRecordId:['sourceRecordId','idnguon','sourceid']};
  const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
  const result={}; const mapped=new Set();
  for (const header of headers) {
    const target=Object.entries(aliases).find(([field,names])=>canonicalFields.includes(field) && !mapped.has(field) && names.some(name=>normalize(name) === normalize(header)))?.[0];
    if (target) { result[header]=target; mapped.add(target); }
  }
  return result;
}
function bindImport(ctx) {
  for (const button of document.querySelectorAll('[data-import-step]')) button.addEventListener('click',()=>{importState.step=Number(button.dataset.importStep);ctx.refresh();});
  document.querySelector('#new-import')?.addEventListener('click',()=>{importState=freshImport();ctx.refresh();});
  document.querySelector('#download-import-errors')?.addEventListener('click',()=>{
    const errors=importState.result?.errors || importState.validation?.errors || [];
    downloadCsv('bao-cao-loi-nhap.csv',['Dòng','Lỗi'],errors.map(error=>[error.row,error.error || error.message]));
  });
  document.querySelector('#import-upload-form')?.addEventListener('submit',event=>{
    event.preventDefault(); const form=event.currentTarget,button=form.querySelector('button'),file=document.querySelector('#import-file').files[0];
    action(button,async()=>{
      if (!file) throw new Error('Vui lòng chọn tệp dữ liệu.');
      if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Vui lòng sử dụng tệp CSV hoặc XLSX.');
      if (file.size > 10*1024*1024) throw new Error('Tệp vượt quá giới hạn 10 MB. Hãy chia thành các tệp nhỏ hơn.');
      const base64=await fileBase64(file),preview=await ctx.api('/import/preview',{method:'POST',body:{fileName:file.name,base64}});
      if (!list(preview.headers).length || !preview.totalRows) throw new Error('Tệp không có dữ liệu hoặc không có hàng tiêu đề.');
      const raw=ctx.state.catalogs.canonicalFields || Object.keys(FIELD_LABELS);
      const canonical=Array.isArray(raw) ? raw.map(item=>typeof item === 'string' ? item : item.name || item.key || item.field) : Object.keys(raw);
      importState={...freshImport(),fileName:file.name,base64,preview,step:1,sourceSystem:ctx.query().get('sourceSystem') || '',mapping:proposeMapping(preview.headers,canonical)};
      await ctx.refresh();
    });
  });
  document.querySelector('#import-mapping-form')?.addEventListener('submit',event=>{
    event.preventDefault(); const form=event.currentTarget,values=new FormData(form);
    action(form.querySelector('button[type="submit"]'),async()=>{
      const mapping={}; const used=new Set();
      for (const [index,header] of importState.preview.headers.entries()) {
        const target=values.get('column-'+index); if (!target) continue;
        if (used.has(target)) throw new Error('Mỗi trường chuẩn chỉ được ánh xạ từ một cột.');
        mapping[header]=target; used.add(target);
      }
      if (!used.has('caseCode')) throw new Error('Cần ánh xạ cột Mã hồ sơ.');
      importState.sourceSystem=values.get('sourceSystem'); importState.mapping=mapping;
      importState.validation=await ctx.api('/import/validate',{method:'POST',body:{fileName:importState.fileName,base64:importState.base64,sourceSystem:importState.sourceSystem,mapping}});
      importState.step=3; await ctx.refresh();
    });
  });
  document.querySelector('#import-commit-form')?.addEventListener('submit',event=>{
    event.preventDefault(); const form=event.currentTarget;
    action(form.querySelector('button[type="submit"]'),async()=>{
      importState.result=await ctx.api('/import/commit',{method:'POST',body:{fileName:importState.fileName,base64:importState.base64,sourceSystem:importState.sourceSystem,mapping:importState.mapping}});
      await ctx.reloadCatalogs?.();
      importState.step=4; toast('Đã hoàn tất nhập dữ liệu.'); await ctx.refresh();
    });
  });
}

let searchTimer;
export function bindPage(ctx) {
  clearTimeout(searchTimer);
  document.querySelector('#refresh-sheet-permissions')?.addEventListener('click', event => action(event.currentTarget, async () => {
    await ctx.api('/admin/permissions/refresh', {method:'POST'}); toast('Đã cập nhật quyền từ Google Sheet.'); await ctx.refresh();
  }));
  const form=document.querySelector('#filters-form');
  const applyFilters=()=>{
    const values=new FormData(form),overrides={page:1};
    for (const [key,value] of values) overrides[key]=value;
    ctx.navigate(ctx.link(location.pathname,overrides));
  };
  form?.addEventListener('submit',event=>{event.preventDefault();applyFilters();});
  form?.querySelector('input[name="q"]')?.addEventListener('input',event=>{
    const cursor=event.target.selectionStart;
    searchTimer=setTimeout(()=>{ctx.state.searchFocus=cursor;applyFilters();},500);
  });
  if (ctx.state.searchFocus != null) {
    const search=form?.querySelector('input[name="q"]');
    if (search) {search.focus();try{search.setSelectionRange(ctx.state.searchFocus,ctx.state.searchFocus);}catch{}}
    ctx.state.searchFocus=null;
  }
  document.querySelector('#reset-filters')?.addEventListener('click',()=>ctx.navigate(location.pathname));
  for (const button of document.querySelectorAll('[data-refresh]')) button.addEventListener('click',()=>ctx.refresh());
  for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click',()=>ctx.navigate(ctx.link(location.pathname,{page:button.dataset.page})));
  for (const button of document.querySelectorAll('[data-ack]')) button.addEventListener('click',()=>action(button,async()=>{
    await ctx.api('/alerts/'+encodeURIComponent(button.dataset.ack)+'/acknowledge',{method:'POST'});toast('Đã xác nhận tiếp nhận cảnh báo.');await ctx.refresh();
  }));
  for (const button of document.querySelectorAll('[data-toggle-source]')) button.addEventListener('click',()=>action(button,async()=>{
    await ctx.api('/sources/'+encodeURIComponent(button.dataset.toggleSource),{method:'PATCH',body:{enabled:button.dataset.enabled !== 'true'}});await ctx.reloadCatalogs?.();toast('Đã cập nhật trạng thái nguồn.');await ctx.refresh();
  }));
  document.querySelector('#group-sort')?.addEventListener('change',event=>ctx.navigate(ctx.link(location.pathname,{groupSort:event.target.value})));
  document.querySelector('#create-collector-token')?.addEventListener('click',event=>action(event.currentTarget,async()=>{
    const data=await ctx.api('/collector/tokens',{method:'POST'});
    document.querySelector('#collector-token-output').innerHTML=panel('Mã kết nối Collector','Dán mã này vào tiện ích trong phiên sử dụng. Mã chỉ cấp quyền cho hệ thống trung tâm.',`<div class="panel-body"><label class="field"><span>Mã kết nối (chỉ hiển thị trong phiên này)</span><input id="collector-token" readonly type="password" value="${e(data.token)}" autocomplete="off"></label><div class="form-actions"><button class="button secondary small" id="show-collector-token">Hiện / ẩn</button><button class="button secondary small" id="copy-collector-token">Sao chép</button><small>Hết hạn: ${e(date(data.expiresAt))}</small></div></div>`);
    document.querySelector('#show-collector-token').addEventListener('click',()=>{const input=document.querySelector('#collector-token');input.type=input.type === 'password' ? 'text' : 'password';});
    document.querySelector('#copy-collector-token').addEventListener('click',()=>action(null,async()=>{await navigator.clipboard.writeText(data.token);toast('Đã sao chép mã kết nối.');}));
  }));
  document.querySelector('#report-period')?.addEventListener('change',event=>{
    const period=event.target.value; if (!period) return;
    ctx.navigate(ctx.link('/reports',{...reportDateRange(period),page:null}));
  });
  for (const button of document.querySelectorAll('[data-edit-user]')) button.addEventListener('click',()=>{
    const user=currentResult.items[Number(button.dataset.editUser)];document.querySelector('#user-editor').innerHTML=panel('Cập nhật tài khoản','Thay đổi vai trò, tình trạng và phạm vi dữ liệu.',userForm(ctx,user));bindUserForm(ctx);document.querySelector('#user-editor').scrollIntoView({behavior:'smooth'});
    document.querySelector('#user-editor [data-refresh]')?.addEventListener('click',()=>ctx.refresh());
  });
  bindUserForm(ctx);bindSettings(ctx);bindImport(ctx);
}
