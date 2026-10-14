// Start-up hook and the background hazard polling behind the badge count and list refresh.

document.addEventListener('DOMContentLoaded', () => {
  try {
    if (typeof initTabs === 'function') initTabs();
    if (typeof initHazardModule === 'function') initHazardModule();
    initEmployeeSession();
    startHazardPolling();
  } catch (e) {
    console.error("Initialization error:", e);
  }
});

function _applyHazardBadge(openCount) {
  const badgeEl = document.getElementById('hzSupBadge');
  if (!badgeEl) return;
  if (openCount > 0) {
    badgeEl.textContent = openCount;
    badgeEl.style.display = 'inline-block';
  } else {
    badgeEl.style.display = 'none';
  }
}

function _isSupHazardViewVisible() {
  const viewSup = document.getElementById('viewSupHazard');
  return !!viewSup && viewSup.style.display !== 'none';
}

// The badge only needs the open count; the full list is downloaded only while the hazards view is open.
function startHazardPolling() {
  poll('hazards', async () => {
    const isEditing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (sessionRole === 'supervisor' && getToken()) {
      await updateHazardBadgeCount();
      if (!_isSupHazardViewVisible()) return;
      try {
        const r = await fetchJsonIfChanged('/api/hazards');
        if (r.ok) {
          const list = (r.data && r.data.hazards) || [];
          if (list !== window._hazardsRawCache) window._hzPendingList = list;
        }
      } catch (e) {}
      // A changed list is held back while the user is typing and applied on a later tick.
      if (window._hzPendingList && !isEditing) {
        window._hazardsRawCache = window._hzPendingList;
        window._hzPendingList = null;
        renderSupHazard(true, false);
      }
    } else if (!isEditing) {
      await silentRefreshHazards();
    }
  }, 5000);
}

async function updateHazardBadgeCount() {
  if (!getToken() || sessionRole !== 'supervisor') return;
  try {
    const r = await fetchJsonIfChanged('/api/hazards/summary');
    if (r.ok && r.changed) _applyHazardBadge(Number(r.data && r.data.open) || 0);
  } catch(e) {}
}

async function silentRefreshHazards() {
  const viewMy = document.getElementById('viewMyHazards');
  if (viewMy && viewMy.style.display !== 'none' && currentEmployee) {
    await renderMyHazards(true);
  }
}
