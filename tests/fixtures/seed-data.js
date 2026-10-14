'use strict';

// Deterministic, fully synthetic dataset for the integration tests: no real
// employee data ever goes into the repository. A few employee codes are fixed
// because the suites (and some business rules) refer to them.

const { INITIAL_TRAINING_TOPICS } = require('../../src/constants');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FIRST = ['محمد', 'أحمد', 'محمود', 'مصطفى', 'إبراهيم', 'علي', 'حسن', 'خالد', 'عمرو', 'يوسف', 'كريم', 'طارق', 'سامح', 'هشام', 'وليد'];
const LAST = ['عبد الله', 'السيد', 'حسين', 'عبد الرحمن', 'فتحي', 'سليمان', 'رمضان', 'شعبان', 'عثمان', 'منصور', 'الشافعي', 'النجار'];
const DEPARTMENTS = ['Production', 'Quality', 'Warehouse', 'Electrical Maintenance', 'Mechanical Maintenance', 'Preventive Maintenance', 'الصيانة الميكانيكية', 'M.B', 'IT Operations', 'HSE'];
const PERMIT_TYPES = [['hot', 'ساخن'], ['height', 'ارتفاع'], ['confined', 'أماكن مغلقة'], ['lifting', 'رفع'], ['loto', 'فصل وعزل'], ['general', 'عام']];
const PERMIT_STATUSES = ['approved', 'approved', 'closed_safe', 'closed_safe', 'pending_dept', 'pending_hse', 'rejected', 'rejected_area'];
const HAZARD_STATUSES = ['open', 'closed', 'closed', 'in_progress', 'assigned_to_maintenance'];

const FIXED_EMPLOYEES = [
  { empCode: '271', name: 'موظف سلامة أول', department: 'HSE', jobTitle: 'HSE Director' },
  { empCode: '6077', name: 'موظف سلامة ثاني', department: 'HSE', jobTitle: 'HSE Specialist' },
  { empCode: '6173', name: 'مسئول سلامة أ', department: 'HSE', jobTitle: 'HSE Engineer', email: 'hse.a@test.local' },
  { empCode: '62150', name: 'مسئول سلامة ب', department: 'HSE', jobTitle: 'HSE Engineer', email: 'hse.b@test.local' },
  { empCode: '66499', name: 'مسئول سلامة ج', department: 'HSE', jobTitle: 'HSE Engineer', email: 'hse.c@test.local' },
  { empCode: '5501', name: 'فني كهرباء', department: 'Electrical Maintenance', jobTitle: 'Electrician' },
  { empCode: '5943', name: 'فني ميكانيكا', department: 'الصيانة الميكانيكية', jobTitle: 'Mechanic' },
  { empCode: '2546', name: 'عامل إنتاج', department: 'Production', jobTitle: 'Operator' },
];

const pad = (n, w = 2) => String(n).padStart(w, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const noFlags = () => ({ areaAdmin: false, safetyAdmin: false, superAdmin: false, worker: false });

function buildSeedData({ now = new Date(), seed = 2026 } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const daysAgo = (max) => new Date(now.getTime() - Math.floor(rand() * max) * 864e5);

  const employees = FIXED_EMPLOYEES.map((e) => ({ role: 'worker', phone: '', ...e }));
  for (let i = 0; i < 140; i++) {
    employees.push({
      empCode: String(1000 + i),
      name: `${pick(FIRST)} ${pick(FIRST)} ${pick(LAST)}`,
      department: DEPARTMENTS[i % DEPARTMENTS.length],
      jobTitle: pick(['Operator', 'Technician', 'Supervisor', 'Engineer']),
      role: 'worker',
      phone: '',
    });
  }

  const permits = [];
  for (let i = 0; i < 260; i++) {
    const date = daysAgo(540);
    const emp = pick(employees);
    const [typeKey, typeLabel] = pick(PERMIT_TYPES);
    const status = pick(PERMIT_STATUSES);
    permits.push({
      id: `WP-${date.getFullYear()}-${pad(i + 1, 4)}`,
      typeKey,
      typeLabel,
      typeFullLabel: typeLabel,
      department: emp.department,
      shift: pick(['الأولى', 'الثانية', 'الثالثة']),
      date: isoDate(date),
      timeFrom: '08:00',
      timeTo: '12:00',
      workerName: emp.name,
      requesterKind: 'موظف',
      requesterPhone: '',
      employeeId: emp.empCode,
      description: `أعمال ${typeLabel} رقم ${i + 1}`,
      location: pick(['ورشة', 'خط الإنتاج 1', 'خط الإنتاج 2', 'المخزن']),
      equipment: '',
      tools: [],
      workersNames: '',
      checklist: [],
      checklistNote: '',
      risks: [],
      status,
      reviewedBy: status.startsWith('pending') ? '' : 'مشرف السلامة',
      reviewedAt: status.startsWith('pending') ? '' : isoDate(date),
      reviewNote: '',
      rejectedByRole: status === 'rejected' ? 'hse_admin' : undefined,
      closure: status.startsWith('closed') ? { type: 'safe', reason: '', time: date.toISOString(), closedBy: 'مشرف السلامة' } : null,
      areaHeadReviewedBy: '',
      areaHeadReviewedAt: '',
      safetyOfficerName: status === 'approved' || status.startsWith('closed') ? 'مشرف السلامة' : '',
      areaManagerName: '',
      deletedBy: noFlags(),
      createdAt: date.toISOString(),
      submittedAt: date.toISOString(),
    });
  }

  const hazards = [];
  for (let i = 0; i < 90; i++) {
    const date = daysAgo(400);
    const emp = i % 7 === 0 ? employees[6] : pick(employees);
    const status = pick(HAZARD_STATUSES);
    const riskLevel = pick(['L', 'L', 'M', 'H']);
    hazards.push({
      id: `HZ-${date.getFullYear()}-${pad(i + 1, 4)}`,
      reporterName: emp.name,
      empCode: emp.empCode,
      date: isoDate(date),
      department: emp.department,
      area: pick(['ورشة', 'خط الإنتاج 2', 'المخزن', 'السطح']),
      description: `ملاحظة سلامة رقم ${i + 1}`,
      potentialInjury: 'إصابة محتملة',
      proposedSolution: '',
      likelihood: 1 + Math.floor(rand() * 5),
      severity: pick(['A', 'B', 'C', 'D']),
      riskLevel,
      status,
      actionTaken: status === 'closed' ? 'تم الإصلاح' : '',
      photoUrl: '',
      deletedBy: noFlags(),
      permanentlyDeletedBy: noFlags(),
      submittedAt: date.toISOString(),
      assignedToMaintenance: status === 'assigned_to_maintenance' ? 'Mechanical Maintenance' : '',
    });
  }

  const trainings = [];
  for (let i = 0; i < 40; i++) {
    const date = daysAgo(400);
    const attendees = [];
    for (let k = 0; k < 6; k++) {
      const emp = pick(employees);
      if (!attendees.some((a) => a.empCode === emp.empCode)) {
        attendees.push({ empCode: emp.empCode, name: emp.name, department: emp.department, attendedAt: date.toISOString(), verified: true });
      }
    }
    trainings.push({
      id: `TRN-${1700000000000 + i}`,
      title: pick(INITIAL_TRAINING_TOPICS),
      topic: pick(INITIAL_TRAINING_TOPICS),
      trainer: 'مدرب السلامة',
      targetGroup: 'الجميع',
      date: isoDate(date),
      status: 'closed',
      isClosed: true,
      duration: 1,
      attendees,
      createdAt: date.toISOString(),
      closedAt: date.toISOString(),
    });
  }

  const inspectionSections = [];
  const inspectionItems = [];
  const inspectionRecords = [];
  for (let s = 0; s < 3; s++) {
    const sectionId = `INSEC-TEST-${s + 1}`;
    inspectionSections.push({ id: sectionId, category: s < 2 ? 'P1' : 'P2', order: s + 1, name: `قسم فحص ${s + 1}`, createdAt: now.toISOString(), createdBy: 'tests' });
    for (let k = 0; k < 4; k++) {
      const itemId = `INSITM-TEST-${s + 1}-${k + 1}`;
      inspectionItems.push({ id: itemId, sectionId, itemNumber: String(k + 1), name: `صنف ${k + 1}`, department: pick(DEPARTMENTS), location: '', createdAt: now.toISOString(), createdBy: 'tests', updatedAt: null, updatedBy: null });
      for (let m = 1; m <= 3; m++) {
        inspectionRecords.push({ id: `INSREC-TEST-${s}-${k}-${m}`, sectionId, itemId, year: now.getFullYear(), month: m, status: 'مطابق', notes: '', inspectionDate: `${now.getFullYear()}-${pad(m)}-10`, inspector: 'مفتش', createdAt: now.toISOString(), createdBy: 'tests', updatedAt: null, updatedBy: null });
      }
    }
  }

  return {
    exportedAt: now.toISOString(),
    collections: {
      employees,
      hazards,
      trainings,
      'training-topics': INITIAL_TRAINING_TOPICS,
      'training-requests': [],
      penalties: [],
      drills: [],
      notifications: [],
      'audit-log': [],
      subscriptions: [],
      'inspection-sections': inspectionSections,
      'inspection-items': inspectionItems,
      'inspection-records': inspectionRecords,
      'worker-credentials': {},
      storage: { 'app-users': '[]' },
    },
    tables: { permits },
  };
}

module.exports = { buildSeedData, FIXED_EMPLOYEES };
