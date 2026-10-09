import { sourceByHostname } from './source-registry.mjs';
import { TphcmAdapter } from './tphcm.mjs';
import { MofAdapter } from './mof.mjs';
import { MohaAdapter } from './moha.mjs';
import { MocAdapter } from './moc.mjs';
import { MoitAdapter } from './moit.mjs';
import { MaeAdapter } from './mae.mjs';
import { MohAdapter } from './moh.mjs';
import { MoetAdapter } from './moet.mjs';
import { MojAdapter } from './moj.mjs';
import { BvhttdlAdapter } from './bvhttdl.mjs';
import { BdttgAdapter } from './bdttg.mjs';

const FACTORIES = Object.freeze({
  TPHCM: config => new TphcmAdapter(config),
  MOF: config => new MofAdapter(config),
  MOHA: config => new MohaAdapter(config),
  MOC: config => new MocAdapter(config),
  MOIT: config => new MoitAdapter(config),
  MAE: config => new MaeAdapter(config),
  MOH: config => new MohAdapter(config),
  MOET: config => new MoetAdapter(config),
  MOJ: config => new MojAdapter(config),
  BVHTTDL: config => new BvhttdlAdapter(config),
  BDTTG: config => new BdttgAdapter(config),
});
export function adapterForHost(hostname, configurations = {}) {
  const source = sourceByHostname(hostname);
  return source?.enabled ? FACTORIES[source.id](configurations[source.id] ?? null) : null;
}
