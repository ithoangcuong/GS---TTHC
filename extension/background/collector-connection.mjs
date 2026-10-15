// Recover only a missing content-script receiver, never parser or authentication errors.
const missingReceiver = error => /Could not establish connection\. Receiving end does not exist\.?/i.test(String(error?.message ?? error));
const recoveryMessage = 'Không kết nối được bộ đọc trên tab này. Hãy tải lại trang Bộ Xây dựng/cổng nguồn, chờ trang tải xong rồi mở lại extension. Kiểm tra quyền truy cập trang của extension nếu lỗi còn tiếp diễn.';

export async function collectFromTab(chrome, tabId, sourceSystem, config, checkContext) {
  const message = { type: 'COLLECT_VERIFIED_TABLE', sourceSystem, config };
  const send = () => chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  try { return await send(); }
  catch (error) {
    if (!missingReceiver(error)) throw error;
  }
  // The user may have navigated while the initial message was in flight.
  await checkContext();
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] },
      files: ['content/collector.js'], world: 'ISOLATED' });
  } catch { throw new Error(recoveryMessage); }
  await checkContext();
  try { return await send(); }
  catch (error) {
    if (missingReceiver(error)) throw new Error(recoveryMessage);
    throw error;
  }
}
