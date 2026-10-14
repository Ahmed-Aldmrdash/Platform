'use strict';

const LOCK_MS = 15 * 60 * 1000;

/** Counts failed logins per key and locks the key for 15 minutes once `max` is reached. */
class FailureTracker {
  constructor(max, lockMs = LOCK_MS) {
    this.max = max;
    this.lockMs = lockMs;
    this.entries = new Map();
    setInterval(() => this.sweep(), 10 * 60 * 1000).unref();
  }

  minutesLeft(key) {
    const st = this.entries.get(key);
    return st && st.lockedUntil > Date.now() ? Math.ceil((st.lockedUntil - Date.now()) / 60000) : 0;
  }

  /** Records a failure and returns how many attempts remain before the lock. */
  record(key) {
    const now = Date.now();
    let st = this.entries.get(key);
    if (!st || (st.lockedUntil && st.lockedUntil <= now) || (!st.lockedUntil && now - st.firstAt > this.lockMs)) {
      st = { count: 0, lockedUntil: 0, firstAt: now };
    }
    st.count += 1;
    if (st.count >= this.max) st.lockedUntil = now + this.lockMs;
    this.entries.set(key, st);
    return Math.max(0, this.max - st.count);
  }

  clear(key) {
    this.entries.delete(key);
  }

  clearWhere(predicate) {
    for (const key of this.entries.keys()) if (predicate(key)) this.entries.delete(key);
  }

  sweep() {
    const now = Date.now();
    for (const [key, st] of this.entries) {
      const expired = st.lockedUntil ? st.lockedUntil <= now : now - st.firstAt > this.lockMs;
      if (expired) this.entries.delete(key);
    }
  }
}

// Admin accounts are shared by a department, so lock the person (account + employee
// code) quickly, and the whole account only when many different codes are being tried.
const adminPerPerson = new FailureTracker(5);
const adminPerAccount = new FailureTracker(20);
const workerPerCode = new FailureTracker(5);
const workerPerIp = new FailureTracker(100);

function clearAdminFailures(username, empCode) {
  const user = String(username || '').toLowerCase();
  if (empCode) adminPerPerson.clear(`${user}::${empCode}`);
  else adminPerPerson.clearWhere((k) => k.startsWith(`${user}::`));
  adminPerAccount.clear(user);
}

function clearAdminFailuresForCode(empCode) {
  adminPerPerson.clearWhere((k) => k.endsWith(`::${empCode}`));
}

module.exports = {
  FailureTracker,
  adminPerPerson,
  adminPerAccount,
  workerPerCode,
  workerPerIp,
  clearAdminFailures,
  clearAdminFailuresForCode,
};
