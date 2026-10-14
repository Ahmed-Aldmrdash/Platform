#!/usr/bin/env node
'use strict';

// Loads the emergency team members (names and phone numbers) into DATABASE_URL.
// They are personal data, so they are kept out of the repository.
//
//   npm run db:import-teams -- path/to/emergency-team-members.json
//
// File format: { "<team no>": [["name", "department", "title", "phone"], ...], ... }

require('dotenv').config();
const fs = require('fs');
const db = require('../src/db');
const teams = require('../src/chatbot/knowledge/emergency-teams');

function validate(byTeam) {
  if (!byTeam || typeof byTeam !== 'object' || Array.isArray(byTeam)) throw new Error('expected an object keyed by team number');
  const known = new Set(teams.map((t) => String(t.no)));
  const clean = {};
  for (const [no, members] of Object.entries(byTeam)) {
    if (!known.has(String(no))) throw new Error(`unknown team number: ${no}`);
    if (!Array.isArray(members)) throw new Error(`team ${no}: members must be a list`);
    clean[no] = members.map((m, i) => {
      if (!Array.isArray(m) || m.length !== 4 || m.some((v) => typeof v !== 'string')) {
        throw new Error(`team ${no}, member ${i + 1}: expected [name, department, title, phone]`);
      }
      return m.map((v) => v.trim());
    });
  }
  return clean;
}

async function importTeams(file) {
  const members = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  await db.init();
  db.makeStore('emergency-team-members', {}).write(members);
  const flushed = await db.drain(60 * 1000);
  await db.close();
  if (!flushed) throw new Error('timed out while writing to the database');
  return Object.values(members).reduce((n, list) => n + list.length, 0);
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run db:import-teams -- <emergency-team-members.json>');
    process.exit(1);
  }
  importTeams(file).then(
    (count) => console.log(`imported ${count} emergency team members`),
    (err) => {
      console.error('import failed:', err.message);
      process.exit(1);
    },
  );
}

module.exports = { importTeams };
