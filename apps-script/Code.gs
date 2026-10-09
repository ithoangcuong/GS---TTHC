var TTHC = TTHC || {};
TTHC.View = (function () {
  function include(filename) {
    if (['Styles', 'Scripts'].indexOf(filename) < 0) TTHC.Utils.error('INVALID_TEMPLATE', 'Mẫu HTML không được phép.');
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }
  function message(title, message) {
    function escaped(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    return HtmlService.createHtmlOutput('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escaped(title) + '</title></head><body style="font:16px system-ui;max-width:640px;margin:10vh auto;padding:24px;color:#16304d"><h1>' + escaped(title) + '</h1><p>' + escaped(message) + '</p><p>Bạn có thể đóng tab này và quay lại TTHC Monitor.</p></body></html>').setTitle('TTHC Monitor');
  }
  return { include: include, message: message };
})();

/** Only these transport functions are exposed to a web client. Business methods live in TTHC. */
function rpc(action, payload, sessionToken) { return TTHC.Router.rpc(action, payload || {}, sessionToken); }

function doGet(event) {
  try {
    return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('TTHC Monitor').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    TTHC.Utils.log('ERROR', 'GET_FAILED', { code: error.code || 'INTERNAL_ERROR', requestId: TTHC.Utils.id() });
    return TTHC.View.message('Không thể hoàn tất yêu cầu', error.code ? error.message : 'Vui lòng thử lại hoặc liên hệ quản trị viên.');
  }
}

function doPost(event) {
  return ContentService.createTextOutput(JSON.stringify(TTHC.Router.post(event))).setMimeType(ContentService.MimeType.JSON);
}
