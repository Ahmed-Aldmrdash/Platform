#!/usr/bin/env node
'use strict';

// Integration test runner.
//
//   npm test                         all suites
//   npm test -- security reports     only suites whose file name matches
//   npm test -- --keep               keep the temp folder for inspection
//
// Each run builds a throwaway in-process Postgres (PGlite) database in a temp
// folder, loads the synthetic fixture plus test accounts, and points SMTP at a
// local sink so no email ever leaves the machine. Every suite gets a freshly
// started server (rate limits live in memory) on top of the same database.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITES_DIR = path.join(__dirname, 'suites');
const TEST_PASSWORD = 'TestOnly!2026';
const WORKER_PASSWORD = 'WorkerTest!2026';
// Must match the server's cost: unknown-username logins compare against a dummy hash of the same cost.
const TEST_BCRYPT_ROUNDS = '10';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const KEEP = process.argv.includes('--keep');

const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const green = (s) => color(32, s);
const red = (s) => color(31, s);
const dim = (s) => color(90, s);
const bold = (s) => color(1, s);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitFor(url, timeoutMs = 120000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        if ((await fetch(url)).ok) return resolve();
      } catch { /* still starting */ }
      if (Date.now() - started > timeoutMs) return reject(new Error(`server did not start within ${timeoutMs / 1000}s: ${url}`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

/** Minimal SMTP server that accepts everything and stores each message as out/mail-N.eml. */
function startSmtpSink(port, outDir) {
  let n = 0;
  const server = net.createServer((sock) => {
    let mode = 'cmd';
    let buf = '';
    let data = '';
    const send = (s) => sock.write(s + '\r\n');
    send('220 hse-test-sink ESMTP ready');
    sock.on('data', (chunk) => {
      buf += chunk.toString('binary');
      for (;;) {
        if (mode === 'data') {
          const end = buf.indexOf('\r\n.\r\n');
          if (end === -1) return;
          data += buf.slice(0, end);
          buf = buf.slice(end + 5);
          n += 1;
          fs.writeFileSync(path.join(outDir, `mail-${n}.eml`), Buffer.from(data, 'binary'));
          data = '';
          mode = 'cmd';
          send('250 2.0.0 queued');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl === -1) return;
        const cmd = buf.slice(0, nl).split(' ')[0].toUpperCase();
        buf = buf.slice(nl + 2);
        if (cmd === 'EHLO' || cmd === 'HELO') { send('250-hse-test-sink'); send('250-AUTH PLAIN LOGIN'); send('250 OK'); }
        else if (cmd === 'AUTH') send('235 2.7.0 Authentication successful');
        else if (cmd === 'DATA') { mode = 'data'; send('354 End data with <CR><LF>.<CR><LF>'); }
        else if (cmd === 'QUIT') { send('221 2.0.0 Bye'); sock.end(); }
        else send('250 2.0.0 OK');
      }
    });
    sock.on('error', () => {});
  });
  server.on('error', (err) => console.error('[smtp-sink]', err.message));
  server.listen(port, '127.0.0.1');
  return server;
}

function encryptLikeServer(text, jwtSecret) {
  const key = crypto.createHash('sha256').update(`${jwtSecret}::secrets::v1`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

async function seedDatabase(url, smtpPort, jwtSecret) {
  const bcrypt = require('bcryptjs');
  const { migrate } = require('../scripts/db-migrate');
  const db = require('../src/db');
  const { buildSeedData } = require('./fixtures/seed-data');

  await migrate(url, { log: () => {} });
  await db.init(url);

  const now = new Date().toISOString();
  const yr = new Date().getFullYear();
  const data = buildSeedData();
  const c = data.collections;
  const hash = bcrypt.hashSync(TEST_PASSWORD, Number(TEST_BCRYPT_ROUNDS));
  const member = { passwordHash: hash, name: 'حساب اختبار', createdAt: now };
  const account = (id, username, role, name, extra = {}) => ({
    id, username, password: hash, role, name, createdAt: now, mustChangePassword: false, department: 'HSE',
    memberCredentials: { 271: member, 5501: member, 6173: member },
    ...extra,
  });
  c.storage = {
    'app-users': JSON.stringify([
      account('qa-hse', 'qa_hse', 'hse_admin', 'مسؤول سلامة (اختبار)'),
      account('qa-super', 'qa_super', 'super_admin', 'سوبر أدمن (اختبار)'),
      account('qa-dept', 'qa_dept', 'dept_admin', 'أدمن قسم (اختبار)', { department: 'Electrical Maintenance' }),
      account('qa-ceo', 'qa_ceo', 'ceo', 'مدير تنفيذي (اختبار)'),
      account('qa-director', 'qa_director', 'hse_director', 'مدير سلامة (اختبار)'),
    ]),
  };
  c['worker-credentials'] = {
    2546: { hash: bcrypt.hashSync(WORKER_PASSWORD, Number(TEST_BCRYPT_ROUNDS)), phone: '01000000000', pwv: 'qa', setAt: now },
  };
  c['smtp-settings'] = {
    host: '127.0.0.1', port: smtpPort, secure: false,
    user: 'qa-sink@test.local', from: 'qa-sink@test.local', fromName: 'منصة السلامة',
    passEnc: encryptLikeServer('test-password', jwtSecret), updatedAt: now, updatedBy: 'tests',
  };
  c.penalties = Array.from({ length: 12 }, (_, i) => {
    const e = c.employees[(i * 7) % c.employees.length];
    return {
      id: `QA-PEN-${i + 1}`,
      empCode: e.empCode,
      empName: e.name,
      department: e.department,
      reason: `مخالفة اختبار رقم ${i + 1} — عدم ارتداء مهمات الوقاية`,
      date: `${yr}-0${(i % 3) + 1}-${String((i % 27) + 1).padStart(2, '0')}`,
      issuedBy: 'قسم السلامة',
      status: 'active',
      createdAt: now,
    };
  });
  c.drills = [{
    id: 'QA-DRILL-1',
    title: 'تجربة إخلاء (اختبار)',
    date: `${yr}-03-15`,
    startTime: '10:00',
    endTime: '10:35',
    location: 'مبنى الإنتاج P2',
    trainer: 'قسم السلامة',
    status: 'closed',
    attendees: c.employees.slice(10, 13).map((e) => ({ empCode: e.empCode, name: e.name, verified: true })),
    createdAt: now,
    report: {
      scenario: 'حريق وهمي في منطقة التغليف',
      purpose: 'قياس زمن الإخلاء وجاهزية فرق الطوارئ',
      narrativeSteps: ['إطلاق الإنذار', 'إخلاء المبنى', 'التجمع في نقطة التجمع', 'حصر العاملين'],
      resultIntro: 'تم الإخلاء بنجاح خلال الزمن المستهدف.',
      resultPoints: ['استجابة سريعة من العاملين.', 'التزام بتعليمات السلامة.'],
      positives: ['سرعة الاستجابة'],
      negatives: [],
      improvements: ['تحديد لافتات نقطة التجمع'],
      thanksNote: 'شكرًا للزملاء على حسن التعاون.',
      responsibleTitle: 'مسئول البيئة والسلامة',
      responsibleName: 'قسم السلامة',
      signatureDate: `${yr}-03-15`,
      formCode: 'SE-03-F1',
    },
  }];

  db.importAll(data);
  if (!(await db.drain(120000))) throw new Error('could not write the test fixture');
  await db.close();
  return { permits: data.tables.permits.length, hazards: c.hazards.length, employees: c.employees.length, trainings: c.trainings.length };
}

function startServer({ port, env, logFile }) {
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', out, out, 'ipc'],
    env: { ...process.env, ...env, PORT: String(port) },
  });
  child.logFd = out;
  return child;
}

/** Asks the server to shut down cleanly (flushing the database) before falling back to a kill. */
function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const done = () => {
      try { fs.closeSync(child.logFd); } catch { /* already closed */ }
      resolve();
    };
    child.once('exit', done);
    try { child.send('shutdown'); } catch { child.kill(); }
    setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 25000).unref();
  });
}

function runSuite(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => {
      const m = /النتيجة:\s*(\d+)\s*نجح[،,]\s*(\d+)\s*فشل/.exec(out);
      resolve({ code, pass: m ? Number(m[1]) : 0, fail: m ? Number(m[2]) : (code === 0 ? 0 : 1), out });
    });
  });
}

(async () => {
  let suites = fs.readdirSync(SUITES_DIR).filter((f) => f.endsWith('.js')).sort();
  if (only.length) suites = suites.filter((f) => only.some((o) => f.includes(o)));
  if (!suites.length) {
    console.error(red('no matching suites'));
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hse-tests-'));
  const dirs = ['data', 'db', 'out', 'uploads'].reduce((acc, d) => ({ ...acc, [d]: path.join(tmp, d) }), {});
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const dbUrl = `pglite:///${dirs.db.replace(/\\/g, '/')}`;

  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const smtpPort = await freePort();
  const sink = startSmtpSink(smtpPort, dirs.out);
  const counts = await seedDatabase(dbUrl, smtpPort, jwtSecret);

  console.log(bold('\nHSE platform tests'));
  console.log(dim(`  temp: ${tmp}`));
  console.log(dim(`  data: ${counts.permits} permits · ${counts.hazards} hazards · ${counts.employees} employees · ${counts.trainings} trainings`));
  console.log(dim(`  SMTP sink on 127.0.0.1:${smtpPort}\n`));

  const serverEnv = {
    DATABASE_URL: dbUrl,
    HSE_DATA_DIR: dirs.data,
    HSE_UPLOADS_DIR: dirs.uploads,
    JWT_SECRET: jwtSecret,
    NODE_ENV: 'test',
    BCRYPT_ROUNDS: TEST_BCRYPT_ROUNDS,
    PUBLIC_BASE_URL: '',
    SMTP_HOST: '',
  };

  const results = [];
  for (const file of suites) {
    const name = file.replace(/\.js$/, '');
    process.stdout.write(`${name.padEnd(22)} `);
    const port = await freePort();
    const logFile = path.join(tmp, `server-${name}.log`);
    const child = startServer({ port, env: serverEnv, logFile });
    const base = `http://127.0.0.1:${port}`;
    try {
      await waitFor(`${base}/healthz`);
    } catch (err) {
      console.log(red(`✖ ${err.message}`));
      results.push({ name, pass: 0, fail: 1, out: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-2000) : '' });
      await stopServer(child);
      continue;
    }
    const r = await runSuite(path.join(SUITES_DIR, file), {
      HSE_TEST_BASE: base,
      HSE_TEST_OUT: dirs.out,
      HSE_TEST_SNAP_DIR: path.join(dirs.data, 'snapshots'),
      HSE_TEST_SMTP_PORT: String(smtpPort),
      HSE_ROOT: ROOT,
    });
    await stopServer(child);
    results.push({ name, ...r });
    console.log(r.fail === 0 && r.code === 0 ? green(`✔ ${r.pass} passed`) : red(`✖ ${r.pass} passed, ${r.fail} failed`));
  }

  const failed = results.filter((r) => r.fail > 0 || r.code !== 0);
  for (const r of failed) {
    console.log(`\n${red('─'.repeat(60))}\n${bold(r.name)}`);
    console.log(r.out.split('\n').filter((l) => l.includes('❌') || l.includes('💥') || l.includes('Error')).slice(0, 15).join('\n') || r.out.slice(-1200));
  }
  const totalPass = results.reduce((s, r) => s + r.pass, 0);
  const totalFail = results.reduce((s, r) => s + r.fail, 0);
  console.log(`\n${bold('Total:')} ${green(`${totalPass} passed`)}${totalFail ? ` · ${red(`${totalFail} failed`)}` : ''} (${results.length} suites)\n`);

  sink.close();
  if (KEEP) console.log(dim(`kept: ${tmp}`));
  else try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold a file */ }
  process.exit(totalFail || failed.length ? 1 : 0);
})().catch((err) => {
  console.error(red(err.stack));
  process.exit(1);
});
