import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

// All limits apply before allocation or decompression where possible.
export const IMPORT_LIMITS = Object.freeze({ uploadBytes: 10 * 1024 * 1024, expandedBytes: 32 * 1024 * 1024, entries: 2000, rows: 10000, columns: 200 });
const decoder = new TextDecoder('utf-8', { fatal: true });
const fail = message => { throw new Error(message); };
const readUtf8 = (buffer, label = 'Tệp') => {
  try { return decoder.decode(buffer).replace(/^\uFEFF/, ''); }
  catch { fail(`${label} phải có mã hóa UTF-8 hợp lệ.`); }
};

function decodeUpload(base64) {
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(IMPORT_LIMITS.uploadBytes / 3) * 4) fail('Tệp không hợp lệ hoặc vượt quá giới hạn 10 MB.');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  if (base64.length / 4 * 3 - padding > IMPORT_LIMITS.uploadBytes) fail('Tệp vượt quá giới hạn 10 MB.');
  const firstEqual = base64.indexOf('=');
  if (base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64) || firstEqual !== -1 && firstEqual !== base64.length - padding) fail('Dữ liệu base64 không hợp lệ.');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > IMPORT_LIMITS.uploadBytes) fail('Tệp vượt quá giới hạn 10 MB.');
  return buffer;
}

export function parseFile(fileName, base64) {
  const buffer = decodeUpload(base64);
  const extension = path.extname(String(fileName)).toLowerCase();
  if (extension === '.csv') return tableResult(parseCsv(readUtf8(buffer)));
  if (extension === '.xlsx') return tableResult(parseXlsx(buffer));
  fail('Chỉ hỗ trợ tệp CSV UTF-8 hoặc XLSX.');
}

function tableResult(table) {
  // Ignore physically empty rows, while preserving empty cells within data rows.
  const meaningful = table.filter(row => row.some(value => value !== '' && value !== null && value !== undefined));
  if (!meaningful.length) fail('Tệp không có dữ liệu.');
  const width = Math.max(...meaningful.map(row => row.length));
  if (width > IMPORT_LIMITS.columns) fail('Tệp vượt quá giới hạn 200 cột.');
  const headers = Array.from({ length: width }, (_, index) => String(meaningful[0][index] ?? '').trim());
  const rows = meaningful.slice(1).map(row => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  if (rows.length > IMPORT_LIMITS.rows) fail('Tệp vượt quá giới hạn 10.000 dòng dữ liệu.');
  return { headers, rows, totalRows: rows.length };
}

function guessDelimiter(text) {
  // Count delimiters across the first logical record, excluding quoted fields.
  let quoted = false, seen = false;
  const counts = new Map([[',', 0], [';', 0], ['\t', 0]]);
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      seen = true;
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === '\r' || char === '\n') {
        if (seen) break;
      } else if (counts.has(char)) counts.set(char, counts.get(char) + 1);
    }
    if (char !== '\r' && char !== '\n') seen = true;
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0][0];
}

function parseCsv(text) {
  if (text.includes('\0')) fail('CSV chứa ký tự không hợp lệ.');
  const delimiter = guessDelimiter(text);
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => {
    row.push(field);
    if (row.length > IMPORT_LIMITS.columns) fail('Tệp vượt quá giới hạn 200 cột.');
    field = ''; closed = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row); row = [];
    if (rows.length > IMPORT_LIMITS.rows + 1) fail('Tệp vượt quá giới hạn 10.000 dòng dữ liệu.');
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else field += char;
      continue;
    }
    if (char === delimiter) pushField();
    else if (char === '\n' || char === '\r') {
      pushRow();
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else if (char === '"') {
      if (field || closed) fail('CSV có dấu ngoặc kép sai vị trí.');
      quoted = true;
    } else {
      if (closed) fail('CSV có ký tự sau trường đã đóng ngoặc kép.');
      field += char;
    }
  }
  if (quoted) fail('CSV có trường chưa đóng ngoặc kép.');
  if (field || row.length || closed) pushRow();
  return rows;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}
export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safeZipName(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(part => part === '..' || part === '.')) fail('XLSX chứa đường dẫn ZIP không an toàn.');
  return name;
}

function unzip(buffer) {
  if (buffer.length < 22) fail('XLSX không phải tệp ZIP hợp lệ.');
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50 && index + 22 + buffer.readUInt16LE(index + 20) === buffer.length) { end = index; break; }
  }
  if (end < 0) fail('XLSX không phải tệp ZIP hợp lệ.');
  const entryCount = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12), centralOffset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== entryCount || entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) fail('Không hỗ trợ ZIP nhiều phần hoặc ZIP64.');
  if (entryCount > IMPORT_LIMITS.entries) fail('XLSX chứa quá 2.000 mục ZIP.');
  if (centralOffset + centralSize !== end) fail('Thư mục ZIP bị lỗi.');
  const entries = new Map();
  let cursor = centralOffset, expanded = 0;
  const spans = [];
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) fail('Thư mục ZIP bị lỗi.');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if (flags & 1 || flags & 0x40) fail('Không hỗ trợ XLSX được mã hóa.');
    if (method !== 0 && method !== 8) fail('XLSX dùng phương pháp nén không được hỗ trợ.');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || buffer.readUInt16LE(cursor + 34)) fail('Không hỗ trợ ZIP64 hoặc ZIP nhiều phần.');
    if (cursor + 46 + nameLength + extraLength + commentLength > end) fail('Thư mục ZIP bị lỗi.');
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeZipName(readUtf8(nameBytes, 'Tên mục ZIP'));
    if (entries.has(name)) fail('XLSX có mục ZIP trùng tên.');
    expanded += size;
    if (expanded > IMPORT_LIMITS.expandedBytes) fail('XLSX giải nén vượt quá giới hạn 32 MB.');
    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) fail('Mục ZIP bị lỗi.');
    const localNameLength = buffer.readUInt16LE(localOffset + 26), localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (buffer.readUInt16LE(localOffset + 6) !== flags || buffer.readUInt16LE(localOffset + 8) !== method || !buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes) || start + compressedSize > centralOffset) fail('Mục ZIP không nhất quán.');
    if (!(flags & 8) && (buffer.readUInt32LE(localOffset + 14) !== checksum || buffer.readUInt32LE(localOffset + 18) !== compressedSize || buffer.readUInt32LE(localOffset + 22) !== size)) fail('Kích thước hoặc CRC ZIP không nhất quán.');
    spans.push([localOffset, start + compressedSize]);
    let data;
    try { data = method === 0 ? buffer.subarray(start, start + compressedSize) : inflateRawSync(buffer.subarray(start, start + compressedSize), { maxOutputLength: Math.max(1, size) }); }
    catch { fail('Không thể giải nén mục XLSX hoặc kích thước giải nén không hợp lệ.'); }
    if (data.length !== size || crc32(data) !== checksum) fail('Dữ liệu ZIP bị lỗi CRC hoặc kích thước.');
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) fail('Thư mục ZIP có dữ liệu thừa.');
  spans.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < spans.length; index++) if (spans[index][0] < spans[index - 1][1]) fail('XLSX có các mục ZIP chồng lấn.');
  return entries;
}

// A bounded XML tokenizer for the SpreadsheetML subset. DTDs, external entities,
// and unknown entities are rejected; only the five XML entities/numeric references
// are accepted. There is no network access or entity expansion facility.
function entities(text) {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(text)) fail('XML có tham chiếu thực thể không hợp lệ.');
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, value) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(known, value)) return known[value];
    const code = value.startsWith('#x') ? Number.parseInt(value.slice(2), 16) : Number(value.slice(1));
    if (!(code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff)) fail('XML chứa mã ký tự không hợp lệ.');
    return String.fromCodePoint(code);
  });
}

function parseXml(buffer, expectedRoot) {
  const xml = readUtf8(buffer, 'XML');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(xml)) fail('XML chứa ký tự không hợp lệ.');
  const root = { children: [], text: '', name: '' }, stack = [root];
  let cursor = 0, count = 0;
  while (cursor < xml.length) {
    if (xml[cursor] !== '<') {
      let end = xml.indexOf('<', cursor); if (end < 0) end = xml.length;
      const content = xml.slice(cursor, end);
      if (content.includes(']]>')) fail('XML có chuỗi kết thúc CDATA sai vị trí.');
      stack.at(-1).text += entities(content); cursor = end; continue;
    }
    if (xml.startsWith('<!--', cursor)) {
      const end = xml.indexOf('-->', cursor + 4);
      if (end < 0 || xml.slice(cursor + 4, end).includes('--')) fail('XML có chú thích không hợp lệ.');
      cursor = end + 3; continue;
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      const end = xml.indexOf(']]>', cursor + 9);
      if (end < 0 || stack.length === 1) fail('XML có CDATA không hợp lệ.');
      stack.at(-1).text += xml.slice(cursor + 9, end); cursor = end + 3; continue;
    }
    if (xml.startsWith('<?xml', cursor) && cursor === 0) {
      const end = xml.indexOf('?>', cursor + 5);
      if (end < 0 || !/^<\?xml\s+version\s*=\s*(['"])1\.[01]\1(?:\s+encoding\s*=\s*(['"])UTF-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>$/i.test(xml.slice(cursor, end + 2))) fail('Khai báo XML không hợp lệ hoặc không phải UTF-8.');
      cursor = end + 2; continue;
    }
    if (xml.startsWith('<!', cursor) || xml.startsWith('<?', cursor)) fail('XLSX không cho phép DTD, thực thể hoặc chỉ thị XML.');
    let end = cursor + 1, quote = '';
    for (; end < xml.length; end++) {
      const char = xml[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      else if (char === '<') fail('XML có thẻ không hợp lệ.');
    }
    if (end === xml.length || quote) fail('XML có thẻ chưa đóng.');
    const tag = xml.slice(cursor + 1, end);
    if (tag.startsWith('/')) {
      const match = /^\/([A-Za-z_][\w.:-]*)\s*$/.exec(tag);
      if (!match || stack.length === 1 || stack.at(-1).name !== match[1]) fail('XML có thẻ đóng không khớp.');
      stack.pop();
    } else {
      const match = /^([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)$/.exec(tag);
      if (!match) fail('XML có tên thẻ không hợp lệ.');
      const node = { name: match[1], local: match[1].split(':').at(-1), attrs: Object.create(null), children: [], text: '' };
      let attributes = match[2];
      while (attributes.length) {
        if (/^\s+$/.test(attributes)) break;
        const attr = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(attributes);
        if (!attr || Object.hasOwn(node.attrs, attr[1])) fail('XML có thuộc tính không hợp lệ hoặc trùng lặp.');
        node.attrs[attr[1]] = entities(attr[2] ?? attr[3]); attributes = attributes.slice(attr[0].length);
      }
      if (++count > 1000000 || stack.length > 64) fail('XML vượt quá giới hạn cấu trúc.');
      stack.at(-1).children.push(node);
      if (!match[3]) stack.push(node);
    }
    cursor = end + 1;
  }
  if (stack.length !== 1 || root.children.length !== 1 || root.text.trim()) fail('XML không có cấu trúc hợp lệ.');
  if (root.children[0].local !== expectedRoot) fail(`XML thiếu phần tử ${expectedRoot}.`);
  return root.children[0];
}

const children = (node, name) => node.children.filter(child => child.local === name);
const child = (node, name) => node.children.find(item => item.local === name);
const requiredChild = (node, name) => child(node, name) ?? fail(`XLSX thiếu phần tử ${name}.`);
function stringValue(node) {
  // Rich text runs can contain phonetic annotations; only display text is read.
  const text = node.children.filter(item => item.local === 't' || item.local === 'r').map(item => item.local === 't' ? item.text : children(item, 't').map(text => text.text).join('')).join('');
  return text.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function resolvePart(sourcePart, target) {
  if (!target || /[\\?#\0]/.test(target) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target) || target.startsWith('//')) fail('XLSX có quan hệ đến đường dẫn không an toàn.');
  let decoded;
  try { decoded = decodeURIComponent(target); } catch { fail('Đường dẫn XLSX không hợp lệ.'); }
  if (/[\\?#\0]/.test(decoded) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded) || decoded.startsWith('//')) fail('Đường dẫn XLSX không an toàn.');
  const raw = decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(sourcePart), decoded);
  const result = path.posix.normalize(raw);
  if (!result || result === '.' || result === '..' || result.startsWith('../') || result.startsWith('/')) fail('Đường dẫn XLSX vượt ra ngoài gói ZIP.');
  return result;
}

function relations(entries, part) {
  const relPart = part ? path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels') : '_rels/.rels';
  const buffer = entries.get(relPart);
  if (!buffer) fail(`XLSX thiếu quan hệ ${relPart}.`);
  const result = new Map();
  for (const rel of children(parseXml(buffer, 'Relationships'), 'Relationship')) {
    if (!rel.attrs.Id || !rel.attrs.Type || !rel.attrs.Target || result.has(rel.attrs.Id)) fail('Quan hệ XLSX không hợp lệ hoặc trùng lặp.');
    result.set(rel.attrs.Id, { type: rel.attrs.Type.split('/').at(-1), external: rel.attrs.TargetMode === 'External', target: rel.attrs.Target });
  }
  return result;
}

function getPart(entries, part, root) {
  const buffer = entries.get(part);
  if (!buffer) fail(`XLSX thiếu mục ${part}.`);
  return parseXml(buffer, root);
}

function dateFormat(format) {
  // Strip quoted/escaped literals and locale, color, condition directives.
  const stripped = format.replace(/"(?:[^"]|"")*"/g, '').replace(/\\.|_.|\*./g, '').replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '').toLowerCase();
  return {
    isDate: /[ydhs]/.test(stripped) || /m/.test(stripped) && !/[0#?]/.test(stripped),
    hasTime: /[hs]|\[(?:h+|m+|s+)\]|am\/pm|a\/p/.test(stripped),
  };
}

function dateStyles(entries, rels, workbookPart) {
  const relation = [...rels.values()].find(rel => rel.type === 'styles');
  if (!relation) return [];
  if (relation.external) fail('XLSX không cho phép kiểu ô từ nguồn ngoài.');
  const styles = getPart(entries, resolvePart(workbookPart, relation.target), 'styleSheet');
  const formats = new Map();
  for (const format of child(styles, 'numFmts')?.children ?? []) {
    if (format.local === 'numFmt') formats.set(Number(format.attrs.numFmtId), format.attrs.formatCode ?? '');
  }
  const builtin = id => id >= 14 && id <= 22 || id >= 27 && id <= 36 || id >= 45 && id <= 47 || id >= 50 && id <= 58;
  return (child(styles, 'cellXfs')?.children ?? []).filter(item => item.local === 'xf').map(item => {
    const id = Number(item.attrs.numFmtId ?? 0);
    if (formats.has(id)) return dateFormat(formats.get(id));
    // Locale-dependent date formats without an explicit format code do not
    // establish midnight. Only unambiguous built-in time formats establish time.
    return { isDate: builtin(id), hasTime: id >= 18 && id <= 22 || id === 32 || id === 33 || id >= 45 && id <= 47 };
  });
}

function excelDate(serial, use1904, hasTime) {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465.99999999) fail('Ngày Excel nằm ngoài phạm vi hỗ trợ.');
  const day = Math.floor(serial);
  if (!use1904 && day === 60) fail('Excel chứa ngày không tồn tại 29/02/1900 (số thứ tự 60).');
  const epoch = use1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const adjusted = !use1904 && serial >= 61 ? serial - 1 : serial;
  const date = new Date(epoch + Math.round(adjusted * 86400000));
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) fail('Ngày Excel không hợp lệ.');
  // Excel serials are wall-clock values; preserve them in the app's +07 timezone.
  const iso = date.toISOString();
  // A date-only style and integer serial supply no verified time of day.
  // Leave the value date-only so canonical timestamp validation can flag it.
  if (!hasTime && Number.isInteger(serial)) return iso.slice(0, 10);
  return iso.replace(/\.000Z$/, '+07:00').replace(/Z$/, '+07:00');
}

function isoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:(Z)|([+-])(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) fail('XLSX có ngày ISO không hợp lệ.');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const check = new Date(0); check.setUTCFullYear(year, month - 1, day);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59 || Number(match[9] ?? 0) > 23 || Number(match[10] ?? 0) > 59) fail('XLSX có ngày ISO không hợp lệ.');
  return match[7] || match[8] ? value : value + '+07:00';
}

function columnIndex(reference) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/i.exec(reference);
  if (!match) fail('Địa chỉ ô XLSX không hợp lệ.');
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  if (column > IMPORT_LIMITS.columns) fail('Tệp vượt quá giới hạn 200 cột.');
  return [column - 1, Number(match[2])];
}

function parseXlsx(buffer) {
  const entries = unzip(buffer);
  const packageRels = relations(entries, '');
  const office = [...packageRels.values()].find(rel => rel.type === 'officeDocument');
  if (!office || office.external) fail('XLSX thiếu workbook nội bộ.');
  const workbookPart = resolvePart('', office.target);
  const workbook = getPart(entries, workbookPart, 'workbook');
  const rels = relations(entries, workbookPart);
  const firstSheet = child(requiredChild(workbook, 'sheets'), 'sheet');
  const relationshipId = firstSheet && Object.entries(firstSheet.attrs).find(([name]) => name === 'r:id' || name.endsWith(':id'))?.[1];
  const relationship = relationshipId && rels.get(relationshipId);
  if (!relationship || relationship.type !== 'worksheet' || relationship.external) fail('XLSX thiếu trang tính đầu tiên hợp lệ.');
  const worksheet = getPart(entries, resolvePart(workbookPart, relationship.target), 'worksheet');
  const sharedRel = [...rels.values()].find(rel => rel.type === 'sharedStrings');
  let sharedStrings = [];
  if (sharedRel) {
    if (sharedRel.external) fail('XLSX không cho phép chuỗi từ nguồn ngoài.');
    sharedStrings = children(getPart(entries, resolvePart(workbookPart, sharedRel.target), 'sst'), 'si').map(stringValue);
  }
  const styles = dateStyles(entries, rels, workbookPart);
  const use1904 = ['1', 'true'].includes(child(workbook, 'workbookPr')?.attrs.date1904);
  const rows = [];
  let previousRow = 0;
  for (const row of children(requiredChild(worksheet, 'sheetData'), 'row')) {
    const rowNumber = row.attrs.r === undefined ? previousRow + 1 : Number(row.attrs.r);
    if (!Number.isInteger(rowNumber) || rowNumber <= previousRow) fail('Thứ tự dòng XLSX không hợp lệ.');
    if (rowNumber > IMPORT_LIMITS.rows + 1) fail('Tệp vượt quá giới hạn 10.000 dòng dữ liệu.');
    previousRow = rowNumber;
    const values = [], seenColumns = new Set();
    let nextColumn = 0;
    for (const cell of children(row, 'c')) {
      let column = nextColumn;
      if (cell.attrs.r) {
        const coordinates = columnIndex(cell.attrs.r); column = coordinates[0];
        if (coordinates[1] !== rowNumber) fail('Ô XLSX không nằm trong dòng được khai báo.');
      }
      if (column >= IMPORT_LIMITS.columns) fail('Tệp vượt quá giới hạn 200 cột.');
      if (seenColumns.has(column)) fail('XLSX chứa địa chỉ ô trùng lặp.');
      seenColumns.add(column); nextColumn = column + 1;
      if (child(cell, 'f')) fail(`Ô ${cell.attrs.r ?? `${column + 1}:${rowNumber}`} chứa công thức. Hãy thay công thức bằng giá trị trước khi nhập.`);
      const value = child(cell, 'v')?.text ?? '';
      const type = cell.attrs.t ?? 'n';
      const style = cell.attrs.s === undefined ? undefined : Number(cell.attrs.s);
      if (style !== undefined && (!Number.isInteger(style) || style < 0 || style >= styles.length)) fail('XLSX có chỉ số kiểu ô không hợp lệ.');
      if (type === 'inlineStr') values[column] = child(cell, 'is') ? stringValue(child(cell, 'is')) : '';
      else if (type === 's') {
        if (!/^\d+$/.test(value) || Number(value) >= sharedStrings.length) fail('XLSX có chỉ số chuỗi dùng chung không hợp lệ.');
        values[column] = sharedStrings[Number(value)];
      } else if (type === 'b') {
        if (value !== '0' && value !== '1') fail('XLSX có giá trị boolean không hợp lệ.');
        values[column] = value === '1';
      } else if (type === 'n') {
        if (value === '') values[column] = '';
        else {
          if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) fail('XLSX có giá trị số không hợp lệ.');
          const format = styles[style ?? 0];
          values[column] = format?.isDate ? excelDate(Number(value), use1904, format.hasTime) : Number(value);
        }
      } else if (type === 'str') values[column] = value;
      else if (type === 'd') values[column] = isoDate(value);
      else if (type === 'e') fail(`Ô ${cell.attrs.r ?? ''} chứa lỗi Excel.`);
      else fail(`XLSX có kiểu ô không hỗ trợ: ${type}.`);
    }
    // Preserve sparse physical rows; empty rows are removed by tableResult.
    rows.push(values);
  }
  return rows;
}

export function applyMapping(rows, mapping, headers = []) {
  if (!Array.isArray(rows) || !mapping || typeof mapping !== 'object' || Array.isArray(mapping)) fail('Ánh xạ cột không hợp lệ.');
  const pairs = Object.entries(mapping).filter(([, value]) => value !== '' && value !== null && value !== undefined);
  const numericKeys = pairs.length > 0 && pairs.every(([key]) => /^\d+$/.test(key));
  const headerKeys = pairs.length > 0 && pairs.every(([key]) => headers.includes(key));
  if (headerKeys && pairs.some(([key]) => headers.indexOf(key) !== headers.lastIndexOf(key))) fail('Tiêu đề cột bị trùng; hãy dùng chỉ số cột để ánh xạ.');
  const resolved = pairs.map(([key, value]) => {
    const canonical = numericKeys || headerKeys ? value : key;
    const source = numericKeys ? Number(key) : headerKeys ? headers.indexOf(key) : typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : headers.indexOf(value);
    if (typeof canonical !== 'string' || !canonical || ['__proto__', 'prototype', 'constructor'].includes(canonical) || !Number.isInteger(source) || source < 0 || source >= IMPORT_LIMITS.columns) fail('Ánh xạ cột không hợp lệ.');
    return [canonical, source];
  });
  if (new Set(resolved.map(([canonical]) => canonical)).size !== resolved.length) fail('Không thể ánh xạ nhiều cột vào cùng một trường.');
  return rows.map(row => Object.fromEntries(resolved.map(([canonical, source]) => [canonical, (Array.isArray(row) ? row[source] : row[headers[source]]) ?? ''])));
}

function exportTable(records, columns) {
  if (!Array.isArray(records) || records.length > IMPORT_LIMITS.rows) fail('Số dòng xuất vượt quá giới hạn 10.000.');
  const selected = columns ?? (records.length && !Array.isArray(records[0]) ? Object.keys(records[0]) : []);
  if (!Array.isArray(selected) || selected.length > IMPORT_LIMITS.columns) fail('Danh sách cột xuất không hợp lệ.');
  const normalized = selected.map(column => typeof column === 'string' ? { key: column, label: column } : { key: column?.key, label: column?.label ?? column?.title ?? column?.key });
  if (normalized.some(column => column.key === undefined || column.label === undefined)) fail('Cột xuất cần key và label.');
  return [normalized.map(column => String(column.label)), ...records.map(record => normalized.map((column, index) => Array.isArray(record) ? record[index] ?? '' : record[column.key] ?? ''))];
}

function spreadsheetSafe(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = value instanceof Date ? value.toISOString() : String(value);
  // Also cover prefixes hidden behind whitespace/control characters.
  return /^[\s\u0000-\u001F\u007F-\u009F]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
}

export function toCsv(records, columns) {
  return '\uFEFF' + exportTable(records, columns).map(row => row.map(value => {
    const text = spreadsheetSafe(value);
    return /[",\r\n\t]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }).join(',')).join('\r\n') + '\r\n';
}

function escapeXml(value) {
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(text)) fail('Giá trị xuất chứa ký tự không hợp lệ cho XML.');
  // Excel's escaped-code syntax needs its underscore escaped when literal.
  text = text.replace(/_x[0-9a-f]{4}_/gi, token => '_x005F_' + token.slice(1)).replaceAll('\r', '_x000D_');
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function columnName(index) {
  let value = index + 1, name = '';
  while (value) { value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); }
  return name;
}

// Stored ZIP archives have no compression dependency and are readable by Excel.
export function zipEntries(items) {
  if (!Array.isArray(items) || items.length > IMPORT_LIMITS.entries) fail('Số mục ZIP không hợp lệ.');
  const locals = [], central = [];
  let offset = 0, expanded = 0;
  const seen = new Set();
  for (const [name, input] of items) {
    safeZipName(name);
    if (seen.has(name)) fail('Mục ZIP trùng tên.');
    seen.add(name);
    const filename = Buffer.from(name), data = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
    expanded += data.length;
    if (expanded > IMPORT_LIMITS.expandedBytes) fail('Dữ liệu xuất vượt quá giới hạn 32 MB.');
    const checksum = crc32(data), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, filename, data); central.push(entry, filename); offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function toXlsx(records, columns) {
  const table = exportTable(records, columns);
  const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const sheet = declaration + `<worksheet xmlns="${namespace}"><sheetData>` + table.map((row, rowIndex) => `<row r="${rowIndex + 1}">` + row.map((value, index) => {
    const ref = `${columnName(index)}${rowIndex + 1}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
    // Explicit inline strings preserve formula-looking values as literal text.
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }).join('') + '</row>').join('') + '</sheetData></worksheet>';
  return zipEntries([
    ['[Content_Types].xml', declaration + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', declaration + `<workbook xmlns="${namespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}
