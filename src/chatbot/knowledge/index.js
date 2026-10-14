'use strict';

// Safety instructions and emergency-team data the assistant answers from.

const SAFETY_SOURCE = 'تعليمات السلامة والصحة المهنية والبيئة SE-W01 (إصدار 06/02/2025)';
const TEAMS_SOURCE = 'فرق الطوارئ — إدارة السلامة والصحة المهنية';

const safetySections = [
  ...require('./safety-1'),
  ...require('./safety-2'),
  ...require('./safety-3'),
  ...require('./safety-4'),
  ...require('./safety-5'),
].sort((a, b) => a.no - b.no);

const emergencyTeams = require('./emergency-teams');

module.exports = { SAFETY_SOURCE, TEAMS_SOURCE, safetySections, emergencyTeams };
