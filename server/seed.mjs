import { SOURCES } from '../shared/registry.mjs';
import { syncBatch } from './cases.mjs';
export function seedDemo(db, admin, now = Date.now()) {
  const iso = offset => new Date(now + offset * 3600000).toISOString();
  const procedures = ['Cấp phép xây dựng', 'Điều chỉnh giấy phép', 'Đăng ký kinh doanh', 'Cấp giấy chứng nhận', 'Tiếp nhận thông báo', 'Thẩm định dự án', 'Cấp phép hoạt động', 'Đăng ký thay đổi', 'Chứng thực văn bản', 'Giải quyết đề nghị'];
  const officers = ['Nguyễn An', 'Trần Bình', 'Lê Chi', 'Phạm Dũng', 'Võ Giang', 'Đặng Hà', 'Bùi Khánh', 'Đỗ Linh', 'Hồ Minh', 'Dương Ngọc'];
  const names = ['Cơ quan minh họa A', 'Cơ quan minh họa B', 'Cơ quan minh họa C'];
  const scenarios = [
    { due: 240, status: 'PROCESSING' }, { due: 100, status: 'RECEIVED' }, { due: 48, status: 'PROCESSING' },
    { due: 12, status: 'PROCESSING' }, { due: -12, status: 'PROCESSING' }, { due: -120, status: 'PROCESSING' },
    { due: -24, status: 'COMPLETED', completed: -30 }, { due: -48, status: 'COMPLETED', completed: -36 },
    { due: -6, status: 'PAUSED' }, { due: null, status: 'PROCESSING' }, { due: 2, status: 'WAITING_ADDITIONAL_DOCUMENTS' },
    { due: 18, status: 'PROCESSING', extended: 120 },
  ];
  let created = 0;
  for (const source of SOURCES) {
    const records = scenarios.map((scenario, index) => ({
      caseCode: `DEMO-${source.id}-${String(index + 1).padStart(4, '0')}`,
      sourceRecordId: `demo:${source.id}:${index + 1}`, sourceUrl: source.url,
      procedureCode: `DEMO.${String(index % 10 + 1).padStart(3, '0')}`, procedureName: `${procedures[index % 10]} (minh họa)`,
      submittedAt: iso(-240), receivedAt: iso(-216), dueAt: scenario.due === null ? null : iso(scenario.due),
      extensionDueAt: scenario.extended ? iso(scenario.extended) : null,
      completedAt: scenario.completed ? iso(scenario.completed) : null,
      applicantName: `Công dân minh họa ${index + 1}`,
      agencyId: `${source.id}:DEMO:AGENCY:${index % 3}`, agencyName: names[index % 3],
      departmentId: `${source.id}:DEMO:DEPT:${index % 5}`, departmentName: `Phòng minh họa ${index % 5 + 1}`,
      officerId: `${source.id}:DEMO:OFFICER:${index % 10}`, officerName: `${officers[index % 10]} (minh họa)`,
      sourceStatus: scenario.status, normalizedStatus: scenario.status,
      currentStep: 1, totalSteps: 4, currentStepStartedAt: iso(-36),
      metadata: { demo: true, averageStepSeconds: 172800 }, lastSourceUpdateAt: iso(0),
    }));
    const result = syncBatch(db, { sourceSystem: source.id, records, kind: 'DEMO', batchId: `initial-demo-${source.id}` }, admin);
    if (result.failed) throw new Error(`Seed ${source.id}: ${JSON.stringify(result.errors)}`);
    created += result.created;
  }
  db.prepare('INSERT OR REPLACE INTO system_settings VALUES (?,?)').run('demoMode', 'true');
  return created;
}
