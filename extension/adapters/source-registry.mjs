import { SOURCES as LEGACY_SOURCES } from '../shared/registry.mjs';

/** Eleven sources with exact host allowlists. MOC uses the supplied list address. */
export const SOURCES = Object.freeze(LEGACY_SOURCES.map(source => Object.freeze({
  id: source.id, name: source.name,
  hostname: source.id === 'MOC' ? 'motcuabxd.moc.gov.vn' : source.hostname,
  url: source.id === 'MOC' ? source.suppliedListUrl : `https://${source.hostname}/`,
  adapter: source.adapter, version: '0.3.0', enabled: true,
  supportedHosts: Object.freeze(source.id === 'MOC' ? ['motcuabxd.moc.gov.vn', 'motcua.moc.gov.vn'] : [source.hostname]),
  adapterStatus: 'WAITING_FOR_SAMPLE',
})));
export function sourceById(id) { return SOURCES.find(source => source.id === id) ?? null; }
export function sourceByHostname(hostname) {
  return SOURCES.find(source => source.supportedHosts.includes(String(hostname).toLowerCase())) ?? null;
}
