import { SOURCES, sourceById } from './registry.mjs';

export const STATUSES = Object.freeze(['NEW', 'RECEIVED', 'PROCESSING', 'WAITING_ADDITIONAL_DOCUMENTS',
  'WAITING_FOR_CITIZEN', 'PAUSED', 'TRANSFERRED', 'COMPLETED', 'RETURNED', 'CANCELLED', 'OVERDUE', 'UNKNOWN']);
export const CANONICAL_FIELDS = Object.freeze(['id', 'sourceSystem', 'sourceName', 'sourceRecordId', 'sourceCaseId',
  'sourceUrl', 'caseCode', 'procedureCode', 'procedureName', 'submittedAt', 'receivedAt', 'originalDueAt', 'dueAt',
  'extensionDueAt', 'completedAt', 'applicantName', 'agencyId', 'agencyName', 'departmentId', 'departmentName',
  'officerId', 'officerName', 'sourceStatus', 'normalizedStatus', 'currentStep', 'totalSteps', 'currentStepStartedAt',
  'lastSourceUpdateAt', 'lastSyncedAt', 'remainingSeconds', 'isOverdue', 'overdueSeconds', 'alertLevel', 'riskScore',
  'riskReasons', 'pauseStartedAt', 'totalPausedSeconds', 'metadata', 'createdAt', 'updatedAt']);
const DATE_FIELDS = ['submittedAt', 'receivedAt', 'originalDueAt', 'dueAt', 'extensionDueAt', 'completedAt',
  'currentStepStartedAt', 'lastSourceUpdateAt', 'pauseStartedAt'];
const INTEGER_FIELDS = ['currentStep', 'totalSteps', 'totalPausedSeconds'];
const SERVER_FIELDS = new Set(['id', 'lastSyncedAt', 'remainingSeconds', 'isOverdue', 'overdueSeconds', 'alertLevel',
  'riskScore', 'riskReasons', 'createdAt', 'updatedAt']);
const INPUT_FIELDS = CANONICAL_FIELDS.filter(field => !SERVER_FIELDS.has(field));
const TEXT_FIELDS = INPUT_FIELDS.filter(field => !DATE_FIELDS.includes(field) && !INTEGER_FIELDS.includes(field) && field !== 'metadata');
const SECRET_KEY = /(?:password|passwd|passphrase|cookie|session|token|authorization|secret|otp|credential|privatekey|csrf|xsrf|apikey)/i;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export const DEFAULT_STATUS_MAPPINGS = Object.freeze(Object.fromEntries(SOURCES.map(source => [source.id,
  Object.freeze(source.id === 'TPHCM' ? { 'Đang xử lý': 'PROCESSING', 'Đã tiếp nhận': 'RECEIVED', 'Đã trả kết quả': 'COMPLETED' } : {})])));
export const DEFAULT_FIELD_MAPPINGS = Object.freeze(Object.fromEntries(SOURCES.map(source => [source.id,
  Object.freeze(source.id === 'TPHCM' ? { maHoSo: 'caseCode', ngayHenTra: 'dueAt', nguoiXuLy: 'officerName', trangThai: 'sourceStatus' } : {})])));

/** Reject ambiguous/local/date-only timestamps. Vietnamese portal dates explicitly use UTC+07. */
export function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('Timestamp phải là chuỗi có múi giờ hoặc DD/MM/YYYY HH:mm:ss.');
  const input = value.trim();
  if (!input) return null;
  const vietnamese = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(input);
  let iso = input;
  if (vietnamese) {
    const [, day, month, year, hours, minutes, seconds] = vietnamese;
    iso = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+07:00`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!match) throw new Error('Timestamp thiếu thời gian/múi giờ hoặc sai định dạng.');
  const [, year, month, day, hour, minute, second, , zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23
    || Number(minute) > 59 || Number(second) > 59) throw new Error('Timestamp chứa ngày/giờ không hợp lệ.');
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3)), offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) throw new Error('Múi giờ không hợp lệ.');
  }
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) throw new Error('Timestamp không hợp lệ.');
  return new Date(timestamp).toISOString();
}

function metadataErrors(value, path = 'metadata', depth = 0, seen = new Set()) {
  if (depth > 8) return [`${path}: vượt quá 8 mức lồng nhau`];
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path}: số không hợp lệ`];
  if (!Array.isArray(value) && !plain(value)) return [`${path}: phải là dữ liệu JSON`];
  if (seen.has(value)) return [`${path}: tham chiếu vòng`];
  seen.add(value);
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    const compact = key.replace(/[^a-z0-9]/gi, '');
    if (RESERVED.has(key) || SECRET_KEY.test(compact)) errors.push(`${path}.${key}: không được gửi thông tin xác thực`);
    else errors.push(...metadataErrors(child, `${path}.${key}`, depth + 1, seen));
  }
  seen.delete(value);
  return errors;
}

export function validateCase(record) {
  if (!plain(record)) return ['Hồ sơ phải là một JSON object.'];
  const errors = [];
  const source = sourceById(record.sourceSystem);
  if (!source) errors.push('sourceSystem: nguồn không được đăng ký');
  if (typeof record.caseCode !== 'string' || !record.caseCode.trim()) errors.push('caseCode: bắt buộc');
  for (const field of TEXT_FIELDS) {
    if (!own(record, field) || record[field] === null) continue;
    if (typeof record[field] !== 'string' || record[field].length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(record[field])) {
      errors.push(`${field}: phải là chuỗi tối đa 1000 ký tự, không chứa ký tự điều khiển`);
    }
  }
  if (record.normalizedStatus !== undefined && !STATUSES.includes(record.normalizedStatus)) errors.push('normalizedStatus: không hợp lệ');
  for (const field of DATE_FIELDS) {
    if (!own(record, field) || record[field] === null) continue;
    try { parseTimestamp(record[field]); } catch (error) { errors.push(`${field}: ${error.message}`); }
  }
  for (const [earlier, later] of [['submittedAt', 'receivedAt'], ['submittedAt', 'completedAt'], ['receivedAt', 'completedAt']]) {
    if (record[earlier] && record[later] && Date.parse(record[later]) < Date.parse(record[earlier])) errors.push(`${later}: trước ${earlier}; cần kiểm tra dữ liệu nguồn`);
  }
  for (const field of INTEGER_FIELDS) {
    if (!own(record, field) || record[field] === null) continue;
    if (!Number.isSafeInteger(record[field]) || record[field] < 0) errors.push(`${field}: phải là số nguyên không âm`);
  }
  if (Number.isSafeInteger(record.currentStep) && Number.isSafeInteger(record.totalSteps) && record.currentStep > record.totalSteps) {
    errors.push('currentStep: lớn hơn totalSteps');
  }
  if (record.sourceUrl !== undefined && record.sourceUrl !== null) {
    try {
      const url = new URL(record.sourceUrl);
      if (url.protocol !== 'https:' || !source?.supportedHosts.includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) {
        errors.push('sourceUrl: phải thuộc đúng HTTPS hostname nguồn, không có credentials/query/hash');
      }
    } catch { errors.push('sourceUrl: URL không hợp lệ'); }
  }
  if (own(record, 'metadata') && record.metadata !== null) {
    if (!plain(record.metadata)) errors.push('metadata: phải là JSON object');
    else {
      errors.push(...metadataErrors(record.metadata));
      try { if (JSON.stringify(record.metadata).length > 16384) errors.push('metadata: vượt quá 16KB'); }
      catch { errors.push('metadata: JSON không hợp lệ'); }
    }
  }
  return errors;
}

function mappedValue(raw, path) {
  let current = raw;
  for (const key of path.split('.')) {
    if (RESERVED.has(key) || !plain(current) || !own(current, key)) return { found: false };
    current = current[key];
  }
  return { found: true, value: current };
}

/** Source fields only; deadline/risk/audit values are calculated by the central server. */
export function normalizeCase(raw, sourceSystem, { fieldMappings, statusMappings } = {}) {
  const source = sourceById(sourceSystem);
  if (!source) throw new Error('Nguồn chưa được đăng ký.');
  if (!plain(raw)) throw new Error('Hồ sơ phải là JSON object.');
  if (raw.sourceSystem !== undefined && raw.sourceSystem !== sourceSystem) throw new Error('sourceSystem không khớp nguồn batch.');
  const record = {};
  for (const field of INPUT_FIELDS) if (own(raw, field)) record[field] = raw[field];
  const mapping = fieldMappings ?? DEFAULT_FIELD_MAPPINGS[sourceSystem];
  if (!plain(mapping)) throw new Error('fieldMappings phải là sourceField → canonicalField.');
  for (const [from, to] of Object.entries(mapping)) {
    if (typeof from !== 'string' || typeof to !== 'string' || !INPUT_FIELDS.includes(to) || ['sourceSystem', 'sourceName', 'normalizedStatus'].includes(to)) {
      throw new Error('Field mapping không hợp lệ.');
    }
    if (own(record, to)) continue;
    const mapped = mappedValue(raw, from);
    if (mapped.found) record[to] = mapped.value;
  }
  record.sourceSystem = sourceSystem;
  record.sourceName = source.name;
  for (const field of TEXT_FIELDS) if (typeof record[field] === 'string') record[field] = record[field].trim();
  for (const field of DATE_FIELDS) if (own(record, field)) record[field] = parseTimestamp(record[field]);
  for (const field of INTEGER_FIELDS) {
    if (typeof record[field] === 'string' && /^\d+$/.test(record[field])) record[field] = Number(record[field]);
  }
  if (record.sourceUrl !== undefined && record.sourceUrl !== null) {
    const url = new URL(record.sourceUrl);
    if (url.protocol !== 'https:' || !source.supportedHosts.includes(url.hostname) || url.port || url.username || url.password) throw new Error('sourceUrl không thuộc nguồn đã chọn.');
    url.search = ''; url.hash = ''; record.sourceUrl = url.toString();
  }
  const statuses = statusMappings ?? DEFAULT_STATUS_MAPPINGS[sourceSystem];
  if (!plain(statuses) || Object.values(statuses).some(value => !STATUSES.includes(value))) throw new Error('Status mapping không hợp lệ.');
  if (own(record, 'sourceStatus') && own(statuses, record.sourceStatus)) record.normalizedStatus = statuses[record.sourceStatus];
  else if (!STATUSES.includes(record.normalizedStatus) && (own(record, 'sourceStatus') || own(record, 'normalizedStatus'))) record.normalizedStatus = 'UNKNOWN';
  const errors = validateCase(record);
  if (errors.length) throw new Error(errors.join('; '));
  return record;
}
