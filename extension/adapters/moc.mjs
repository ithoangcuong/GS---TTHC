import { SourceAdapter, validateAdapterConfig, visible, visibleText } from './base.mjs';
import { MOC_PROFILE } from './moc-profile.mjs';
import { readMocCollectionContext } from '../shared/collection-context.mjs';

const text = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const COLUMNS = ['Mã số hồ sơ', 'Thủ tục', 'Thời gian quy định', 'Cơ quan thực hiện', 'Trạng thái'];
const TABLES = 'mat-table, table, [role="table"], [role="grid"]';
const HEADERS = 'mat-header-cell, th, .mat-header-cell, .mat-mdc-header-cell, [role="columnheader"]';
const ROWS = 'mat-row, tr, .mat-row, .mat-mdc-row, [role="row"]';
const CELLS = 'mat-cell, td, .mat-cell, .mat-mdc-cell, [role="cell"], [role="gridcell"]';
// matColumnDef keys from the public ListSearchComponent, not inferred column positions.
const COLUMN_IDS = { code: 'Mã số hồ sơ', procedureName: 'Thủ tục', processingTime: 'Thời gian quy định',
  agency: 'Cơ quan thực hiện', status: 'Trạng thái' };
function columnId(node) {
  return Object.keys(COLUMN_IDS).find(id => node.classList.contains(`mat-column-${id}`) || node.classList.contains(`cdk-column-${id}`));
}
function columnLabel(node) {
  if (!visible(node)) return '';
  const id = columnId(node);
  if (id) return COLUMN_IDS[id];
  return text(visibleText(node)).replace(/[\u200b-\u200d\ufeff]/g, '');
}
function ownedNodes(parent, selector, ownerSelector) {
  return Array.from(parent.querySelectorAll(selector)).filter(node => node.closest(ownerSelector) === parent);
}

export function parseMocCells(cells) {
  // The portal can append this known source label to the primary case code.
  // Do not strip arbitrary parenthesized text: that may hide ambiguous codes.
  const code = text(cells['Mã số hồ sơ']).replace(/\s*\(Hồ sơ của PMCN\)\s*$/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(code)) throw new Error('Không nhận diện được mã hồ sơ MOC.');
  const record = { caseCode: code };
  const procedure = text(cells['Thủ tục']);
  const match = procedure.match(/^(\d+(?:\.\d+)+)\s*(?:-\s*)?(.+)$/);
  if (match) { record.procedureCode = match[1]; record.procedureName = match[2]; }
  else if (procedure) record.procedureName = procedure;
  if (/(?:\.\.\.|…)\s*$/.test(record.procedureName ?? '')) delete record.procedureName;
  // Read labelled official timestamps, never the live countdown.
  const timing = text(cells['Thời gian quy định']);
  const labels = [...timing.matchAll(/(Ngày nộp|Ngày tiếp nhận|Ngày hẹn trả)\s*:/g)];
  const fields = { 'Ngày nộp': 'submittedAt', 'Ngày tiếp nhận': 'receivedAt', 'Ngày hẹn trả': 'dueAt' };
  for (const [index, label] of labels.entries()) {
    const field = fields[label[1]];
    if (Object.hasOwn(record, field)) throw new Error('Trùng nhãn ngày trong hồ sơ MOC.');
    const value = timing.slice(label.index + label[0].length, labels[index + 1]?.index ?? timing.length).trim();
    const date = value.match(/^(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2}:\d{2})(?!\d|:)/);
    if (!date) throw new Error(`Thiếu ngày giờ đầy đủ tại ${label[1]}.`);
    record[field] = `${date[1]} ${date[2]}`;
  }
  if (!record.submittedAt || !record.receivedAt || !record.dueAt) throw new Error('Thiếu ngày nộp, ngày tiếp nhận hoặc ngày hẹn trả chính thức.');
  const agency = text(cells['Cơ quan thực hiện']);
  const parts = agency.match(/^Cơ quan\s*:\s*(.+?)(?:\s*Cán bộ\s*:\s*(.*))?$/);
  if (!parts) throw new Error('Cột Cơ quan thực hiện không đúng bố cục MOC.');
  record.agencyName = parts[1].trim();
  if (parts[2]?.trim()) record.officerName = parts[2].trim();
  record.sourceStatus = text(cells['Trạng thái']);
  if (!record.sourceStatus) throw new Error('Thiếu trạng thái hồ sơ.');
  return record;
}

function readCaseCode(cell) {
  // Public MOC template: primary code is a direct text child of the detail link;
  // nested spans hold nationCode, while sibling nodes can contain applicant data.
  const links = Array.from(cell.children).filter(node => node.tagName === 'A' && visible(node));
  if (!links.length) return visibleText(cell);
  if (links.length !== 1) throw new Error('Ô mã hồ sơ MOC có nhiều liên kết; chưa xác định được mã chính.');
  const value = Array.from(links[0].childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join('');
  if (!value.trim()) throw new Error('Liên kết hồ sơ MOC không hiển thị mã chính theo bố cục đã kiểm chứng.');
  return value;
}

export class MocAdapter extends SourceAdapter {
  constructor(config) { super('MOC', config); }
  extractCases(document, url) {
    if (this.config?.profile !== MOC_PROFILE) return super.extractCases(document, url);
    this.config = validateAdapterConfig(this.config, 'MOC');
    if (!this.isSupportedPage(url)) throw new Error('Mở đúng trang Tra cứu hồ sơ toàn cơ quan Bộ Xây dựng.');
    const root = document.querySelector('app-list-search');
    if (!root || !visible(root)) throw new Error('Chưa thấy màn hình tra cứu đã đăng nhập. Hãy đăng nhập và chờ trang tải xong.');
    const heading = Array.from(root.querySelectorAll('h2')).find(node => visible(node)
      && text(visibleText(node)) === 'Tra cứu hồ sơ toàn cơ quan' && !node.closest('table, mat-table'));
    if (!heading) throw new Error('Chưa thấy tiêu đề Tra cứu hồ sơ toàn cơ quan. Kiểm tra phiên đăng nhập và trang đang mở.');
    if (Array.from(root.querySelectorAll('mat-progress-spinner, mat-spinner, mat-progress-bar, [aria-busy="true"]')).some(visible)) {
      throw Object.assign(new Error('Danh sách đang tải. Chờ hoàn tất rồi đọc lại.'), { code: 'COLLECTOR_LOADING' });
    }
    const tables = Array.from(root.querySelectorAll(TABLES)).map(table => {
      const nodes = ownedNodes(table, HEADERS, TABLES);
      return { table, nodes, headers: nodes.map(columnLabel) };
    }).filter(item => item.nodes.some(visible));
    const candidates = tables.filter(item => COLUMNS.every(label => item.headers.includes(label)));
    if (candidates.length !== 1) {
      const detail = tables.slice(0, 5).map((item, index) => {
        const missing = COLUMNS.filter(label => !item.headers.includes(label));
        return `Bảng ${index + 1}: ${item.nodes.length} cột, ${missing.length ? `thiếu ${missing.join(', ')}` : 'đủ cột'}`;
      }).join('; ');
      throw new Error(`MOC: tìm thấy ${tables.length} bảng có tiêu đề hiển thị, ${candidates.length} bảng đủ cột. ${detail || 'Chưa thấy tiêu đề bảng trong màn hình tra cứu.'} Hãy gửi lại thông báo này để kiểm tra bố cục.`);
    }
    const { table, nodes, headers } = candidates[0];
    if (nodes.length > 60 || COLUMNS.some(label => headers.filter(header => header === label).length !== 1)) {
      throw new Error('Bảng MOC có cột trùng hoặc vượt giới hạn.');
    }
    const dataRows = ownedNodes(table, ROWS, TABLES).filter(row => !row.querySelector(HEADERS) && row.querySelector(CELLS));
    const rows = dataRows.filter(visible);
    if (rows.length > 2000) throw new Error('Bảng vượt giới hạn 2.000 dòng; hãy phân trang thủ công.');
    const records = [], errors = [], observedAt = new Date().toISOString();
    const collectionContext = readMocCollectionContext(root, observedAt);
    for (const [index, row] of rows.entries()) {
      try {
        const cellsInRow = ownedNodes(row, CELLS, ROWS);
        const cells = {};
        for (const label of COLUMNS) {
          const headerIndex = headers.indexOf(label);
          const id = columnId(nodes[headerIndex]);
          const matches = id ? cellsInRow.filter(cell => columnId(cell) === id) : [];
          if (id && matches.length !== 1) throw new Error(`Cột ${label} không có ô dữ liệu duy nhất.`);
          if (!id && cellsInRow.length !== headers.length) throw new Error('Số ô khác số cột; bảng đang thay đổi hoặc có dòng thông báo.');
          const cell = id ? matches[0] : cellsInRow[headerIndex];
          if (!visible(cell) || cell.colSpan > 1 || cell.rowSpan > 1) throw new Error('Ô giám sát bị ẩn hoặc gộp.');
          cells[label] = label === 'Mã số hồ sơ' ? readCaseCode(cell) : visibleText(cell);
        }
        records.push(this.normalizeCase(parseMocCells(cells), observedAt));
      } catch (error) { errors.push({ index, error: error.message }); }
    }
    const emptyMessage = rows.length ? undefined : dataRows.length
      ? `MOC: nhận diện đúng bảng nhưng ${dataRows.length} dòng dữ liệu đang bị ẩn. Hãy mở danh sách hồ sơ trên trang nguồn.`
      : 'MOC: nhận diện đúng bảng và đủ 5 cột giám sát nhưng bảng không có dòng dữ liệu. Bấm Tìm kiếm trên cổng MOC để hiện hồ sơ; nếu vẫn thấy hồ sơ, hãy tải lại trang để cập nhật bộ đọc.';
    return { records, errors, total: rows.length, emptyMessage, collectionContext, scope: 'CURRENT_PAGE_ONLY' };
  }
}
