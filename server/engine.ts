import type { CanonicalCase, RuleConfig, Evaluation, BusinessCalendar } from '../shared/domain.ts';

// Notification thresholds from the user's example; never alter an official due date.
export const DEFAULT_RULE: RuleConfig = {
  watchSeconds: 604800, warningSeconds: 259200, highRiskSeconds: 86400,
  criticalOverdueSeconds: 259200, highRiskScore: 70, uncertainStatusPolicy: 'REVIEW',
  risk: { warningPoints: 35, urgentPoints: 70, remainingStepPoints: 5, stepDelayPoints: 15 },
};
const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'RETURNED']);
const UNCERTAIN = new Set(['UNKNOWN', 'PAUSED', 'WAITING_ADDITIONAL_DOCUMENTS', 'WAITING_FOR_CITIZEN']);
export function evaluateCase(record: CanonicalCase, rule: RuleConfig = DEFAULT_RULE, now: number = Date.now()): Evaluation {
  const date = record.extensionDueAt || (Object.hasOwn(record, 'dueAt') ? record.dueAt : record.originalDueAt) || null;
  const due = date ? Date.parse(date) : NaN;
  const result: Evaluation = {
    effectiveDueAt: Number.isFinite(due) ? date : null,
    remainingSeconds: Number.isFinite(due) ? Math.floor((due - now) / 1000) : null,
    isOverdue: false, overdueSeconds: 0, alertLevel: 'SAFE', riskScore: 0,
    riskReasons: [], triggeredRule: null, completionResult: null, needsReview: false,
  };
  if (TERMINAL.has(record.normalizedStatus)) {
    if (record.normalizedStatus === 'COMPLETED') {
      const completed = record.completedAt ? Date.parse(record.completedAt) : NaN;
      result.completionResult = Number.isFinite(completed) && Number.isFinite(due) ? (completed <= due ? 'ON_TIME' : 'LATE') : 'UNKNOWN';
      result.needsReview = result.completionResult === 'UNKNOWN';
    }
    result.remainingSeconds = null;
    return result;
  }
  if (!Number.isFinite(due) || (UNCERTAIN.has(record.normalizedStatus) && rule.uncertainStatusPolicy === 'REVIEW')) {
    result.needsReview = true; result.alertLevel = 'NEEDS_REVIEW';
    result.triggeredRule = !Number.isFinite(due) ? 'MISSING_OFFICIAL_DUE_DATE' : 'UNCONFIRMED_STATUS_POLICY';
    result.riskReasons.push(!Number.isFinite(due) ? 'Chưa có ngày hẹn trả chính thức; không suy ra từ số ngày xử lý.' : 'Trạng thái tạm dừng/chờ/không rõ cần xác nhận cách tính hạn.');
    return result;
  }
  const remaining = result.remainingSeconds as number;
  if (remaining < 0) {
    result.isOverdue = true; result.overdueSeconds = -remaining;
    result.alertLevel = -remaining >= rule.criticalOverdueSeconds ? 'CRITICAL_OVERDUE' : 'OVERDUE';
    result.triggeredRule = result.alertLevel === 'CRITICAL_OVERDUE' ? 'CRITICAL_OVERDUE_THRESHOLD' : 'OFFICIAL_DUE_PASSED';
    result.riskScore = 100; result.riskReasons.push('Đã vượt ngày hẹn trả chính thức của nguồn.');
    return result;
  }
  if (remaining <= rule.highRiskSeconds) {
    result.riskScore += rule.risk.urgentPoints; result.riskReasons.push(`Còn ${Math.ceil(remaining / 3600)} giờ đến ngày hẹn trả.`);
  } else if (remaining <= rule.warningSeconds) {
    result.riskScore += rule.risk.warningPoints; result.riskReasons.push(`Còn ${Math.ceil(remaining / 3600)} giờ đến ngày hẹn trả.`);
  }
  if (Number.isInteger(record.currentStep) && Number.isInteger(record.totalSteps) && (record.totalSteps as number) > (record.currentStep as number)) {
    const steps = (record.totalSteps as number) - (record.currentStep as number);
    if (remaining <= rule.warningSeconds) { result.riskScore += Math.min(20, steps * rule.risk.remainingStepPoints); result.riskReasons.push(`Nguồn ghi nhận còn ${steps} bước xử lý.`); }
  }
  const average = record.metadata?.averageStepSeconds;
  if (typeof average === 'number' && average > 0 && record.currentStepStartedAt && now - Date.parse(record.currentStepStartedAt) > average * 1000) {
    result.riskScore += rule.risk.stepDelayPoints; result.riskReasons.push('Thời gian bước hiện tại vượt thời gian trung bình được cung cấp.');
  }
  result.riskScore = Math.max(0, Math.min(100, result.riskScore));
  if (remaining <= rule.highRiskSeconds || result.riskScore >= rule.highRiskScore) { result.alertLevel = 'HIGH_RISK'; result.triggeredRule = 'HIGH_RISK_THRESHOLD'; }
  else if (remaining <= rule.warningSeconds) { result.alertLevel = 'WARNING'; result.triggeredRule = 'WARNING_THRESHOLD'; }
  else if (remaining <= rule.watchSeconds) { result.alertLevel = 'WATCH'; result.triggeredRule = 'WATCH_THRESHOLD'; }
  return result;
}
export function validateRule(rule: RuleConfig): void {
  for (const key of ['watchSeconds', 'warningSeconds', 'highRiskSeconds', 'criticalOverdueSeconds', 'highRiskScore'] as const) {
    if (!Number.isSafeInteger(rule[key]) || rule[key] < 0) throw new Error(`Cấu hình ${key} phải là số nguyên không âm.`);
  }
  if (rule.watchSeconds < rule.warningSeconds || rule.warningSeconds < rule.highRiskSeconds || rule.criticalOverdueSeconds <= 0 || rule.highRiskScore < 1 || rule.highRiskScore > 100) throw new Error('Các ngưỡng cảnh báo không hợp lệ.');
  if (!['REVIEW', 'USE_SOURCE_DUE'].includes(rule.uncertainStatusPolicy)) throw new Error('Chính sách trạng thái chưa hợp lệ.');
  for (const value of Object.values(rule.risk || {})) if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new Error('Trọng số risk không hợp lệ.');
  for (const key of ['warningPoints', 'urgentPoints', 'remainingStepPoints', 'stepDelayPoints'] as const) if (!Number.isSafeInteger(rule.risk?.[key])) throw new Error(`Thiếu trọng số ${key}.`);
}
export function addWorkingDays(start: string, days: number, calendar: BusinessCalendar): string {
  if (!calendar.confirmed) throw new Error('Cần xác nhận lịch làm việc trước khi tính SLA.');
  if (!Number.isSafeInteger(days) || days < 0 || days > 3660 || !calendar.workingWeekdays.length) throw new Error('Số ngày/lịch làm việc không hợp lệ.');
  const date = new Date(Date.parse(start) + 7 * 3600000);
  if (!Number.isFinite(date.getTime())) throw new Error('Ngày bắt đầu không hợp lệ.');
  for (let count = 0, iterations = 0; count < days; iterations++) {
    if (iterations > 20000) throw new Error('Lịch không có đủ ngày làm việc.');
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.toISOString().slice(0, 10);
    if (calendar.workingDates.includes(day) || (calendar.workingWeekdays.includes(date.getUTCDay()) && !calendar.holidays.includes(day))) count++;
  }
  return new Date(date.getTime() - 7 * 3600000).toISOString();
}
