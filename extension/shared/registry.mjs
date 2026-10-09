/** Portal names and hosts supplied in the project brief; no live extractor is verified. */
export const SOURCES = Object.freeze([
  ['TPHCM', 'Hệ thống thông tin giải quyết TTHC TP.HCM', 'motcua.tphcm.gov.vn', 'TphcmAdapter'],
  ['MOF', 'Bộ Tài chính', 'motcua.mst.gov.vn', 'MofAdapter'],
  ['MOHA', 'Bộ Nội vụ', 'motcua.moha.gov.vn', 'MohaAdapter'],
  ['MOC', 'Bộ Xây dựng', 'motcua.moc.gov.vn', 'MocAdapter'],
  ['MOIT', 'Bộ Công Thương', 'tthc.moit.gov.vn', 'MoitAdapter'],
  ['MAE', 'Bộ Nông nghiệp và Môi trường', 'dvcnnmt.mae.gov.vn', 'MaeAdapter'],
  ['MOH', 'Bộ Y tế', 'dvc.moh.gov.vn', 'MohAdapter'],
  ['MOET', 'Bộ Giáo dục và Đào tạo', 'baocaodvc.moet.gov.vn', 'MoetAdapter'],
  ['MOJ', 'Bộ Tư pháp', 'motcua.moj.gov.vn', 'MojAdapter'],
  ['BVHTTDL', 'Bộ Văn hóa, Thể thao và Du lịch', 'dichvucong.bvhttdl.gov.vn', 'BvhttdlAdapter'],
  ['BDTTG', 'Bộ Dân tộc và Tôn giáo', 'gqtthc.bdttg.gov.vn', 'BdttgAdapter'],
].map(([id, name, hostname, adapter]) => Object.freeze({
  id, name, hostname, url: id === 'MOC' ? 'https://motcuabxd.moc.gov.vn/vi/dossier/search' : `https://${hostname}/`, adapter, version: '0.1.0',
  supportedHosts: Object.freeze(id === 'MOC' ? [hostname, 'motcuabxd.moc.gov.vn'] : [hostname]),
  ...(id === 'MOC' ? { suppliedListUrl: 'https://motcuabxd.moc.gov.vn/vi/dossier/search' } : {}),
  adapterStatus: id === 'TPHCM' ? 'PARTIAL' : 'WAITING_FOR_SAMPLE', enabled: true,
})));

export function sourceById(id) { return SOURCES.find(source => source.id === id) ?? null; }
export function sourceByHostname(hostname) {
  return SOURCES.find(source => source.supportedHosts.includes(String(hostname).toLowerCase())) ?? null;
}
