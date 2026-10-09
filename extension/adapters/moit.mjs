import { WaitingForSampleAdapter } from './base.mjs';
/** WAITING_FOR_SAMPLE: no real authenticated DOM/API, login indicator or pagination supplied. */
export class MoitAdapter extends WaitingForSampleAdapter {
  constructor(config) { super('MOIT', config); }
}
