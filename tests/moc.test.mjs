import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMocCells, MocAdapter } from '../extension/adapters/moc.mjs';
import { mocProfileConfig } from '../extension/adapters/moc-profile.mjs';
import { validateAdapterConfig } from '../extension/adapters/base.mjs';

// Synthetic data; column labels/combined-cell layout follow the supplied screenshot.
const cells = () => ({ 'Mã số hồ sơ': 'SYNTHETIC-001\n02', 'Thủ tục': '1.000001\n- Thủ tục kiểm thử',
  'Thời gian quy định': 'Còn lại 999 ngày\nNgày nộp: 02/10/2026\n14:18:32\nNgày tiếp nhận: 02/10/2026 16:03:15\nNgày hẹn trả: 13/10/202616:03:15',
  'Cơ quan thực hiện': 'Cơ quan : Đơn vị kiểm thử\nCán bộ: Cán bộ tổng hợp', 'Trạng thái': 'Đang xử lý' });

test('MOC primary code excludes the confirmed PMCN suffix without accepting arbitrary annotations', () => {
  assert.equal(parseMocCells({ ...cells(), 'Mã số hồ sơ': 'H29.154-261010-170001  (Hồ sơ của PMCN)' }).caseCode, 'H29.154-261010-170001');
  assert.throws(() => parseMocCells({ ...cells(), 'Mã số hồ sơ': 'CODE-1 (CODE-2)' }));
});

test('MOC combined cells retain official dates, procedure and agency; ignore countdown', () => {
  const raw = parseMocCells(cells());
  const record = new MocAdapter(mocProfileConfig('motcuabxd.moc.gov.vn')).normalizeCase(raw);
  assert.equal(record.caseCode, 'SYNTHETIC-00102');
  assert.equal(record.procedureCode, '1.000001');
  assert.equal(record.procedureName, 'Thủ tục kiểm thử');
  assert.equal(record.agencyName, 'Đơn vị kiểm thử');
  assert.equal(record.officerName, 'Cán bộ tổng hợp');
  assert.equal(record.dueAt, '2026-10-13T09:03:15.000Z');
  assert.equal(record.receivedAt, '2026-10-02T09:03:15.000Z');
  assert.equal(record.normalizedStatus, 'PROCESSING');
  assert.ok(!JSON.stringify(record).includes('999'));
});

test('MOC does not overwrite full procedure names with visibly truncated text', () => {
  assert.equal(parseMocCells({ ...cells(), 'Thủ tục': '1.000001 - Thủ tục bị cắt...' }).procedureName, undefined);
});

test('MOC refuses missing, ambiguous, duplicate or invalid official timestamps', () => {
  for (const timing of ['Còn lại 3 ngày', cells()['Thời gian quy định'].replace('13/10/202616:03:15', '13/10/2026'),
    `${cells()['Thời gian quy định']} Ngày hẹn trả: 14/10/2026 16:03:15`]) {
    assert.throws(() => parseMocCells({ ...cells(), 'Thời gian quy định': timing }));
  }
  const adapter = new MocAdapter(mocProfileConfig('motcuabxd.moc.gov.vn'));
  assert.throws(() => adapter.normalizeCase(parseMocCells({ ...cells(), 'Thời gian quy định': cells()['Thời gian quy định'].replace('13/10/2026', '31/02/2026') })));
  assert.equal(adapter.normalizeCase(parseMocCells({ ...cells(), 'Trạng thái': 'Chưa kiểm chứng' })).normalizedStatus, 'UNKNOWN');
});

test('MOC profile is restricted to confirmed MOC list pages and supplied status mapping', () => {
  const config = mocProfileConfig('motcuabxd.moc.gov.vn');
  assert.equal(validateAdapterConfig(config, 'MOC').profile, 'MOC_SEARCH_V1');
  for (const patch of [{ confirmed: false }, { sourceSystem: 'MOH' }, { token: 'forbidden' },
    { listUrl: 'https://motcuabxd.moc.gov.vn/vi/other' }, { listUrl: `${config.listUrl}?secret=1` },
    { statusMappings: { 'Đang xử lý': 'COMPLETED' } }]) {
    assert.throws(() => validateAdapterConfig({ ...config, ...patch }, patch.sourceSystem ?? 'MOC'));
  }
  assert.throws(() => mocProfileConfig('motcuabxd.moc.gov.vn.attacker.example'));
});
