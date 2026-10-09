import {e, icon, ROLE_LABELS, empty, toast, remaining} from './ui.js';
import {renderPage, bindPage} from './pages.js';

const state = {user:null, csrfToken:null, demoMode:false, sources:[], catalogs:{}, renderId:0, authConfig:{mode:'local'}};
const app = document.querySelector('#app');
const pageTitles = {
  dashboard:'Tổng quan điều hành', cases:'Hồ sơ', alerts:'Trung tâm cảnh báo', sources:'Nguồn dữ liệu',
  agencies:'Cơ quan', departments:'Phòng / đơn vị', officers:'Cán bộ', procedures:'Thủ tục',
  imports:'Nhập dữ liệu', reports:'Báo cáo', settings:'Cấu hình nghiệp vụ', users:'Người dùng', roles:'Vai trò & quyền',
  audit:'Nhật ký kiểm toán', sync:'Lịch sử đồng bộ', notifications:'Thông báo'
};

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {'Accept':'application/json', ...options.headers};
  if (options.body != null) headers['Content-Type'] = 'application/json';
  if (!['GET','HEAD'].includes(method)) headers['X-CSRF-Token'] = state.csrfToken || '';
  const response = await fetch(`/api${path}`, {credentials:'same-origin', ...options, method, headers, body:options.body == null ? undefined : JSON.stringify(options.body)});
  let data;
  try { data = await response.json(); } catch { throw new Error('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.'); }
  if (!response.ok) {
    const error = new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Yêu cầu không thành công (${response.status}).`);
    error.status = response.status; error.details = data;
    if (response.status === 401 && !path.startsWith('/auth/')) { state.user=null; showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); }
    throw error;
  }
  return data;
}

function query() { return new URLSearchParams(location.search); }
function route() {
  const parts=location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'admin' && ['users','roles'].includes(parts[1])) return parts.slice(1);
  if (parts[0] === 'audit-logs') parts[0]='audit';
  if (parts[0] === 'import') parts[0]='imports';
  return parts;
}
function link(path, overrides = {}, clear = false) {
  const params = clear ? new URLSearchParams() : query();
  // Global source scope survives every navigation, including metric drill downs.
  if (clear && query().get('sourceSystem')) params.set('sourceSystem', query().get('sourceSystem'));
  for (const [key,value] of Object.entries(overrides)) {
    if (value == null || value === '') params.delete(key); else params.set(key,String(value));
  }
  return `${path}${params.size ? '?' + params.toString() : ''}`;
}
function navigate(path, {replace = false} = {}) {
  if (replace) history.replaceState(null,'',path); else history.pushState(null,'',path);
  document.querySelector('.sidebar')?.classList.remove('open');
  render(); window.scrollTo({top:0,behavior:'instant'});
}
function can(permission) {
  const role = state.user?.role;
  if (permission === 'admin') return role === 'SYSTEM_ADMIN';
  if (permission === 'manage') return ['SYSTEM_ADMIN','CENTRAL_ADMIN'].includes(role);
  if (permission === 'write') return Boolean(role && role !== 'VIEWER');
  return Boolean(state.user);
}

const ctx = {state, api, query, route, link, navigate, can, refresh:render, reloadCatalogs:loadCatalogs};

function navItem(path, label, symbol, current) {
  return `<a class="nav-link ${current === path.slice(1) ? 'active' : ''}" href="${e(link(path,{},true))}" data-nav ${current === path.slice(1) ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${e(label)}</span></a>`;
}
function shell() {
  const current = route()[0] || 'dashboard';
  const user = state.user;
  app.innerHTML = `<div class="shell"><aside class="sidebar" id="sidebar" aria-label="Điều hướng chính">
    <a class="brand" href="${e(link('/dashboard',{},true))}" data-nav><span class="brand-mark">${icon('shield')}</span><span><strong>GIÁM SÁT HỒ SƠ</strong><small>THỦ TỤC HÀNH CHÍNH</small></span></a>
    <nav><div class="nav-group">Điều hành</div>
    ${navItem('/dashboard','Tổng quan','dashboard',current)}${navItem('/cases','Danh sách hồ sơ','cases',current)}${navItem('/alerts','Trung tâm cảnh báo','alerts',current)}
    <div class="nav-group">Phạm vi quản lý</div>${navItem('/sources','Nguồn dữ liệu','sources',current)}${navItem('/agencies','Cơ quan','building',current)}${navItem('/departments','Phòng / đơn vị','building',current)}${navItem('/officers','Cán bộ','users',current)}${navItem('/procedures','Thủ tục','cases',current)}
    <div class="nav-group">Dữ liệu & báo cáo</div>${can('write') ? navItem('/imports','Nhập Excel / CSV','import',current) : ''}${navItem('/reports','Báo cáo tổng hợp','reports',current)}${navItem('/sync','Lịch sử đồng bộ','sync',current)}
    ${can('manage') ? `<div class="nav-group">Quản trị</div>${navItem('/settings','Cấu hình nghiệp vụ','settings',current)}${can('admin') ? navItem('/audit','Nhật ký kiểm toán','audit',current) : ''}` : ''}
    ${can('admin') ? `${navItem('/users','Người dùng','users',current)}${navItem('/roles','Vai trò & quyền','shield',current)}` : ''}</nav>
    <div class="sidebar-footer"><span>Giám sát tập trung · phiên bản 1.0</span><span>Múi giờ Việt Nam (UTC+07:00)</span></div>
    </aside><div class="main-shell"><header class="topbar"><button class="icon-button mobile-menu" id="menu-toggle" aria-label="Mở điều hướng" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>
    <div class="topbar-title">Hệ thống giám sát <span aria-hidden="true">/</span> <strong>${e(pageTitles[current] || 'Hồ sơ')}</strong></div>
    <div class="topbar-actions"><a href="${e(link('/notifications',{},true))}" class="icon-button" data-nav aria-label="Xem thông báo">${icon('bell')}</a>
    <div class="user-info"><span class="avatar">${e((user.displayName || user.username || 'U').slice(0,1).toUpperCase())}</span><span><strong>${e(user.displayName || user.username)}</strong><small>${e(ROLE_LABELS[user.role] || user.role)}</small></span></div>
    <button class="icon-button" id="logout" aria-label="Đăng xuất">${icon('logout')}</button></div></header>
    <main class="content" id="page-content" tabindex="-1"><div class="loading-state" role="status"><span class="spinner"></span>Đang tải dữ liệu…</div></main></div></div>`;
  document.querySelector('#logout').addEventListener('click', async () => {
    try { await api('/auth/logout',{method:'POST'}); state.user=null; state.csrfToken=null; history.replaceState(null,'','/login'); showLogin(); }
    catch(error) { toast(error.message,'error'); }
  });
  document.querySelector('#menu-toggle').addEventListener('click', event => {
    const open = document.querySelector('.sidebar').classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded',String(open));
  });
}

async function render() {
  if (!state.user) return showLogin();
  const id = ++state.renderId;
  if (location.pathname === '/' || location.pathname === '/login') history.replaceState(null,'',link('/dashboard',{},true));
  shell();
  const content = document.querySelector('#page-content');
  try {
    const result = await renderPage(ctx);
    if (id !== state.renderId || !state.user) return;
    content.innerHTML = (state.demoMode ? '<div class="notice warning">CHẾ ĐỘ DEMO · Dữ liệu kiểm thử được tạo riêng cho môi trường demo; không dùng để kết luận nghiệp vụ.</div>' : '') + result;
    content.insertAdjacentHTML('beforeend', '<footer class="page-footer"><span>Dữ liệu hiển thị theo phạm vi quyền được cấp.</span><span>Ngày hẹn trả chính thức từ hệ thống nguồn · UTC+07:00</span></footer>');
    bindPage(ctx);
    updateCountdowns();
    document.title = `${pageTitles[route()[0]] || 'Chi tiết hồ sơ'} · Giám sát TTHC`;
  } catch(error) {
    if (id !== state.renderId || !state.user) return;
    const permission = error.status === 403;
    content.innerHTML = empty(permission ? 'Bạn chưa được cấp quyền' : 'Không thể tải dữ liệu', permission ? 'Vui lòng liên hệ quản trị viên để kiểm tra vai trò và phạm vi dữ liệu.' : error.message, `<button class="button secondary" id="retry">Thử lại</button>`);
    document.querySelector('#retry').addEventListener('click',render);
  }
}

function showLogin(message = '') {
  ++state.renderId;
  const google = state.authConfig.mode === 'google';
  const reasons = {permission_denied:'Email Google chưa được cấp quyền hoạt động. Liên hệ quản trị viên để kiểm tra bảng phân quyền.',unavailable:'Chưa kết nối được Google Sheet. Vui lòng thử lại sau.',google_failed:'Đăng nhập Google chưa hoàn tất. Vui lòng thử lại.'};
  if (!message) message = reasons[new URLSearchParams(location.search).get('authError')] || '';
  app.innerHTML = `<div class="login-page"><section class="login-intro"><div class="brand"><span class="brand-mark">${icon('shield')}</span><span><strong>GIÁM SÁT HỒ SƠ</strong><small>THỦ TỤC HÀNH CHÍNH</small></span></div>
    <h1>Theo dõi tiến độ.<br>Chủ động điều hành.</h1><p>Giám sát và cảnh báo hồ sơ sắp trễ, trễ hạn từ nhiều hệ thống Bộ, ngành và địa phương trên một nền tảng tập trung.</p>
    <ul class="login-points"><li>${icon('sources')}Tổng hợp nhiều nguồn dữ liệu</li><li>${icon('alerts')}Cảnh báo minh bạch theo quy tắc</li><li>${icon('shield')}Phân quyền theo phạm vi quản lý</li></ul><small>Phục vụ công tác quản lý thủ tục hành chính</small></section>
    <section class="login-form-area"><form class="login-form" id="login-form"><div class="eyebrow">CỔNG ĐIỀU HÀNH</div><h1>Đăng nhập hệ thống</h1><p>${google ? 'Sử dụng tài khoản Google đã được cấp quyền trong bảng quản lý.' : 'Sử dụng tài khoản giám sát được quản trị viên cấp.'}</p>
    ${google ? '' : `<label class="field"><span>Tên đăng nhập</span><input name="username" autocomplete="username" required maxlength="120" autofocus></label>
    <label class="field"><span>Mật khẩu</span><input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
    `}<div class="error-inline" id="login-error" role="alert">${e(message)}</div>${google ? '<a class="button" href="/api/auth/google/start">Đăng nhập bằng Google</a>' : '<button class="button" type="submit">Đăng nhập →</button>'}
    <div class="login-footnote">Tài khoản này dùng cho hệ thống giám sát trung tâm. Người sử dụng tự đăng nhập vào các cổng Bộ, ngành bằng tài khoản đã được cấp.</div></form></section></div>`;
  if (google) return;
  document.querySelector('#login-form').addEventListener('submit',async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled=true; button.textContent='Đang xác thực…';
    try {
      const values = new FormData(form);
      const response = await api('/auth/login',{method:'POST',body:{username:values.get('username'),password:values.get('password')}});
      state.user=response.user; state.csrfToken=response.csrfToken; state.demoMode=Boolean(response.demoMode);
      await loadCatalogs();
      navigate(location.pathname === '/login' ? '/dashboard' : location.pathname + location.search,{replace:true});
    } catch(error) { document.querySelector('#login-error').textContent=error.message; }
    finally { button.disabled=false; button.textContent='Đăng nhập →'; }
  });
}

async function loadCatalogs() {
  const results = await Promise.allSettled([api('/sources'),api('/catalogs')]);
  if (results[0].status === 'fulfilled') state.sources=results[0].value.items || [];
  if (results[1].status === 'fulfilled') state.catalogs=results[1].value;
}
function updateCountdowns() {
  for (const element of document.querySelectorAll('[data-countdown]')) element.textContent=remaining(element.dataset.countdown);
}
document.addEventListener('click',event => {
  const anchor = event.target.closest('a[data-nav]');
  if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault(); navigate(anchor.getAttribute('href'));
});
window.addEventListener('popstate',render);
setInterval(updateCountdowns,30000);
try { state.authConfig = await api('/auth/config'); }
catch { showLogin('Không kết nối được với máy chủ. Vui lòng tải lại trang.'); }
try {
  const response = await api('/auth/me'); state.user=response.user; state.csrfToken=response.csrfToken; state.demoMode=Boolean(response.demoMode);
  if (state.user) { await loadCatalogs(); await render(); } else showLogin();
} catch(error) { showLogin(error.status === 401 ? '' : 'Không kết nối được với máy chủ. Vui lòng kiểm tra máy chủ và thử lại.'); }
