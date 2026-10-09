import { SOURCES } from '../adapters/source-registry.mjs';
const $ = id => document.getElementById(id);
for (const source of SOURCES) {
  const item = document.createElement('li');
  item.textContent = `${source.id} · ${source.name} · ${source.adapterStatus} · ${source.supportedHosts.join(', ')}`;
  $('sources').append(item);
}
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (file && file.size <= 32768) $('config').value = await file.text();
  else $('status').textContent = 'File cấu hình tối đa 32KB.';
});
$('adapter').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if ($('config').value.length > 32768) throw new Error('Cấu hình vượt quá 32KB.');
    const config = JSON.parse($('config').value);
    const result = await chrome.runtime.sendMessage({ type: 'SAVE_ADAPTER_CONFIG', config });
    if (!result?.ok) throw new Error(result?.error ?? 'Không lưu được.');
    $('status').textContent = `Đã lưu cấu hình ${config.sourceSystem}. Kiểm tra trên portal được phép trước khi vận hành.`;
  } catch (error) { $('status').textContent = error.message; }
});
