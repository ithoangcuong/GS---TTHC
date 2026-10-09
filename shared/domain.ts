export type Status = 'NEW' | 'RECEIVED' | 'PROCESSING' | 'WAITING_ADDITIONAL_DOCUMENTS' | 'WAITING_FOR_CITIZEN' | 'PAUSED' | 'TRANSFERRED' | 'COMPLETED' | 'RETURNED' | 'CANCELLED' | 'OVERDUE' | 'UNKNOWN';
export type AlertLevel = 'SAFE' | 'WATCH' | 'WARNING' | 'HIGH_RISK' | 'OVERDUE' | 'CRITICAL_OVERDUE' | 'NEEDS_REVIEW';
export interface CanonicalCase {
  id?: string; sourceSystem: string; caseCode: string; normalizedStatus: Status;
  dueAt?: string | null; originalDueAt?: string | null; extensionDueAt?: string | null;
  completedAt?: string | null; receivedAt?: string | null; submittedAt?: string | null;
  currentStep?: number | null; totalSteps?: number | null; currentStepStartedAt?: string | null;
  agencyId?: string | null; procedureCode?: string | null; lastSourceUpdateAt?: string | null;
  metadata?: Record<string, unknown>; [key: string]: unknown;
}
export interface RuleConfig {
  watchSeconds: number; warningSeconds: number; highRiskSeconds: number;
  criticalOverdueSeconds: number; highRiskScore: number;
  uncertainStatusPolicy: 'REVIEW' | 'USE_SOURCE_DUE';
  risk: { warningPoints: number; urgentPoints: number; remainingStepPoints: number; stepDelayPoints: number };
}
export interface Evaluation {
  effectiveDueAt: string | null; remainingSeconds: number | null;
  isOverdue: boolean; overdueSeconds: number; alertLevel: AlertLevel;
  riskScore: number; riskReasons: string[]; triggeredRule: string | null;
  completionResult: 'ON_TIME' | 'LATE' | 'UNKNOWN' | null; needsReview: boolean;
}
export interface BusinessCalendar { confirmed: boolean; workingWeekdays: number[]; holidays: string[]; workingDates: string[] }
