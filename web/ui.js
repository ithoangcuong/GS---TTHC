export const STATUS_LABELS = {
  NEW: 'Mới', RECEIVED: 'Đã tiếp nhận', PROCESSING: 'Đang xử lý',
  WAITING_ADDITIONAL_DOCUMENTS: 'Chờ bổ sung hồ sơ', WAITING_FOR_CITIZEN: 'Chờ người dân',
  PAUSED: 'Tạm dừng', TRANSFERRED: 'Đã chuyển', COMPLETED: 'Hoàn thành',
  RETURNED: 'Đã trả lại', CANCELLED: 'Đã hủy', OVERDUE: 'Trễ hạn', UNKNOWN: 'Chưa xác định'
};
export const ALERT_LABELS = {
  SAFE: 'An toàn', WATCH: 'Theo dõi', WARNING: 'Sắp đến hạn', HIGH_RISK: 'Nguy cơ cao',
  OVERDUE: 'Trễ hạn', CRITICAL_OVERDUE: 'Trễ nghiêm trọng', REVIEW: 'Cần xác minh', NEEDS_REVIEW: 'Cần xác minh'
};
const SOURCE_LABELS = {CONNECTED:'Đã kết nối',NOT_LOGGED_IN:'Chưa đăng nhập',READY:'Sẵn sàng',SYNCING:'Đang đồng bộ',SYNC_SUCCESS:'Đồng bộ thành công',SYNC_ERROR:'Lỗi đồng bộ',ADAPTER_ERROR:'Cần cấu hình Adapter',DISABLED:'Đã tắt',PARTIAL_SUCCESS:'Thành công một phần'};
export const ROLE_LABELS = {
  SYSTEM_ADMIN: 'Quản trị hệ thống', CENTRAL_ADMIN: 'Quản trị trung tâm', AGENCY_LEADER: 'Lãnh đạo cơ quan',
  DEPARTMENT_LEADER: 'Lãnh đạo phòng', OFFICER: 'Cán bộ', VIEWER: 'Chỉ xem'
};
export const FIELD_LABELS = {
  sourceRecordId: 'ID bản ghi nguồn', sourceCaseId: 'ID hồ sơ nguồn', sourceUrl: 'URL hồ sơ nguồn',
  caseCode: 'Mã hồ sơ', procedureCode: 'Mã thủ tục', procedureName: 'Tên thủ tục',
  submittedAt: 'Ngày nộp', receivedAt: 'Ngày tiếp nhận', originalDueAt: 'Ngày hẹn ban đầu',
  dueAt: 'Ngày hẹn trả', extensionDueAt: 'Ngày gia hạn', completedAt: 'Ngày hoàn thành',
  applicantName: 'Người nộp', agencyId: 'ID cơ quan', agencyName: 'Tên cơ quan', departmentId: 'ID phòng',
  departmentName: 'Tên phòng', officerId: 'ID cán bộ', officerName: 'Tên cán bộ', sourceStatus: 'Trạng thái nguồn',
  normalizedStatus: 'Trạng thái chuẩn', currentStep: 'Bước hiện tại', totalSteps: 'Tổng số bước',
  currentStepStartedAt: 'Bắt đầu bước hiện tại', pauseStartedAt: 'Bắt đầu tạm dừng',
  totalPausedSeconds: 'Thời gian tạm dừng (giây)', lastSourceUpdateAt: 'Nguồn cập nhật',
  sourceSystem: 'Nguồn', lastSyncedAt: 'Đồng bộ gần nhất', effectiveDueAt: 'Hạn trả hiệu lực'
};

// Every value from the API is inserted as text; only trusted markup is interpreted.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
}
export const e = escapeHtml;
export function number(value) { return value != null && Number.isFinite(Number(value)) ? Number(value).toLocaleString('vi-VN') : '—'; }
export function date(value, seconds = true) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {timeZone:'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', ...(seconds ? {second:'2-digit'} : {})}).format(new Date(value));
}
export function remaining(dueAt, now = Date.now()) {
  if (!dueAt || !Number.isFinite(new Date(dueAt).getTime())) return 'Chưa có ngày hẹn';
  const seconds = Math.floor((new Date(dueAt).getTime() - now) / 1000);
  const magnitude = Math.abs(seconds);
  const days = Math.floor(magnitude / 86400), hours = Math.floor(magnitude % 86400 / 3600), minutes = Math.floor(magnitude % 3600 / 60);
  const duration = days ? `${days} ngày ${hours} giờ` : hours ? `${hours} giờ ${minutes} phút` : minutes ? `${minutes} phút` : 'dưới 1 phút';
  return `${seconds < 0 ? 'Quá hạn' : 'Còn'} ${duration}`;
}
export function countdown(record) {
  if (['COMPLETED', 'RETURNED', 'CANCELLED'].includes(record.normalizedStatus)) return e(STATUS_LABELS[record.normalizedStatus]);
  if (record.needsReview || record.deadlineStatus === 'REVIEW' || record.alertLevel === 'REVIEW') return 'Cần xác minh hạn trả';
  const dueAt = record.effectiveDueAt || record.extensionDueAt || record.dueAt || record.originalDueAt;
  return `<span data-countdown="${e(dueAt || '')}">${e(remaining(dueAt))}</span>`;
}
export function badge(level, label) {
  const safeClass = /^[A-Z_]+$/.test(level || '') ? String(level).toLowerCase() : 'unknown';
  return `<span class="badge ${safeClass}"><span aria-hidden="true" class="badge-dot"></span>${e(label || ALERT_LABELS[level] || STATUS_LABELS[level] || SOURCE_LABELS[level] || level || 'Chưa xác định')}</span>`;
}
export function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export function portalLink(value, label = 'Mở cổng nguồn ↗') {
  const url = safeUrl(value);
  return url ? `<a class="text-link" href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(label)}</a>` : '<span class="muted">Chưa có liên kết</span>';
}
export function option(value, label, selected = '') {
  return `<option value="${e(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${e(label)}</option>`;
}
export function field(label, control, note = '') {
  return `<label class="field"><span>${e(label)}</span>${control}${note ? `<small>${e(note)}</small>` : ''}</label>`;
}
export function empty(title = 'Chưa có dữ liệu', message = 'Khi dữ liệu được đồng bộ, kết quả sẽ hiển thị tại đây.', action = '') {
  return `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◇</span><h3>${e(title)}</h3><p>${e(message)}</p>${action}</div>`;
}
export function table(headers, rows, className = '') {
  return `<div class="table-scroll"><table class="data-table ${e(className)}"><thead><tr>${headers.map(header=>`<th scope="col">${e(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
export function pagination(result) {
  const page = Number(result.page || 1), pageSize = Number(result.pageSize || 25), total = Number(result.total || 0), pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="pagination"><span>${total ? `${number((page-1)*pageSize+1)}–${number(Math.min(page*pageSize,total))}` : '0'} / ${number(total)} kết quả</span><div><button class="button ghost small" data-page="${page-1}" ${page <= 1 ? 'disabled' : ''}>← Trước</button><span>Trang ${number(page)} / ${number(pages)}</span><button class="button ghost small" data-page="${page+1}" ${page >= pages ? 'disabled' : ''}>Sau →</button></div></div>`;
}
export function toast(message, type = 'success') {
  const node = document.createElement('div'); node.className = `toast ${type === 'error' ? 'error' : 'success'}`; node.textContent = message;
  document.querySelector('#toast-region').append(node); setTimeout(() => node.remove(), 6000);
}
export function downloadCsv(fileName, headers, rows) {
  const csv = '\ufeff' + [headers, ...rows].map(row => row.map(value => {
    let string = String(value ?? '');
    // Spreadsheet applications interpret formula prefixes even in quoted CSV cells.
    if (/^[=+\-@\t\r]/.test(string)) string = "'" + string;
    return `"${string.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  const anchor = document.createElement('a'); anchor.href=url; anchor.download=fileName; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
export function reportDateRange(period, now = new Date()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  // UTC noon provides a calendar date for arithmetic, independent of browser timezone.
  const start=new Date(today+'T12:00:00Z');
  if (period === 'week') start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
  if (period === 'month') start.setUTCDate(1);
  if (period === 'quarter') {start.setUTCDate(1);start.setUTCMonth(Math.floor(start.getUTCMonth()/3)*3);}
  return {receivedFrom:start.toISOString().slice(0,10),receivedTo:today};
}
export function icon(name) {
  const paths = {
    dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    cases:'M4 4h6l2 3h8v13H4z M4 10h16', alerts:'M12 3 2 21h20L12 3z M12 9v5 M12 17h.01',
    sources:'M9 4H4v5 M15 4h5v5 M4 15v5h5 M20 15v5h-5 M9 9h6v6H9z',
    building:'M4 21V5l8-3 8 3v16 M9 21v-4h6v4 M8 8h1 M15 8h1 M8 12h1 M15 12h1',
    users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.8 M16 3.2a4 4 0 0 1 0 7.6',
    import:'M12 3v12 M7 10l5 5 5-5 M3 15v6h18v-6', reports:'M4 3h12l4 4v14H4z M8 16v-4 M12 16V9 M16 16v-6',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
    sync:'M20 7a8 8 0 0 0-14-2L3 8 M3 3v5h5 M4 17a8 8 0 0 0 14 2l3-3 M16 16h5v5',
    audit:'M4 3h16v18H4z M8 7h8 M8 12h8 M8 17h5', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
    logout:'M9 3H3v18h6 M13 8l5 4-5 4 M7 12h11', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
    shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4z M8 12l3 3 5-6', menu:'M3 6h18 M3 12h18 M3 18h18'
  };
  return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.cases}"/></svg>`;
}
