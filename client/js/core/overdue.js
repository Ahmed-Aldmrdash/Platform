// The "overdue" filter shared by the permits and hazards screens: still waiting for a first action
// (approval, or a decision on the report) longer than the chosen number of days.

const OVERDUE_FILTER = '⏰ المتأخرة';
const OVERDUE_DAY_OPTIONS = [[1, 'يوم'], [2, 'يومين'], [3, '3 أيام'], [7, 'أسبوع'], [14, 'أسبوعين'], [30, 'شهر']];
const OVERDUE_DAYS_KEY = 'ep_overdueDays';
let overdueDays = 2;
try {
  const saved = Number(localStorage.getItem(OVERDUE_DAYS_KEY));
  if (OVERDUE_DAY_OPTIONS.some(([d]) => d === saved)) overdueDays = saved;
} catch (e) { }

function hoursSince(iso) {
  const t = new Date(iso || 0).getTime();
  return t ? Math.max(0, (Date.now() - t) / 36e5) : 0;
}

function ageText(hours) {
  return hours >= 48 ? T(`${Math.floor(hours / 24)} يوم`) : T(`${Math.max(1, Math.round(hours))} ساعة`);
}

function overdueDaysSelectHtml(page) {
  return `<label class="overdue-days">${T('أكتر من')}
    <select onchange="setOverdueDays(this.value, ${jsArg(page)})">
      ${OVERDUE_DAY_OPTIONS.map(([d, label]) => `<option value="${d}"${d === overdueDays ? ' selected' : ''}>${T(label)}</option>`).join('')}
    </select></label>`;
}

function setOverdueDays(value, page) {
  overdueDays = Number(value) || 2;
  try { localStorage.setItem(OVERDUE_DAYS_KEY, String(overdueDays)); } catch (e) { }
  if (page === 'permits') {
    refreshPmOverdueCount();
    loadPermitsPage();
  } else {
    renderSupHazard(true, false);
  }
}

/** Forward-by-email history shown on a card. */
function forwardsHtml(forwards) {
  return (Array.isArray(forwards) ? forwards : []).map(f =>
    `<div class="card-note">📧 ${T('اتوجّه لـ')} ${escapeHtml((f.to || []).join(', '))} — ${escapeHtml(f.by || '')} · ${escapeHtml(new Date(f.at).toLocaleString(LOC(), { dateStyle: 'short', timeStyle: 'short' }))}${f.note ? ` · ${escapeHtml(f.note)}` : ''}</div>`
  ).join('');
}

function canForwardByEmail() {
  return ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin'].includes(currentUserRole) && document.body.dataset.readonly !== '1';
}
