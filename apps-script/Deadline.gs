var TTHC = TTHC || {};
TTHC.Deadline = (function () {
  'use strict';
  var TERMINAL = ['COMPLETED', 'RETURNED', 'CANCELLED'];
  function evaluate(record, settings, now) {
    settings = settings || TTHC.Settings.get();
    now = now === undefined ? Date.now() : Number(now);
    var official = Object.prototype.hasOwnProperty.call(record, 'dueAt') ? record.dueAt : record.originalDueAt || null;
    var effective = record.extensionConfirmed === true && record.extensionDueAt ? record.extensionDueAt : official;
    var due = effective ? Date.parse(effective) : NaN;
    var result = { effectiveDueAt: Number.isFinite(due) ? effective : null, remainingSeconds: null, isOverdue: false, overdueSeconds: 0, alertLevel: 'SAFE', riskScore: 0, riskReasons: [], completionResult: null, needsReview: false, normalizedStatus: record.normalizedStatus || 'UNKNOWN' };
    if (TERMINAL.indexOf(result.normalizedStatus) >= 0) {
      if (result.normalizedStatus === 'COMPLETED') {
        var completed = record.completedAt ? Date.parse(record.completedAt) : NaN;
        result.completionResult = Number.isFinite(completed) && Number.isFinite(due) ? (completed <= due ? 'ON_TIME' : 'LATE') : 'UNKNOWN';
        result.needsReview = result.completionResult === 'UNKNOWN';
      }
      return result;
    }
    var remaining = due - now;
    if (Number.isFinite(due)) result.remainingSeconds = remaining > 0 ? Math.ceil(remaining / 1000) : Math.floor(remaining / 1000);
    if (!Number.isFinite(due) || ['UNKNOWN', 'PAUSED', 'WAITING_ADDITIONAL_DOCUMENTS'].indexOf(result.normalizedStatus) >= 0) {
      result.alertLevel = 'NEEDS_REVIEW'; result.needsReview = true;
      result.riskReasons = [!Number.isFinite(due) ? 'Chưa có ngày hẹn trả chính thức.' : 'Cần xác nhận cách tính hạn cho trạng thái nguồn; chưa tự áp dụng tạm dừng hoặc gia hạn.'];
      return result;
    }
    if (remaining <= 0) {
      result.isOverdue = true; result.overdueSeconds = Math.max(0, -Math.floor(remaining / 1000)); result.alertLevel = 'OVERDUE'; result.normalizedStatus = 'OVERDUE'; result.riskScore = 100;
      result.riskReasons = ['Đã đến hoặc vượt ngày hẹn trả chính thức.'];
    } else if (remaining <= settings.warningSeconds * 1000) {
      result.alertLevel = 'WARNING'; result.riskScore = 50; result.riskReasons = ['Sắp đến ngày hẹn trả chính thức.'];
    }
    return result;
  }
  function nextBoundary(record, settings, now) {
    now = now || Date.now(); settings = settings || TTHC.Settings.get();
    var evaluation = evaluate(record, settings, now), times = [now + 60000];
    if (TERMINAL.indexOf(record.normalizedStatus) < 0 && evaluation.effectiveDueAt) {
      var due = Date.parse(evaluation.effectiveDueAt);
      [due - settings.warningSeconds * 1000, due].forEach(function (time) { if (time > now) times.push(time); });
    }
    if (record.lastObservedAt) { var stale = Date.parse(record.lastObservedAt) + settings.staleSeconds * 1000; if (stale > now) times.push(stale); }
    return Math.min.apply(Math, times);
  }
  return { evaluate: evaluate, nextBoundary: nextBoundary, terminal: TERMINAL };
})();
