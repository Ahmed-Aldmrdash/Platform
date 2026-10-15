'use strict';

// Permit list order: still-open permits first (awaiting approval, then approved and running),
// finished ones last; inside each group the riskiest work comes first, then the newest.

// Pending approvals first, then approved, then finished (closed / rejected).
function approvalRank(status) {
  const s = String(status || 'pending').toLowerCase().trim();
  if (s.startsWith('rejected')) return 3;
  if (s.startsWith('closed') || s === 'completed') return 2;
  if (s === 'approved') return 1;
  return 0;
}

// Without a filled-in risk assessment the type of work decides.
const TYPE_RISK = { hot: 'H', confined: 'H', height: 'H', lifting: 'H', excavation: 'H', lockout: 'M', loto: 'M', general: 'L' };
const RISK_RANK = { H: 0, M: 1, L: 2 };
const RISK_LABEL = { H: 'عالية', M: 'متوسطة', L: 'منخفضة' };

/** H, M or L: the highest likelihood × severity score (same bands as the permit form), else the work type. */
function permitRiskLevel(permit) {
  const risks = permit && Array.isArray(permit.risks) ? permit.risks : [];
  const top = risks.reduce((max, r) => Math.max(max, Number(r && r.score) || 0), 0);
  if (top > 12) return 'H';
  if (top > 4) return 'M';
  if (top > 0) return 'L';
  return TYPE_RISK[permit && permit.typeKey] || 'L';
}

/** Sorts a copy of the permits into list order; `permits` must be oldest first. */
function sortPermitsForList(permits) {
  return permits
    .map((p, i) => ({ p, i, status: approvalRank(p.status), risk: RISK_RANK[permitRiskLevel(p)] }))
    .sort((a, b) => a.status - b.status || a.risk - b.risk || b.i - a.i)
    .map((x) => x.p);
}

module.exports = { approvalRank, permitRiskLevel, sortPermitsForList, RISK_RANK, RISK_LABEL };
