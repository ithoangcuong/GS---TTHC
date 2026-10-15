import { sourceById } from './source-registry.mjs';

// User screenshot, 2026-10-11, cross-checked against public ListSearchComponent.
// Local confirmation does not claim live portal acceptance testing.
export const MOC_PROFILE = 'MOC_SEARCH_V1';
export function mocProfileConfig(hostname) {
  return validateMocProfile({ sourceSystem: 'MOC', profile: MOC_PROFILE, confirmed: true,
    listUrl: `https://${hostname}/vi/dossier/search` });
}
export function validateMocProfile(config) {
  if (!config || config.sourceSystem !== 'MOC' || config.profile !== MOC_PROFILE || config.confirmed !== true
    || Object.keys(config).some(key => !['sourceSystem', 'profile', 'confirmed', 'listUrl', 'statusMappings'].includes(key))) {
    throw new Error('Cần xác nhận phiên đăng nhập và bố cục tra cứu Bộ Xây dựng.');
  }
  const url = new URL(config.listUrl);
  if (url.protocol !== 'https:' || !sourceById('MOC').supportedHosts.includes(url.hostname)
    || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/vi/dossier/search') {
    throw new Error('Bộ đọc MOC chỉ dùng trên trang Tra cứu hồ sơ toàn cơ quan.');
  }
  if (config.statusMappings !== undefined && JSON.stringify(config.statusMappings) !== JSON.stringify({ 'Đang xử lý': 'PROCESSING' })) {
    throw new Error('Mapping trạng thái không thuộc bố cục MOC đã đối chiếu.');
  }
  return { sourceSystem: 'MOC', profile: MOC_PROFILE, confirmed: true, listUrl: url.href,
    statusMappings: { 'Đang xử lý': 'PROCESSING' } };
}
