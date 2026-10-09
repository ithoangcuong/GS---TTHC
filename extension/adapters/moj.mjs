import { WaitingForSampleAdapter } from './base.mjs';
/** WAITING_FOR_SAMPLE: no real authenticated DOM/API, login indicator or pagination supplied. */
export class MojAdapter extends WaitingForSampleAdapter {
  constructor(config) { super('MOJ', config); }
}
