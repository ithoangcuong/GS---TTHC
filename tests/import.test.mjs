import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseFile, applyMapping, toCsv, toXlsx, zipEntries, crc32, IMPORT_LIMITS } from '../server/import.mjs';
import { normalizeCase } from '../shared/normalize.mjs';

const parseCsv = text => parseFile('input.CSV', Buffer.from(text).toString('base64'));
const parseXlsx = buffer => parseFile('input.xlsx', buffer.toString('base64'));
const relationship = (id, type, target, mode = '') => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`;

function workbook(sheetData, { date1904 = false, sharedStrings, styles, sheetPart = 'xl/custom/first.xml', sheetTarget = 'custom/first.xml', workbookPart = 'xl/workbook.xml', prefix = '', extra = [], sheetXml } = {}) {
  const tag = name => prefix + name;
  const relPart = workbookPart.replace(/([^/]+)$/, '_rels/$1.rels');
  const parts = [
    ['_rels/.rels', `<Relationships>${relationship('office', 'officeDocument', workbookPart)}</Relationships>`],
    [workbookPart, `<${tag('workbook')}${prefix ? ' xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' : ''} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><${tag('workbookPr')} date1904="${date1904 ? '1' : '0'}"/><${tag('sheets')}><${tag('sheet')} name="First" sheetId="1" r:id="chosen"/><${tag('sheet')} name="Second" sheetId="2" r:id="ignored"/></${tag('sheets')}></${tag('workbook')}>`],
    [relPart, `<Relationships>${relationship('chosen', 'worksheet', sheetTarget)}${relationship('ignored', 'worksheet', 'worksheets/sheet1.xml')}${sharedStrings ? relationship('strings', 'sharedStrings', 'sharedStrings.xml') : ''}${styles ? relationship('styles', 'styles', 'styles.xml') : ''}</Relationships>`],
    [sheetPart, sheetXml ?? `<${tag('worksheet')}${prefix ? ' xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' : ''}><${tag('sheetData')}>${sheetData}</${tag('sheetData')}></${tag('worksheet')}>`],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row><c t="inlineStr"><is><t>Wrong sheet</t></is></c></row></sheetData></worksheet>'],
    ...extra,
  ];
  if (sharedStrings) parts.push(['xl/sharedStrings.xml', sharedStrings]);
  if (styles) parts.push(['xl/styles.xml', styles]);
  return zipEntries(parts);
}

function compressedZip(parts) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, input] of parts) {
    const data = Buffer.from(input), compressed = deflateRawSync(data), filename = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed); central.push(entry, filename); offset += 30 + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function entriesFromStored(buffer) {
  const entries = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), nameSize = buffer.readUInt16LE(offset + 26), extraSize = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameSize).toString(), start = offset + 30 + nameSize + extraSize;
    entries.push([name, buffer.subarray(start, start + size)]); offset = start + size;
  }
  return entries;
}

test('CSV: BOM, UTF-8, comma, multiline, escaped quotes, trailing empty fields', () => {
  const result = parseCsv('\uFEFFMã,Tên,Ghi chú,Trống\r\n001,"Nguyễn, An","Hai\r\ndòng và ""quote""",\r\n002,Đức,,\r\n');
  assert.deepEqual(result.headers, ['Mã', 'Tên', 'Ghi chú', 'Trống']);
  assert.deepEqual(result.rows, [['001', 'Nguyễn, An', 'Hai\r\ndòng và "quote"', ''], ['002', 'Đức', '', '']]);
  assert.equal(result.totalRows, 2);
});

test('CSV supports semicolon/tab and strips empty physical records', () => {
  assert.deepEqual(parseCsv('\nA;B\n1;"two;words"\n').rows, [['1', 'two;words']]);
  assert.deepEqual(parseCsv('A\tB\n1\t2').rows, [['1', '2']]);
  assert.deepEqual(parseCsv('A,B\n1,2,3').headers, ['A', 'B', '']);
});

test('CSV rejects malformed quotes, invalid encoding, invalid uploads and extension', () => {
  assert.throws(() => parseCsv('A,B\n1,"unclosed'), /ngoặc kép/);
  assert.throws(() => parseCsv('A,B\n1,"x"bad'), /sau trường/);
  assert.throws(() => parseCsv('A,B\n1,bad"quote'), /sai vị trí/);
  assert.throws(() => parseFile('a.csv', Buffer.from([0xc0, 0xaf]).toString('base64')), /UTF-8/);
  assert.throws(() => parseFile('a.csv', '%%%'), /base64/);
  assert.throws(() => parseFile('a.xls', Buffer.from('a').toString('base64')), /CSV UTF-8 hoặc XLSX/);
  assert.throws(() => parseCsv(''), /không hợp lệ|không có dữ liệu/);
});

test('CSV limits rows, columns and upload size', () => {
  assert.throws(() => parseCsv(Array.from({ length: 201 }, (_, i) => i).join(',')), /200 cột/);
  assert.throws(() => parseCsv('A\n' + 'x\n'.repeat(10001)), /10.000/);
  assert.throws(() => parseFile('a.csv', Buffer.alloc(IMPORT_LIMITS.uploadBytes + 1, 97).toString('base64')), /10 MB/);
  assert.equal(parseCsv('A\n' + 'x\n'.repeat(10000)).totalRows, 10000);
});

test('mapping accepts header-to-canonical, index-to-canonical, canonical-to-index, object rows', () => {
  assert.deepEqual(applyMapping([['A1', 'Name']], { 'Mã': 'code', 'Tên': 'name' }, ['Mã', 'Tên']), [{ code: 'A1', name: 'Name' }]);
  assert.deepEqual(applyMapping([['A1', 'Name']], { 0: 'code', 1: 'name' }), [{ code: 'A1', name: 'Name' }]);
  assert.deepEqual(applyMapping([['A1', 'Name']], { code: 0, name: 1 }), [{ code: 'A1', name: 'Name' }]);
  assert.deepEqual(applyMapping([{ 'Mã': 'A1', 'Tên': 'Name' }], { 'Mã': 'code' }, ['Mã', 'Tên']), [{ code: 'A1' }]);
  assert.throws(() => applyMapping([['a']], { 0: 'constructor' }), /không hợp lệ/);
  assert.throws(() => applyMapping([['a', 'b']], { 0: 'name', 1: 'name' }), /nhiều cột/);
});

test('CSV export escapes text and blocks formula prefixes including whitespace and controls', () => {
  const values = ['=HYPERLINK("x")', '+cmd', '-cmd', '@SUM(A1)', ' \t=1', '\tvalue', 'normal, "quoted"\nline', -123, false];
  const exported = toCsv(values.map(value => ({ value })), ['value']);
  const result = parseCsv(exported);
  assert.deepEqual(result.rows.slice(0, 6).map(row => row[0]), values.slice(0, 6).map(value => "'" + value));
  assert.deepEqual(result.rows.slice(6).map(row => row[0]), ['normal, "quoted"\nline', '-123', 'false']);
  assert.ok(exported.startsWith('\uFEFF'));
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('XLSX export round trips types, accents, empty cells, literal formulas and XML entities', () => {
  const records = [{ code: '001', name: 'Nguyễn & <An> "quoted"', count: 7, ok: true, extra: '=1+2' }, { code: '002', name: '', count: -2.5, ok: false, extra: '' }];
  const result = parseXlsx(toXlsx(records));
  assert.deepEqual(result.headers, ['code', 'name', 'count', 'ok', 'extra']);
  assert.deepEqual(result.rows, records.map(row => Object.values(row)));
  assert.equal(result.totalRows, 2);
  const labels = parseXlsx(toXlsx(records, [{ key: 'code', label: 'Mã' }, { key: 'name', label: 'Tên' }]));
  assert.deepEqual(labels.headers, ['Mã', 'Tên']);
});

test('XLSX preserves literal Excel escape patterns and carriage returns, validates ISO dates', () => {
  assert.deepEqual(parseXlsx(toXlsx([{ Text: '_x0041_\r\nline' }])).rows, [['_x0041_\r\nline']]);
  const fixture = value => workbook(`<row r="1"><c t="inlineStr"><is><t>Date</t></is></c></row><row r="2"><c t="d"><v>${value}</v></c></row>`);
  assert.deepEqual(parseXlsx(fixture('2024-02-29T12:00:00')).rows, [['2024-02-29T12:00:00+07:00']]);
  assert.deepEqual(parseXlsx(fixture('2024-02-29T12:00:00Z')).rows, [['2024-02-29T12:00:00Z']]);
  assert.throws(() => parseXlsx(fixture('2023-02-29T12:00:00')), /ngày ISO/);
  assert.throws(() => parseXlsx(fixture('2024-02-29T24:00:00')), /ngày ISO/);
});

test('XLSX resolves first worksheet relationship and supports shared rich strings, blanks, boolean and numeric cells', () => {
  const sharedStrings = '<sst><si><t>Header A</t></si><si><r><t>Hello </t></r><r><t>world</t></r><rPh><t>IGNORE</t></rPh></si></sst>';
  const result = parseXlsx(workbook('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Blank</t></is></c><c r="C1" t="inlineStr"><is><t>Number</t></is></c><c r="D1" t="inlineStr"><is><t>Flag</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>1.25e2</v></c><c r="D2" t="b"><v>1</v></c></row>', { sharedStrings }));
  assert.deepEqual(result.headers, ['Header A', 'Blank', 'Number', 'Flag']);
  assert.deepEqual(result.rows, [['Hello world', '', 125, true]]);
});

test('XLSX supports XML namespaces, safe relative part paths, CDATA and numeric references', () => {
  const sheetXml = '<s:worksheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><s:sheetData><s:row r="1"><s:c t="inlineStr"><s:is><s:t>Header</s:t></s:is></s:c></s:row><s:row r="2"><s:c t="inlineStr"><s:is><s:t><![CDATA[a<&]]>&#x1F600;&#65;</s:t></s:is></s:c></s:row></s:sheetData></s:worksheet>';
  const result = parseXlsx(workbook('', { prefix: 's:', workbookPart: 'xl/custom/book.xml', sheetTarget: '../custom/first.xml', sheetPart: 'xl/custom/first.xml', sheetXml }));
  assert.deepEqual(result.rows, [['a<&😀A']]);
});

test('XLSX handles 1900 and 1904 date systems, leap-year correction, times and custom styles', () => {
  const styles = '<styleSheet><numFmts><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/><numFmt numFmtId="166" formatCode="0.00 &quot;USD&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="165"/><xf numFmtId="166"/></cellXfs></styleSheet>';
  const data = '<row r="1"><c t="inlineStr"><is><t>date</t></is></c><c t="inlineStr"><is><t>time</t></is></c><c t="inlineStr"><is><t>amount</t></is></c></row><row r="2"><c s="1"><v>61</v></c><c s="2"><v>45292.5</v></c><c s="3"><v>12.5</v></c></row>';
  assert.deepEqual(parseXlsx(workbook(data, { styles })).rows, [['1900-03-01', '2024-01-01T12:00:00+07:00', 12.5]]);
  assert.deepEqual(parseXlsx(workbook(data.replace('<v>61</v>', '<v>0</v>'), { styles, date1904: true })).rows[0][0], '1904-01-01');
  assert.equal(parseXlsx(workbook(data.replace('<v>61</v>', '<v>59</v>'), { styles })).rows[0][0], '1900-02-28');
  assert.throws(() => parseXlsx(workbook(data.replace('<v>61</v>', '<v>60</v>'), { styles })), /29\/02\/1900/);
});

test('XLSX date-only values never invent a deadline time; explicit datetime or observed fractions preserve time', () => {
  const styles = '<styleSheet><numFmts><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm:ss"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy &quot;hh:mm&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="165"/><xf numFmtId="22"/><xf numFmtId="166"/><xf numFmtId="167"/></cellXfs></styleSheet>';
  const data = '<row r="1"><c t="inlineStr"><is><t>Due</t></is></c></row>';
  const valueFor = (style, serial) => parseXlsx(workbook(data + `<row r="2"><c s="${style}"><v>${serial}</v></c></row>`, { styles })).rows[0][0];
  for (const style of [1, 2, 5]) {
    const dateOnly = valueFor(style, 45292);
    assert.equal(dateOnly, '2024-01-01');
    assert.throws(() => normalizeCase({ caseCode: 'DATE-ONLY', dueAt: dateOnly }, 'TPHCM'), /Timestamp thiếu thời gian/);
    assert.equal(valueFor(style, 45292.5), '2024-01-01T12:00:00+07:00');
  }
  for (const style of [3, 4]) {
    const explicitMidnight = valueFor(style, 45292);
    assert.equal(explicitMidnight, '2024-01-01T00:00:00+07:00');
    assert.equal(normalizeCase({ caseCode: 'VERIFIED-TIME', dueAt: explicitMidnight }, 'TPHCM').dueAt, '2023-12-31T17:00:00.000Z');
  }
});

test('XLSX supports genuine DEFLATE zip archives', () => {
  const original = toXlsx([{ Name: 'test', Count: 123 }]);
  const compressed = compressedZip(entriesFromStored(original));
  assert.deepEqual(parseXlsx(compressed).rows, [['test', 123]]);
  assert.ok(compressed.length < original.length);
});

test('XLSX rejects formulas, Excel errors, invalid indices and cell coordinates', () => {
  const fixture = cell => workbook(`<row r="1"><c t="inlineStr"><is><t>A</t></is></c></row><row r="2">${cell}</row>`);
  assert.throws(() => parseXlsx(fixture('<c r="A2"><f>1+2</f><v>3</v></c>')), /A2 chứa công thức/);
  assert.throws(() => parseXlsx(fixture('<c t="e"><v>#DIV\/0!</v></c>')), /lỗi Excel/);
  assert.throws(() => parseXlsx(fixture('<c t="s"><v>9</v></c>')), /chuỗi dùng chung/);
  assert.throws(() => parseXlsx(fixture('<c r="A3"><v>1</v></c>')), /dòng được khai báo/);
  assert.throws(() => parseXlsx(fixture('<c r="GS2"><v>1</v></c>')), /200 cột/);
  assert.throws(() => parseXlsx(fixture('<c r="A2"><v>1</v></c><c r="A2"><v>2</v></c>')), /trùng lặp/);
  assert.throws(() => parseXlsx(fixture('<c s="7"><v>1</v></c>')), /kiểu ô/);
  assert.throws(() => parseXlsx(workbook('<row r="10002"><c><v>1</v></c></row>')), /10.000/);
});

test('XLSX rejects malformed XML and prevents DTD/entity processing', () => {
  for (const sheetXml of [
    '<worksheet><sheetData></worksheet>',
    '<worksheet><sheetData/></worksheet><second/>',
    '<!DOCTYPE worksheet [<!ENTITY evil SYSTEM "file:///secret">]><worksheet><sheetData/></worksheet>',
    '<worksheet><sheetData><row><c t="inlineStr"><is><t>&unknown;</t></is></c></row></sheetData></worksheet>',
    '<worksheet a="1" a="2"><sheetData/></worksheet>',
    '<worksheet><sheetData/><![CDATA[unclosed</worksheet>',
    '<worksheet><sheetData/><bad a="<"/></worksheet>',
    '<worksheet><sheetData/><?evil anything?></worksheet>',
    '<worksheet><sheetData/><x>]]></x></worksheet>',
  ]) assert.throws(() => parseXlsx(workbook('', { sheetXml })), /XML|DTD|thực thể/);
});

test('XLSX rejects bad archives, CRC corruption, duplicate/path traversal and external relationships', () => {
  assert.throws(() => parseXlsx(Buffer.from('not zip')), /ZIP/);
  const corrupted = toXlsx([{ A: 'x' }]); corrupted[60] ^= 1;
  assert.throws(() => parseXlsx(corrupted), /CRC|ZIP/);
  assert.throws(() => zipEntries([['../bad', 'x']]), /không an toàn/);
  assert.throws(() => zipEntries([['a', 'x'], ['a', 'y']]), /trùng/);
  assert.throws(() => parseXlsx(workbook('<row/>', { sheetTarget: '../../outside.xml' })), /ngoài gói ZIP/);
  const parts = entriesFromStored(workbook('<row/>'));
  const relIndex = parts.findIndex(([name]) => name === 'xl/_rels/workbook.xml.rels');
  parts[relIndex][1] = Buffer.from(`<Relationships>${relationship('chosen', 'worksheet', 'https://evil.example/sheet', 'External')}</Relationships>`);
  assert.throws(() => parseXlsx(zipEntries(parts)), /trang tính đầu tiên/);
});

test('XLSX prevents expansion bombs and excessive entries before decompression', () => {
  const archive = compressedZip([['bomb.xml', Buffer.alloc(IMPORT_LIMITS.expandedBytes + 1, 65)]]);
  assert.throws(() => parseXlsx(archive), /32 MB/);
  const original = toXlsx([{ A: 'x' }]);
  const end = original.length - 22;
  original.writeUInt16LE(2001, end + 8); original.writeUInt16LE(2001, end + 10);
  assert.throws(() => parseXlsx(original), /2.000/);
});
