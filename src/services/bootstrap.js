'use strict';

// One-off data fixes and seeding that run at every start. Each step is
// idempotent: it only writes when something is actually missing or outdated.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { INITIAL_TRAINING_TOPICS, MAINTENANCE_DEPARTMENTS } = require('../constants');
const stores = require('../data/stores');
const { normalizeEmpCode } = require('../utils/validation');
const { loadEmployeesFromXlsxIfNeeded } = require('./employee-import');

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function randomPassword(length = 14) {
  return Array.from(crypto.randomBytes(length)).map((b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function updateUsers(mutate) {
  const users = stores.readUsers();
  if (mutate(users)) stores.writeUsers(users);
}

function seedTrainingTopics() {
  if (!stores.trainingTopicsStore.exists()) stores.trainingTopicsStore.write(INITIAL_TRAINING_TOPICS);
}

function migrateLegacyRoles() {
  const legacy = { superadmin: 'super_admin', area_head: 'dept_admin', admin: 'hse_admin', supervisor: 'hse_admin' };
  updateUsers((users) => {
    let changed = false;
    for (const u of users) {
      if (legacy[u.role]) {
        u.role = legacy[u.role];
        changed = true;
      }
    }
    return changed;
  });
}

async function ensureSuperAdmin() {
  const users = stores.readUsers();
  if (users.some((u) => u.role === 'super_admin')) return;
  const password = randomPassword();
  users.unshift({
    id: 'superadmin-default',
    username: 'superadmin',
    password: await bcrypt.hash(password, config.bcryptRounds),
    role: 'super_admin',
    name: 'المدير العام',
    createdAt: new Date().toISOString(),
    mustChangePassword: true,
  });
  stores.writeUsers(users);
  console.log(`[setup] created super admin "superadmin" with temporary password: ${password}`);
}

// Accounts created automatically get a random password; the super admin
// sets a real one from the Users screen before handing the account over.
async function seedDepartmentAdmins() {
  const employees = stores.readEmployees();
  if (!employees.length) return;
  const departments = new Set(employees.map((e) => String(e.department || '').trim()).filter(Boolean));
  const users = stores.readUsers();
  let changed = false;

  for (const u of users) {
    if ((u.department === 'HSE' || u.username === 'hse_admin') && u.role === 'dept_admin') {
      u.role = 'hse_admin';
      u.department = '';
      u.name = 'مشرف سلامة (HSE Admin)';
      changed = true;
    }
  }

  const addAccount = async (username, role, name, department, idPrefix) => {
    if (users.some((u) => u.username === username)) return;
    users.push({
      id: randomId(idPrefix),
      username,
      password: await bcrypt.hash(randomPassword(), config.bcryptRounds),
      role,
      name,
      department,
      createdAt: new Date().toISOString(),
      mustChangePassword: true,
    });
    changed = true;
  };

  for (const dept of MAINTENANCE_DEPARTMENTS) {
    if (!users.some((u) => u.role === 'maint_admin' && u.department === dept)) {
      await addAccount(`${dept.split(' ')[0].toLowerCase()}_maintenance_admin`, 'maint_admin', `مشرف الصيانة - ${dept}`, dept, 'auto-maint');
    }
  }
  for (const dept of departments) {
    if (!users.some((u) => u.role === 'dept_admin' && u.department === dept)) {
      await addAccount(`${dept.toLowerCase().replace(/\s+/g, '_')}_admin`, 'dept_admin', `مشرف قسم ${dept}`, dept, 'auto-dept');
    }
  }
  if (changed) stores.writeUsers(users);
}

function findDirectorEmployee(employees) {
  return employees.find((e) => /hse\s*director/i.test(String(e.jobTitle || '')) && String(e.department || '').trim().toUpperCase() === 'HSE');
}

async function ensureHseDirectorAccount() {
  const users = stores.readUsers();
  const stale = users.findIndex((u) => u.username === 'hse_director' && u.role !== 'hse_director');
  if (stale !== -1) users.splice(stale, 1);
  if (users.some((u) => u.username === 'hse_director' || u.role === 'hse_director')) {
    if (stale !== -1) stores.writeUsers(users);
    return;
  }
  const director = findDirectorEmployee(stores.readEmployees());
  const password = randomPassword(12);
  users.push({
    id: randomId('auto-viewer'),
    username: 'hse_director',
    password: await bcrypt.hash(password, config.bcryptRounds),
    role: 'hse_director',
    name: director ? `متابعة — ${director.name}` : 'مدير السلامة والصحة المهنية (متابعة)',
    department: '',
    empCode: director ? director.empCode : '',
    createdAt: new Date().toISOString(),
    mustChangePassword: true,
  });
  stores.writeUsers(users);
  console.log(`[setup] created read-only account "hse_director" with temporary password: ${password}`);
}

/** Oversight accounts are locked to the one employee code that owns them. */
function lockViewerAccounts() {
  const employees = stores.readEmployees();
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  updateUsers((users) => {
    let changed = false;
    for (const u of users) {
      if (!['ceo', 'hse_director'].includes(u.role) || u.empCode) continue;
      let emp = u.role === 'hse_director'
        ? findDirectorEmployee(employees)
        : employees.find((e) => /managing director|chief executive|\bceo\b|general manager/i.test(String(e.jobTitle || '')));
      if (!emp && u.name) {
        const clean = norm(u.name).replace(/^متابعة\s*—\s*/, '');
        emp = employees.find((e) => norm(e.name) === clean);
      }
      if (emp) {
        u.empCode = normalizeEmpCode(emp.empCode || emp.code);
        changed = true;
      }
    }
    return changed;
  });
}

async function hashPlaintextPasswords() {
  const users = stores.readUsers();
  let changed = false;
  for (const u of users) {
    if (u.password && !u.password.startsWith('$2')) {
      u.password = await bcrypt.hash(u.password, config.bcryptRounds);
      changed = true;
    }
  }
  if (changed) stores.writeUsers(users);
}

// Accounts from older releases may still use the old well-known defaults.
async function flagKnownDefaultPasswords() {
  const users = stores.readUsers();
  let changed = false;
  for (const u of users) {
    if (u.mustChangePassword === true || !u.password || !u.password.startsWith('$2')) continue;
    const isAuto = u.id === 'superadmin-default' || (typeof u.id === 'string' && (u.id.startsWith('auto-dept-') || u.id.startsWith('auto-maint-')));
    if (!isAuto) continue;
    const knownDefault = u.id === 'superadmin-default' ? 'admin123' : '123456';
    if (await bcrypt.compare(knownDefault, u.password)) {
      u.mustChangePassword = true;
      changed = true;
    }
  }
  if (changed) stores.writeUsers(users);
}

/** Fills seen / in-progress / resolved timestamps that older hazard records never got. */
function backfillHazardTimestamps(hazard) {
  const baseTime = hazard.submittedAt || hazard.createdAt || new Date().toISOString();
  const updater = hazard.updatedBy || 'المدير العام';
  const markSeen = () => {
    if (!hazard.seenAt) {
      hazard.seenAt = baseTime;
      hazard.seenBy = hazard.seenBy || updater;
    }
  };
  const markInProgress = () => {
    if (!hazard.inProgressAt) {
      hazard.inProgressAt = hazard.seenAt || baseTime;
      hazard.inProgressBy = hazard.inProgressBy || updater;
    }
  };
  if (hazard.status !== 'open' || hazard.actionTaken) markSeen();
  if (['in_progress', 'resolved', 'closed'].includes(hazard.status)) {
    markSeen();
    markInProgress();
  }
  if (['resolved', 'closed'].includes(hazard.status)) {
    markSeen();
    markInProgress();
    if (!hazard.resolvedAt) {
      hazard.resolvedAt = hazard.inProgressAt || baseTime;
      hazard.resolvedBy = hazard.resolvedBy || updater;
    }
  }
  return hazard;
}

function backfillHazards() {
  const hazards = stores.readHazards();
  if (!hazards.length) return;
  const before = JSON.stringify(hazards);
  const updated = hazards.map(backfillHazardTimestamps);
  if (JSON.stringify(updated) !== before) stores.writeHazards(updated);
}

async function runStartupTasks() {
  seedTrainingTopics();
  migrateLegacyRoles();
  await ensureSuperAdmin();
  await seedDepartmentAdmins();
  await ensureHseDirectorAccount();
  lockViewerAccounts();
  await hashPlaintextPasswords();
  await flagKnownDefaultPasswords();
  backfillHazards();
  await loadEmployeesFromXlsxIfNeeded();
}

module.exports = { runStartupTasks, backfillHazardTimestamps, randomPassword };
