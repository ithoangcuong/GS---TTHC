import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCase, DEFAULT_RULE, validateRule, addWorkingDays } from '../server/engine.ts';
const now = Date.parse('2026-10-05T03:00:00Z');
const base = { sourceSystem: 'TPHCM', caseCode: 'TEST-1', normalizedStatus: 'PROCESSING' };
const date = seconds => new Date(now + seconds * 1000).toISOString();
test('official future due date, warning and high-risk thresholds including exact boundary', () => {
  assert.equal(evaluateCase({ ...base, dueAt: date(1000000) }, DEFAULT_RULE, now).alertLevel, 'SAFE');
  assert.equal(evaluateCase({ ...base, dueAt: date(500000) }, DEFAULT_RULE, now).alertLevel, 'WATCH');
  assert.equal(evaluateCase({ ...base, dueAt: date(259200) }, DEFAULT_RULE, now).alertLevel, 'WARNING');
  assert.equal(evaluateCase({ ...base, dueAt: date(86400) }, DEFAULT_RULE, now).alertLevel, 'HIGH_RISK');
  assert.equal(evaluateCase({ ...base, dueAt: date(0) }, DEFAULT_RULE, now).isOverdue, false);
});
test('overdue and critical based on official timestamp; source OVERDUE does not bypass due date', () => {
  assert.equal(evaluateCase({ ...base, dueAt: date(-1) }, DEFAULT_RULE, now).alertLevel, 'OVERDUE');
  assert.equal(evaluateCase({ ...base, dueAt: date(-259200) }, DEFAULT_RULE, now).alertLevel, 'CRITICAL_OVERDUE');
  assert.equal(evaluateCase({ ...base, normalizedStatus: 'OVERDUE', dueAt: date(1000000) }, DEFAULT_RULE, now).isOverdue, false);
});
test('completed on time at equality, completed late and missing completion never uses current time', () => {
  for (const [offset, expected] of [[-1, 'ON_TIME'], [0, 'ON_TIME'], [1, 'LATE']]) {
    const result = evaluateCase({ ...base, normalizedStatus: 'COMPLETED', dueAt: date(-86400), completedAt: date(-86400 + offset) }, DEFAULT_RULE, now);
    assert.equal(result.completionResult, expected); assert.equal(result.isOverdue, false); assert.equal(result.alertLevel, 'SAFE'); assert.equal(result.remainingSeconds, null);
  }
  const result = evaluateCase({ ...base, normalizedStatus: 'COMPLETED', dueAt: date(-86400) }, DEFAULT_RULE, now);
  assert.equal(result.completionResult, 'UNKNOWN'); assert.equal(result.needsReview, true);
});
test('official extension wins without modifying original; explicit withdrawal goes to review', () => {
  const record = { ...base, originalDueAt: date(-100000), dueAt: date(-1000), extensionDueAt: date(1000000) };
  const result = evaluateCase(record, DEFAULT_RULE, now); assert.equal(result.effectiveDueAt, record.extensionDueAt); assert.equal(result.isOverdue, false); assert.equal(record.originalDueAt, date(-100000));
  assert.equal(evaluateCase({ ...base, originalDueAt: date(-1000), dueAt: null }, DEFAULT_RULE, now).alertLevel, 'NEEDS_REVIEW');
});
test('cancelled/returned never generate ordinary overdue', () => {
  for (const status of ['CANCELLED', 'RETURNED']) { const result = evaluateCase({ ...base, normalizedStatus: status, dueAt: date(-1000000) }, DEFAULT_RULE, now); assert.equal(result.alertLevel, 'SAFE'); assert.equal(result.isOverdue, false); }
});
test('paused/waiting/unknown need confirmation, explicit configured policy uses source due without guessed pause adjustment', () => {
  for (const status of ['PAUSED', 'WAITING_ADDITIONAL_DOCUMENTS', 'WAITING_FOR_CITIZEN', 'UNKNOWN']) {
    const record = { ...base, normalizedStatus: status, dueAt: date(-1000), totalPausedSeconds: 9000000 };
    assert.equal(evaluateCase(record, DEFAULT_RULE, now).alertLevel, 'NEEDS_REVIEW');
    assert.equal(evaluateCase(record, { ...DEFAULT_RULE, uncertainStatusPolicy: 'USE_SOURCE_DUE' }, now).alertLevel, 'OVERDUE');
  }
});
test('missing due date and invalid timestamp cannot produce SAFE conclusion', () => {
  assert.equal(evaluateCase(base, DEFAULT_RULE, now).alertLevel, 'NEEDS_REVIEW');
  assert.equal(evaluateCase({ ...base, dueAt: 'invalid' }, DEFAULT_RULE, now).alertLevel, 'NEEDS_REVIEW');
});
test('risk reasons use supplied steps and measured average only, clamp score 0–100', () => {
  const record = { ...base, dueAt: date(3600), currentStep: 1, totalSteps: 9, currentStepStartedAt: date(-100000), metadata: { averageStepSeconds: 3600 } };
  const result = evaluateCase(record, DEFAULT_RULE, now); assert.equal(result.riskScore, 100); assert.equal(result.riskReasons.length, 3);
  const simple = evaluateCase({ ...base, dueAt: date(3600) }, DEFAULT_RULE, now); assert.equal(simple.riskScore, 70); assert.equal(simple.riskReasons.length, 1);
});
test('rule configuration rejects invalid order, weights and thresholds', () => {
  assert.doesNotThrow(() => validateRule(DEFAULT_RULE));
  for (const rule of [{ ...DEFAULT_RULE, warningSeconds: 1 }, { ...DEFAULT_RULE, highRiskScore: 0 }, { ...DEFAULT_RULE, uncertainStatusPolicy: 'GUESS' }, { ...DEFAULT_RULE, risk: {} }, { ...DEFAULT_RULE, criticalOverdueSeconds: -1 }]) assert.throws(() => validateRule(rule));
});
test('calendar refuses unconfirmed rules and applies only confirmed holiday/makeup/weekdays', () => {
  assert.throws(() => addWorkingDays('2026-10-02T09:00:00+07:00', 1, { confirmed: false, workingWeekdays: [], holidays: [], workingDates: [] }));
  const calendar = { confirmed: true, workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-10-05'], workingDates: ['2026-10-03'] };
  assert.equal(addWorkingDays('2026-10-02T09:00:00+07:00', 1, calendar), '2026-10-03T02:00:00.000Z');
  assert.equal(addWorkingDays('2026-10-02T09:00:00+07:00', 2, calendar), '2026-10-06T02:00:00.000Z');
});
