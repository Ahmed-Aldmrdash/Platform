// Styled confirmation and text-entry dialogs in place of the browser's confirm() and prompt().
// Both return a Promise: appConfirm -> true/false, appPrompt -> the entered text or null.
// tone: 'danger' (filled red confirm, focus starts on Cancel), 'warning' or 'primary'.

const _DIALOG_CONFIRM_CLASS = { danger: 'btn-danger-solid', warning: 'btn-warning', primary: 'btn-primary' };

function _openAppDialog({ title, message, tone = 'primary', confirmLabel, cancelLabel, input }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay app-dialog-overlay';

    const card = document.createElement('div');
    card.className = 'app-modal-card app-dialog';
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'appDialogTitle');
    card.setAttribute('aria-describedby', 'appDialogMessage');

    const heading = document.createElement('h3');
    heading.id = 'appDialogTitle';
    heading.textContent = title || (tone === 'danger' ? T('تأكيد الحذف') : T('تأكيد'));

    const body = document.createElement('p');
    body.id = 'appDialogMessage';
    body.className = 'app-dialog-message';
    body.textContent = message || '';

    let field = null;
    if (input) {
      field = document.createElement('input');
      field.type = 'text';
      field.className = 'app-dialog-input';
      field.value = input.value || '';
      if (input.placeholder) field.placeholder = input.placeholder;
      field.setAttribute('aria-labelledby', 'appDialogMessage');
    }

    const row = document.createElement('div');
    row.className = 'btn-row';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = `btn ${_DIALOG_CONFIRM_CLASS[tone] || 'btn-primary'}`;
    ok.textContent = confirmLabel || T('تأكيد');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = cancelLabel || T('إلغاء');
    row.append(ok, cancel);

    card.append(heading, body);
    if (field) card.append(field);
    card.append(row);
    overlay.append(card);
    document.body.append(overlay);

    const close = (result) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(result);
    };
    const accept = () => close(field ? field.value : true);
    const dismiss = () => close(field ? null : false);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
      if (e.key === 'Enter' && field && document.activeElement === field) { e.preventDefault(); accept(); return; }
      if (e.key === 'Tab') {
        const items = [field, ok, cancel].filter(Boolean);
        const i = items.indexOf(document.activeElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
        e.preventDefault();
        items[next].focus();
      }
    };
    ok.addEventListener('click', accept);
    cancel.addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey, true);

    (field || (tone === 'danger' ? cancel : ok)).focus();
  });
}

function appConfirm(message, options = {}) {
  return _openAppDialog({ ...options, message });
}

function appPrompt(message, options = {}) {
  return _openAppDialog({ ...options, message, input: { value: options.value, placeholder: options.placeholder } });
}
