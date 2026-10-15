// Soft delete, restore and permanent delete for training sessions.

async function softDeleteTraining(id) {
  if (!(await appConfirm(T('هل أنت متأكد من نقل المحاضرة إلى سلة المحذوفات؟'), { tone: 'danger', title: T('تأكيد الحذف'), confirmLabel: T('حذف') }))) return;
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
  if (!(await appConfirm(T('هل أنت متأكد من استعادة المحاضرة؟ سيعود رصيد الساعات للموظفين.'), { tone: 'primary', confirmLabel: T('استعادة') }))) return;
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
  try {  if (!(await appConfirm(T('تنبيه هام ⚠️: هل أنت متأكد من حذف المحاضرة نهائياً؟ لا يمكن التراجع عن هذا الإجراء!'), { tone: 'danger', title: T('تأكيد الحذف'), confirmLabel: T('حذف نهائي') }))) return;

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
