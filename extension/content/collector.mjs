import { adapterForHost } from '../adapters/registry.mjs';

// Isolated world. No window/postMessage/event bridge, portal cookies, storage, or page JS state.
let collecting = false;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || (sender.url && !sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`))
    || message?.type !== 'COLLECT_VERIFIED_TABLE') return false;
  if (collecting) { sendResponse({ ok: false, error: 'Collector đang chạy.' }); return false; }
  collecting = true;
  try {
    const adapter = adapterForHost(location.hostname, { [message.sourceSystem]: message.config });
    if (document.visibilityState !== 'visible') throw new Error('Chỉ thu thập trên trang đang hiển thị.');
    if (!adapter || adapter.getSourceId() !== message.sourceSystem || location.protocol !== 'https:') throw new Error('Hostname nguồn không hợp lệ.');
    const result = adapter.extractCases(document, location.href);
    sendResponse({ ok: true, ...result, sourceSystem: adapter.getSourceId() });
  } catch (error) { sendResponse({ ok: false, error: error.message }); }
  finally { collecting = false; }
  return false;
});
