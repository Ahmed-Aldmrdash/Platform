'use strict';

// Collections used across the app. Must be required after db.init().

const db = require('../db');
const { normalizeEmpCode } = require('../utils/validation');

const storageStore = db.makeStore('storage', {});
const usersStore = db.makeStore('users', []);
const hazardsStore = db.makeStore('hazards', []);
const auditLogStore = db.makeStore('audit-log', []);
const penaltiesStore = db.makeStore('penalties', []);
const employeesStore = db.makeStore('employees', []);
const trainingTopicsStore = db.makeStore('training-topics', []);
const trainingsStore = db.makeStore('trainings', []);
const trainingRequestsStore = db.makeStore('training-requests', []);
const drillsStore = db.makeStore('drills', []);
const notificationsStore = db.makeStore('notifications', []);
const subscriptionsStore = db.makeStore('subscriptions', []);
const inspectionSectionsStore = db.makeStore('inspection-sections', []);
const inspectionItemsStore = db.makeStore('inspection-items', []);
const inspectionRecordsStore = db.makeStore('inspection-records', []);
const workerCredsStore = db.makeStore('worker-credentials', {});
const backupEmailStore = db.makeStore('backup-email-settings', {});
const hazardAlertStore = db.makeStore('hazard-alert-settings', {});
const smtpStore = db.makeStore('smtp-settings', {});
const snapshotStore = db.makeStore('snapshot-state', {});
const permitsRepo = db.permits;

const readStorage = () => storageStore.read();
const writeStorage = (data) => storageStore.write(data);
const readHazards = () => hazardsStore.read();
const writeHazards = (data) => hazardsStore.write(data);
const readAuditLog = () => auditLogStore.read();
const writeAuditLog = (data) => auditLogStore.write(data);
const readPenalties = () => penaltiesStore.read();
const writePenalties = (data) => penaltiesStore.write(data);
const readEmployees = () => employeesStore.read();
const writeEmployees = (data) => employeesStore.write(data);
const readTrainingTopics = () => trainingTopicsStore.read();
const readTrainings = () => trainingsStore.read();
const writeTrainings = (data) => trainingsStore.write(data);
const readTrainingRequests = () => trainingRequestsStore.read();
const writeTrainingRequests = (data) => trainingRequestsStore.write(data);
const readDrills = () => drillsStore.read();
const writeDrills = (data) => drillsStore.write(data);
const readNotifications = () => notificationsStore.read();
const writeNotifications = (data) => notificationsStore.write(data);
const readSubscriptions = () => subscriptionsStore.read();
const writeSubscriptions = (data) => subscriptionsStore.write(data);
const readInspectionSections = () => inspectionSectionsStore.read();
const writeInspectionSections = (data) => inspectionSectionsStore.write(data);
const readInspectionItems = () => inspectionItemsStore.read();
const writeInspectionItems = (data) => inspectionItemsStore.write(data);
const readInspectionRecords = () => inspectionRecordsStore.read();
const writeInspectionRecords = (data) => inspectionRecordsStore.write(data);

const readUsers = () => usersStore.read();
const writeUsers = (users) => usersStore.write(users);

function findUserForSession(users, session) {
  const username = String(session.username || '').toLowerCase();
  return users.findIndex((u) => u.id === session.id || String(u.username || '').toLowerCase() === username);
}

function readWorkerCreds() {
  const c = workerCredsStore.read();
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

// Read-only views for request paths that only look at the data (see RowCollection.snapshot).
const shared = {
  hazards: () => hazardsStore.snapshot(),
  trainings: () => trainingsStore.snapshot(),
  drills: () => drillsStore.snapshot(),
  penalties: () => penaltiesStore.snapshot(),
  employees: () => employeesStore.snapshot(),
  workerCreds: () => workerCredsStore.snapshot(),
};

let employeeIndex = { version: null, byCode: new Map() };

/** Employee record by code (read-only object). */
function findEmployeeByCode(code) {
  const target = normalizeEmpCode(code);
  if (!target) return null;
  const version = employeesStore.version();
  if (employeeIndex.version !== version) {
    const byCode = new Map();
    for (const e of employeesStore.snapshot()) {
      const key = normalizeEmpCode(e.code || e.empCode);
      if (key && !byCode.has(key)) byCode.set(key, e);
    }
    employeeIndex = { version, byCode };
  }
  return employeeIndex.byCode.get(target) || null;
}

/** All permits in insertion order (shared, read-only objects). */
const getPermitsArray = () => permitsRepo.all();

module.exports = {
  storageStore,
  usersStore,
  hazardsStore,
  auditLogStore,
  penaltiesStore,
  employeesStore,
  trainingTopicsStore,
  trainingsStore,
  trainingRequestsStore,
  drillsStore,
  notificationsStore,
  subscriptionsStore,
  inspectionSectionsStore,
  inspectionItemsStore,
  inspectionRecordsStore,
  workerCredsStore,
  backupEmailStore,
  hazardAlertStore,
  smtpStore,
  snapshotStore,
  permitsRepo,
  makeStore: db.makeStore,

  readStorage,
  writeStorage,
  readHazards,
  writeHazards,
  readAuditLog,
  writeAuditLog,
  readPenalties,
  writePenalties,
  readEmployees,
  writeEmployees,
  readTrainingTopics,
  readTrainings,
  writeTrainings,
  readTrainingRequests,
  writeTrainingRequests,
  readDrills,
  writeDrills,
  readNotifications,
  writeNotifications,
  readSubscriptions,
  writeSubscriptions,
  readInspectionSections,
  writeInspectionSections,
  readInspectionItems,
  writeInspectionItems,
  readInspectionRecords,
  writeInspectionRecords,
  readUsers,
  writeUsers,
  getAppUsersSync: readUsers,
  findUserForSession,
  readWorkerCreds,
  shared,
  findEmployeeByCode,
  getPermitsArray,
};
