import { SOURCES } from '../adapters/source-registry.mjs';
import { READABLE_FIELDS, validateAdapterConfig } from '../adapters/base.mjs';
import { COLLECTOR_STATUSES } from '../normalizer/case-normalizer.mjs';
const $ = id => document.getElementById(id);
let configurations = {};
const selectors = ['listUrl', 'loggedInSelector', 'loggedOutSelector', 'tableSelector', 'headerSelector', 'rowSelector', 'cellSelector'];
function mappingRow(container, choices, label = '', value = '') {
  const row = document.createElement('div');
  const input = document.createElement('input');
  input.value = label; input.required = true; input.maxLength = 200;
  input.setAttribute('aria-label', container === 'mapping-rows' ? 'Tên cột trên cổng' : 'Trạng thái trên cổng');
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Trường tương ứng');
  for (const choice of choices) select.add(new Option(choice, choice));
  select.value = value || choices[0];
  const remove = document.createElement('button');
  remove.type = 'button'; remove.textContent = 'Bỏ'; remove.addEventListener('click', () => row.remove());
  row.append(input, select, remove); $(container).append(row);
}
function readMappings(container) {
  const mappings = Object.create(null);
  for (const row of $(container).children) {
    const label = row.querySelector('input').value.replace(/\s+/g, ' ').trim().normalize('NFC');
    if (!label || Object.hasOwn(mappings, label)) throw new Error('Tên cột/trạng thái không được trống hoặc trùng nhau.');
    mappings[label] = row.querySelector('select').value;
  }
  return mappings;
}
function loadSource() {
  const source = SOURCES.find(item => item.id === $('source').value);
  const config = configurations[source.id];
  $('source-info').textContent = `${source.supportedHosts.join(', ')} · ${config?.profile ? 'Đang dùng bộ đọc MOC tự nhận diện cột. Mở extension trên tab portal để đọc thử hoặc đồng bộ; biểu mẫu selector không áp dụng cho bộ đọc này.' : config ? 'Đã lưu cấu hình cục bộ' : 'Chưa cấu hình'}`;
  $('guided').querySelector('button[type="submit"]').disabled = !!config?.profile;
  for (const key of selectors) $(key).value = config?.[key] ?? (key === 'listUrl' ? source.url : '');
  $('reference').value = config?.evidence?.reference ?? '';
  $('verified').checked = false;
  $('mapping-rows').replaceChildren(); $('status-rows').replaceChildren();
  for (const [label, value] of Object.entries(config?.headerMappings ?? { '': 'caseCode' })) mappingRow('mapping-rows', [...READABLE_FIELDS], label, value);
  for (const [label, value] of Object.entries(config?.statusMappings ?? {})) mappingRow('status-rows', COLLECTOR_STATUSES, label, value);
  $('config').value = config ? JSON.stringify(config, null, 2) : '';
}
async function save(config) {
  validateAdapterConfig(config, config.sourceSystem);
  const result = await chrome.runtime.sendMessage({ type: 'SAVE_ADAPTER_CONFIG', config });
  if (!result?.ok) throw new Error(result?.error ?? 'Không lưu được.');
  configurations[config.sourceSystem] = config;
  $('source').value = config.sourceSystem; loadSource();
  $('guided-status').textContent = `Đã lưu ${config.sourceSystem}. Mở portal và chọn Đọc thử dữ liệu để kiểm tra.`;
}
for (const source of SOURCES) {
  $('source').add(new Option(`${source.id} · ${source.name}`, source.id));
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
    await save(config);
    $('status').textContent = `Đã lưu cấu hình ${config.sourceSystem}. Kiểm tra trên portal được phép trước khi vận hành.`;
  } catch (error) { $('status').textContent = error.message; }
});
$('source').addEventListener('change', loadSource);
$('add-mapping').addEventListener('click', () => mappingRow('mapping-rows', [...READABLE_FIELDS]));
$('add-status').addEventListener('click', () => mappingRow('status-rows', COLLECTOR_STATUSES));
$('guided').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const config = { sourceSystem: $('source').value, verified: $('verified').checked,
      evidence: { reference: $('reference').value.trim(), verifiedAt: new Date().toISOString() },
      ...Object.fromEntries(selectors.map(key => [key, $(key).value.trim()])),
      headerMappings: readMappings('mapping-rows'), statusMappings: readMappings('status-rows') };
    await save(config);
  } catch (error) { $('guided-status').textContent = error.message; }
});
try {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!state?.ok) throw new Error(state?.error ?? 'Không tải được cấu hình đã lưu.');
  configurations = state.configurations ?? {};
  loadSource();
} catch (error) { $('guided-status').textContent = error.message; }
