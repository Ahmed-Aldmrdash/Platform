// Soft delete, restore and permanent delete for training sessions.

async function softDeleteTraining(id) {
  if (!confirm(T('هل أنت متأكد من نقل المحاضرة إلى سلة المحذوفات؟'))) return;
  try {
    const res = await authFetch('/api/trainings/' + id, { method: 'DELETE' });
    if (res.ok) {
      showToast(T('تم النقل إلى سلة المحذوفات'), 'success');
      loadAdminTraining(true);
    } else {
      const data = await res.json();
      showToast(data.error || T('فشل الحذف'), 'error');
    }
  } catch (e) {
    showToast(T('خطأ اتصال'), 'error');
  }
}

async function restoreTraining(id) {
  if (!confirm(T('هل أنت متأكد من استعادة المحاضرة؟ سيعود رصيد الساعات للموظفين.'))) return;
  try {
    const res = await authFetch('/api/trainings/' + id + '/restore', { method: 'PUT' });
    if (res.ok) {
      showToast(T('تمت استعادة المحاضرة'), 'success');
      loadAdminTraining(true);
    } else {
      const data = await res.json();
      showToast(data.error || T('فشل الاستعادة'), 'error');
    }
  } catch (e) {
    showToast(T('خطأ اتصال'), 'error');
  }
}

async function permanentDeleteTraining(id) {
  try {  if (!confirm(T('تنبيه هام ⚠️: هل أنت متأكد من حذف المحاضرة نهائياً؟ لا يمكن التراجع عن هذا الإجراء!'))) return;

    const res = await authFetch('/api/trainings/' + id + '/permanent', { method: 'DELETE' });
    if (res.ok) {
      showToast(T('تم الحذف نهائياً'), 'success');
      loadAdminTraining(true);
    } else {
      const data = await res.json();
      showToast(data.error || T('فشل الحذف النهائي'), 'error');
    }
  } catch (e) {
    showToast(T('خطأ اتصال'), 'error');
  }
}
