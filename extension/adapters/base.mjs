import { sourceById } from './source-registry.mjs';
import { validateMocProfile } from './moc-profile.mjs';
import { parseTimestamp } from '../shared/normalize.mjs';
import { COLLECTOR_FIELDS, COLLECTOR_STATUSES, normalizeCollectorCase } from '../normalizer/case-normalizer.mjs';

// Legacy label examples for parser tests only; never used as a default extraction mapping.
export const TPHCM_HEADER_MAPPINGS = Object.freeze({
  'Mã số hồ sơ': 'caseCode', 'Mã hồ sơ': 'caseCode', 'Mã thủ tục': 'procedureCode',
  'Thủ tục': 'procedureName', 'Tên thủ tục': 'procedureName', 'Ngày nộp': 'submittedAt',
  'Ngày tiếp nhận': 'receivedAt', 'Ngày hẹn trả': 'dueAt',
  'Cơ quan thực hiện': 'agencyName', 'Cán bộ xử lý': 'officerName', 'Trạng thái': 'sourceStatus',
});
export const READABLE_FIELDS = new Set(['sourceRecordId', 'sourceCaseId', 'caseCode', 'procedureCode', 'procedureName',
  'submittedAt', 'receivedAt', 'originalDueAt', 'dueAt', 'completedAt',
  'agencyId', 'agencyName', 'departmentId', 'departmentName', 'officerId', 'officerName', 'sourceStatus',
  'currentStep', 'totalSteps']);
const TEXT = text => String(text ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function validateAdapterConfig(config, sourceSystem) {
  const source = sourceById(sourceSystem);
  if (!source || !plain(config) || config.sourceSystem !== sourceSystem) throw new Error('Cấu hình nguồn không hợp lệ.');
  if (config.profile !== undefined) return validateMocProfile(config);
  const allowedKeys = ['sourceSystem', 'verified', 'evidence', 'listUrl', 'loggedInSelector', 'loggedOutSelector',
    'tableSelector', 'headerSelector', 'rowSelector', 'cellSelector', 'headerMappings', 'statusMappings'];
  if (Object.keys(config).some(key => !allowedKeys.includes(key)) || (plain(config.evidence)
    && Object.keys(config.evidence).some(key => !['reference', 'verifiedAt'].includes(key)))) throw new Error('Cấu hình chứa trường không được phép; không lưu thông tin xác thực.');
  if (config.verified !== true || !plain(config.evidence) || typeof config.evidence.reference !== 'string'
    || config.evidence.reference.trim().length < 10 || typeof config.evidence.verifiedAt !== 'string') {
    throw new Error('Cần evidence.reference, evidence.verifiedAt và verified=true sau khi kiểm chứng DOM/đăng nhập.');
  }
  if (!parseTimestamp(config.evidence.verifiedAt)) throw new Error('Ngày kiểm chứng không hợp lệ.');
  if (config.evidence.reference.length > 1000 || Date.parse(config.evidence.verifiedAt) > Date.now() + 300000) throw new Error('Bằng chứng kiểm chứng không hợp lệ.');
  let listUrl;
  try { listUrl = new URL(config.listUrl); } catch { throw new Error('Cần URL danh sách thực tế.'); }
  if (listUrl.protocol !== 'https:' || !source.supportedHosts.includes(listUrl.hostname)
    || listUrl.port || listUrl.username || listUrl.password || listUrl.search || listUrl.hash) throw new Error('URL danh sách phải thuộc chính xác nguồn và không chứa credentials/query/hash.');
  for (const field of ['loggedInSelector', 'tableSelector', 'headerSelector', 'rowSelector', 'cellSelector']) {
    if (typeof config[field] !== 'string' || !config[field].trim() || config[field].length > 500) throw new Error(`Thiếu selector đã kiểm chứng: ${field}.`);
  }
  if (config.loggedOutSelector !== undefined && (typeof config.loggedOutSelector !== 'string' || config.loggedOutSelector.length > 500)) throw new Error('loggedOutSelector không hợp lệ.');
  if (!plain(config.headerMappings)) throw new Error('Nguồn này cần mapping header được kiểm chứng từ mẫu thực tế.');
  const mappings = config.headerMappings;
  if (Object.keys(mappings).length > 60 || Object.entries(mappings).some(([header, field]) => !header.trim() || header.length > 200 || !COLLECTOR_FIELDS.includes(field) || !READABLE_FIELDS.has(field))) {
    throw new Error('Mapping chỉ được đọc các trường hồ sơ được phép.');
  }
  if (!Object.values(mappings).includes('caseCode')) throw new Error('Header mapping thiếu caseCode.');
  if (config.statusMappings !== undefined && (!plain(config.statusMappings)
    || Object.keys(config.statusMappings).length > 100
    || Object.entries(config.statusMappings).some(([status, value]) => !status.trim() || status.length > 200 || !COLLECTOR_STATUSES.includes(value)))) throw new Error('Status mapping không hợp lệ.');
  return { ...config, listUrl: listUrl.toString(), headerMappings: { ...mappings } };
}

export function recordsFromCells(headers, rows, mappings) {
  const columns = headers.map(header => Object.prototype.hasOwnProperty.call(mappings, TEXT(header)) ? mappings[TEXT(header)] : null);
  if (!columns.includes('caseCode')) throw new Error('Bảng hiện tại không có header mã hồ sơ đã cấu hình.');
  const missing = [...new Set(Object.values(mappings))].filter(field => !columns.includes(field));
  if (missing.length) throw new Error(`Bảng thiếu cột đã cấu hình: ${missing.join(', ')}. Kiểm tra lại bảng hoặc mapping.`);
  const mapped = columns.filter(Boolean);
  if (new Set(mapped).size !== mapped.length) throw new Error('Các header trùng canonical field; cần sửa cấu hình.');
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) return { index, error: 'Số ô khác số header; bảng có thể đã thay đổi hoặc chứa colspan.' };
    const record = {};
    columns.forEach((field, column) => { if (field) record[field] = TEXT(cells[column]) || null; });
    return { index, record };
  });
}

export function visible(element) {
  if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true' || element.getClientRects().length === 0) return false;
  const view = element.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(element);
  return !style || (style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none' && style.opacity !== '0');
}
export function visibleText(element) {
  // innerText excludes non-rendered descendant text; no input values or attributes are read.
  return typeof element.innerText === 'string' ? element.innerText : element.textContent;
}

export class SourceAdapter {
  constructor(sourceSystem, config = null) { this.source = sourceById(sourceSystem); this.config = config; }
  getSourceId() { return this.source.id; }
  getSourceName() { return this.source.name; }
  getSupportedHosts() { return this.source.supportedHosts; }
  isSupportedPage(url) {
    if (!this.config) return false;
    const actual = new URL(url), expected = new URL(this.config.listUrl);
    return !actual.username && !actual.password && !actual.port
      && actual.origin === expected.origin && actual.pathname === expected.pathname;
  }
  detectLoginState(document) {
    if (!this.config) return 'UNVERIFIED';
    if (this.config.loggedOutSelector && visible(document.querySelector(this.config.loggedOutSelector))) return 'NOT_LOGGED_IN';
    return visible(document.querySelector(this.config.loggedInSelector)) ? 'AUTHENTICATED' : 'UNVERIFIED';
  }
  detectCaseList(document) {
    if (!this.config) return null;
    const table = document.querySelector(this.config.tableSelector);
    if (!table || table.tagName !== 'TABLE' || !visible(table)) return null;
    return table;
  }
  extractCases(document, url) {
    this.config = validateAdapterConfig(this.config, this.source.id);
    if (!this.isSupportedPage(url)) throw new Error('Trang hiện tại không phải URL danh sách đã kiểm chứng.');
    if (this.detectLoginState(document) !== 'AUTHENTICATED') throw new Error('Chưa xác nhận được phiên đăng nhập hợp lệ.');
    const table = this.detectCaseList(document);
    if (!table) throw new Error('Không tìm thấy TABLE hồ sơ đã kiểm chứng.');
    const headerNodes = Array.from(table.querySelectorAll(this.config.headerSelector));
    const rowNodes = Array.from(table.querySelectorAll(this.config.rowSelector)).filter(visible);
    if (headerNodes.length === 0 || headerNodes.length > 60 || rowNodes.length > 2000) throw new Error('Bảng vượt giới hạn hoặc không có header; cần phân trang thủ công.');
    if (headerNodes.some(node => !visible(node))) throw new Error('Header phải đang hiển thị trên trang được phép.');
    const headers = headerNodes.map(visibleText);
    const readableColumns = headers.map(header => Object.prototype.hasOwnProperty.call(this.config.headerMappings, TEXT(header)));
    const rows = rowNodes.map(row =>
      Array.from(row.querySelectorAll(this.config.cellSelector), (cell, index) => {
        // Do not read textContent of unmapped columns: these may contain applicant PII.
        if (!readableColumns[index]) return '';
        if (!visible(cell)) throw new Error('Ô dữ liệu đã cấu hình không đang hiển thị.');
        return visibleText(cell);
      }));
    const candidates = recordsFromCells(headers, rows, this.config.headerMappings);
    const records = [], errors = [], observedAt = new Date().toISOString();
    for (const candidate of candidates) {
      if (candidate.error) { errors.push({ index: candidate.index, error: candidate.error }); continue; }
      try { records.push(this.normalizeCase(candidate.record, observedAt)); }
      catch (error) { errors.push({ index: candidate.index, error: error.message }); }
    }
    return { records, errors, total: rows.length, scope: 'CURRENT_PAGE_ONLY' };
  }
  normalizeCase(raw, observedAt = new Date().toISOString()) {
    return normalizeCollectorCase(raw, this.source.id, { statusMappings: this.config?.statusMappings ?? {}, observedAt });
  }
  mapStatus(status) { return this.normalizeCase({ caseCode: 'mapping-check', sourceStatus: status }).normalizedStatus; }
  validateCase(record) {
    try { normalizeCollectorCase(record, this.source.id, { statusMappings: this.config?.statusMappings ?? {} }); return []; }
    catch (error) { return [error.message]; }
  }
}

export class WaitingForSampleAdapter extends SourceAdapter {}
