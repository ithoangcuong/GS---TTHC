import { parseTimestamp } from '../shared/normalize.mjs';
import { sourceById } from '../adapters/source-registry.mjs';

export const COLLECTOR_STATUSES = Object.freeze(['NEW', 'RECEIVED', 'PROCESSING',
  'WAITING_ADDITIONAL_DOCUMENTS', 'PAUSED', 'TRANSFERRED', 'COMPLETED', 'RETURNED',
  'CANCELLED', 'OVERDUE', 'UNKNOWN']);
export const COLLECTOR_FIELDS = Object.freeze(['sourceSystem', 'sourceName', 'sourceRecordId', 'sourceCaseId',
  'caseCode', 'procedureCode', 'procedureName', 'submittedAt', 'receivedAt', 'originalDueAt', 'dueAt',
  'effectiveDueAt', 'extensionDueAt', 'extensionConfirmed', 'completedAt', 'agencyId', 'agencyName',
  'departmentId', 'departmentName', 'officerId', 'officerName', 'sourceStatus', 'normalizedStatus',
  'currentStep', 'totalSteps', 'lastObservedAt']);
const DATES = new Set(['submittedAt', 'receivedAt', 'originalDueAt', 'dueAt', 'effectiveDueAt',
  'extensionDueAt', 'completedAt', 'lastObservedAt']);
const INTEGERS = new Set(['currentStep', 'totalSteps']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Closed collector boundary: no applicant identity, arbitrary metadata or server derived values. */
export function normalizeCollectorCase(raw, sourceSystem, { statusMappings, observedAt } = {}) {
  const source = sourceById(sourceSystem);
  if (!source || !plain(raw)) throw new Error('Hồ sơ/nguồn thu thập không hợp lệ.');
  const unexpected = Object.keys(raw).find(key => !COLLECTOR_FIELDS.includes(key));
  if (unexpected) throw new Error('Hồ sơ chứa trường ngoài danh sách giám sát được phép.');
  if (JSON.stringify(raw).length > 20000) throw new Error('Hồ sơ vượt giới hạn 20KB.');
  if (raw.sourceSystem !== undefined && raw.sourceSystem !== sourceSystem) throw new Error('sourceSystem không khớp nguồn batch.');
  if (statusMappings !== undefined && (!plain(statusMappings) || Object.keys(statusMappings).length > 100
    || Object.entries(statusMappings).some(([label, status]) => label.length > 200 || !COLLECTOR_STATUSES.includes(status)))) throw new Error('Status mapping không hợp lệ.');
  const record = { sourceSystem, sourceName: source.name };
  for (const key of COLLECTOR_FIELDS) {
    if (!own(raw, key) || key === 'sourceSystem' || key === 'sourceName') continue;
    const value = raw[key];
    if (key === 'extensionConfirmed') {
      if (typeof value !== 'boolean') throw new Error('Xác nhận gia hạn phải là boolean.');
      record[key] = value; continue;
    }
    if (value === null) { record[key] = null; continue; }
    if (DATES.has(key)) { record[key] = parseTimestamp(value); continue; }
    if (INTEGERS.has(key)) {
      const integer = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
      if (!Number.isSafeInteger(integer) || integer < 0 || integer > 10000) throw new Error('Số bước xử lý không hợp lệ.');
      record[key] = integer; continue;
    }
    const limit = /(?:Id|Code)$/.test(key) ? 200 : 1000;
    if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f]/.test(value)) throw new Error('Trường hồ sơ sai kiểu, chứa ký tự điều khiển hoặc vượt giới hạn độ dài.');
    record[key] = value.trim();
  }
  if (!record.caseCode || record.caseCode.length > 200) throw new Error('Mã hồ sơ bắt buộc, tối đa 200 ký tự.');
  if (own(record, 'sourceStatus') && statusMappings !== undefined) record.normalizedStatus = own(statusMappings, record.sourceStatus)
    ? statusMappings[record.sourceStatus] : 'UNKNOWN';
  else if (own(record, 'sourceStatus') && !own(record, 'normalizedStatus')) record.normalizedStatus = 'UNKNOWN';
  else if (own(record, 'normalizedStatus') && !COLLECTOR_STATUSES.includes(record.normalizedStatus)) throw new Error('Trạng thái chuẩn không hợp lệ.');
  for (const [earlier, later] of [['submittedAt', 'receivedAt'], ['submittedAt', 'completedAt'], ['receivedAt', 'completedAt']]) {
    if (record[earlier] && record[later] && Date.parse(record[later]) < Date.parse(record[earlier])) throw new Error('Thời gian hồ sơ không nhất quán.');
  }
  if (Number.isSafeInteger(record.currentStep) && Number.isSafeInteger(record.totalSteps)
    && record.currentStep > record.totalSteps) throw new Error('Bước hiện tại lớn hơn tổng số bước.');
  if (record.extensionDueAt && record.extensionConfirmed !== true) throw new Error('Chỉ nhận ngày gia hạn được nguồn xác nhận.');
  const officialDue = record.dueAt || record.originalDueAt;
  if (record.effectiveDueAt && record.effectiveDueAt !== officialDue
    && !(record.extensionConfirmed === true && record.effectiveDueAt === record.extensionDueAt)) throw new Error('Ngày hạn hiệu lực phải khớp ngày hẹn hoặc ngày gia hạn được nguồn xác nhận.');
  if (observedAt !== undefined) record.lastObservedAt = parseTimestamp(observedAt);
  if (!record.lastObservedAt) throw new Error('Cần thời gian quan sát hồ sơ.');
  if (Date.parse(record.lastObservedAt) > Date.now() + 5 * 60 * 1000) throw new Error('Thời gian quan sát vượt quá thời gian hiện tại.');
  return record;
}
