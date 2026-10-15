# Button system — inventory, decisions and result

Status: **approved and applied.** The four decisions in section 4 were approved; every page now uses
the classes in section 2 (sections 1 and 3 keep the "before" inventory for reference).

## Result

| Measure | Before | After |
| --- | --- | --- |
| Buttons on `.btn` + a type | 0 of 236 | 226 of 236 |
| Separate button class families | 22 | 1 (`.btn`) plus component controls |
| Buttons with inline `style` | 100 | 7 (initial `display: none` set by role checks, the login entrance-animation index, one text color token) |
| Browser `confirm()` boxes | 19 | 0 (styled `appConfirm` / `appPrompt`, client/js/core/dialogs.js) |

The 10 controls outside `.btn` are components with their own look: notification filter pills, the
chat launcher / send / mic, the password eye inside the login field and the modal close (✕) circle.
Filter chips (`.chip`, `.dash-quick-btn`) are not buttons and keep their component style.

## 1. Inventory (before)

| Measure | Count |
| --- | --- |
| `<button>` elements (index.html + JS templates) | **236** |
| Distinct class combinations | **55** |
| Buttons with inline `style="…"` | **100** |
| Separate "button" class families | 22 (`submit-btn`, `act-btn`, `um-btn`, `export-btn`, `emp-dir-btn`, `dash-refresh-btn`, `dash-apply-btn`, `btn-amber/emerald/red/cyan`, `logout-btn`, `again-btn`, `wl-*-btn`, `adv-filter-clear-btn`, `add-risk-btn`, `settings-save`, `btn btn-*`, `lightbox-btn`, `cb-*`, `snap-dl`, `hza-del`, `qm-q-del`, `insp-section-del`) |

Most-used classes: `submit-btn` 34 · `logout-btn` 17 · `um-btn` 17 · no class (inline only) 17 ·
`btn btn-secondary` 16 · `export-btn` 11 · `btn btn-primary` 11.

### What is inconsistent

- **The same action looks different on every page.** "Export Excel" alone has six looks:
  `export-btn` (permits, hazards), `emp-dir-btn secondary` (employees), `dash-refresh-btn`
  (dashboard), `submit-btn` + inline gray (trainings, penalties), `um-btn` (training card) and an
  inline green button (drills).
- **Class names don't match meaning.** "Cancel" in every modal uses `logout-btn`;
  "🚫 رفض البلاغ نهائياً" uses `act-btn approve` (the approve class); "Delete penalty" uses
  `logout-btn`; "Accept training request" uses `submit-btn` while "Decline" uses `logout-btn`.
- **Red is used for opposite things.** Brand-red fills mark "save", "send", "route to
  maintenance", "start repair" *and* "reject"; the hazard card shows three identical red buttons
  (توجيه للصيانة · بدء الإصلاح · رفض البلاغ).
- **Bulk deletes sit next to everyday actions.** "🗑️ مسح كل التصاريح/البلاغات/الموظفين/التدريبات/
  التجارب/الجزاءات" are in the same toolbar as Export.
- **Two one-click decisions have no confirmation:** quick "🚫 رفض البلاغ" on the hazard card
  (`updateHazardStatus(…,'rejected')`) and the worker's "إغلاق جبري" (`workerClosePermit(…,'forced')`).
  All other deletes already ask (`confirm()` or a modal).
- **Heights run from 24 px to 46 px**: measured on 1,047 visible buttons across 10 admin pages,
  1,035 are below the 44 px touch target. 4 of the 14 icon-only buttons (zoom ➖/➕ and two ✕
  closes) have no tooltip or accessible name.
- **Classes used by JS as hooks** (kept as-is, new classes are added next to them):
  `.dash-quick-btn`, `.notif-pill`, `.wl-admin-btn`.

## 2. The system

One base class plus one type class, and an optional size:

```html
<button class="btn btn-primary">💾 حفظ</button>
<button class="btn btn-danger btn-sm" title="حذف">🗑 حذف</button>
<button class="btn btn-ghost btn-icon" title="إغلاق" aria-label="إغلاق">✕</button>
```

| Class | Look | Used for |
| --- | --- | --- |
| `.btn-primary` | Brand red `--brand-600` fill, white text; hover `--brand-fill-hover` | The **one** main "go" action of a form, modal or section |
| `.btn-secondary` | White, 1 px `--input-border` outline, charcoal text | Everything supporting: cancel, back, edit, open, clear filters, show more |
| `.btn-success` | Green `--success-solid` fill, white text | Approve, accept, confirm done/closed |
| `.btn-danger` | **Outline**: white, 1 px `--danger-solid` border, danger text, always a 🗑 / ✕ / 🚫 icon, always confirmed | Delete, reject, revoke, forced close |
| `.btn-danger-solid` | Danger fill, white text | **Only** the final button inside a confirmation dialog |
| `.btn-warning` | Amber `--warning-solid` fill, charcoal text | Careful but not destructive: end a session, reopen, reset passwords, send back to review |
| `.btn-info` | Blue `--info-solid` fill, white text | View / preview / print / move a record "in progress" |
| `.btn-export` | `--surface-2` fill, 1 px border, icon first (⬇ ⬆ ✉) | Export, import, download, send by e-mail — one look everywhere |
| `.btn-ghost` | No fill or border; tint on hover. With `.btn-icon` it is square and icon-only, with a required `title` + `aria-label` | Toolbar icons (theme, language, refresh, close, zoom, remove row), text links ("نسيت كلمة السر؟") |

Sizes: `.btn-sm` 32 px · default (md) 40 px · `.btn-lg` 48 px (login, main form submit, phones).
On touch screens (`pointer: coarse`) every button gets a 44 × 44 px hit area (small buttons grow
their hit area with an invisible `::after`, so dense rows keep their look).

States: hover (darker fill / tinted outline) · active (1 px press) · focus-visible
(`--focus-ring`) · disabled (`opacity .5`, `cursor: not-allowed`, no hover) · loading
(`.is-loading`: spinner, `aria-busy="true"`, clicks ignored — the button keeps its width).

Placement: in RTL the primary action is at the inline-start of its group; Cancel/secondary next to
it; danger actions at the inline-end, separated by space. Bulk "delete all" buttons move to a
"منطقة الخطر" block at the bottom of the page (same handler, same IDs).

### Contrast (WCAG AA)

| Pair | Ratio |
| --- | --- |
| White on primary `#D51E27` / hover `#B82328` | 5.19 / 6.35 |
| White on success `#15803D` | 5.02 |
| White on info `#175CD3` | 5.99 |
| White on danger `#B42318` (dialog only) | 6.57 |
| Charcoal on warning `#F59E0B` | 7.67 |
| Danger outline text on white | 6.57 |
| Export text on `--surface-2` | 8.11 |
| Outline border `#8B909A` on white (non-text, ≥ 3:1) | 3.20 |
| Dark theme: brand text / danger text / body text on surface | 5.83 / 6.37 / 15.15 |

## 3. Every action → button type

Counts are the number of buttons for that action across the app. "Confirm" = a confirmation
already exists (✓) or is proposed (**+**).

### Primary — the main "go" of its section

| Action (Arabic label) | Where | # | Why |
| --- | --- | --- | --- |
| تسجيل الدخول / دخول | worker login, admin login | 3 | Only action on the screen |
| حفظ ودخول · حفظ كلمة السر والمتابعة · تغيير كلمة المرور والمتابعة · ابعتلي كلمة سر مؤقتة | first-login / reset screens | 4 | Completes the step |
| إرسال الطلب للمشرف | permit form | 1 | Main purpose of the form |
| إرسال البلاغ | hazard report form | 1 | Main purpose of the form |
| إرسال الطلب (طلب محاضرة) | training request | 1 | Main purpose of the form |
| تسليم الإجابات · تسجيل حضوري | quiz, training/drill attendance | 3 | Worker's call to action |
| إضافة المستخدم · إضافة موظف · إضافة جزاء · إضافة قسم · إضافة صنف · تسجيل فحص | admin lists | 6 | Section's main create action |
| إنشاء المحاضرة وبدء التسجيل · إنشاء التجربة وبدء التسجيل | trainings, drills | 2 | Section's main create action |
| حفظ / حفظ التعديلات / حفظ الجزاء / حفظ نتيجة الفحص / إضافة (modal) | edit & add modals | 9 | Final step of the modal |
| حفظ (الإعدادات): SMTP · النسخ الاحتياطي · تنبيهات الخطورة · جدول التقارير | settings cards | 4 | One save per card |
| حفظ التسجيل · حفظ الاختبار · حفظ المهلة · حفظ الريبورت · حفظ كلمة السر | training media, drill report, employee password | 5 | One save per section |
| إرسال (نافذة الإيميل) · توجيه الآن | e-mail modal, hazard routing modal | 2 | Final step of the modal |
| تطبيق الفلتر · عرض التقرير | dashboard, reports | 2 | Runs the query the page is about |
| خد نسخة دلوقتي | backups | 1 | Main action of the backup card |
| + طلب جديد | after a permit is sent | 1 | Natural next step |
| توجيه للصيانة | hazard card (HSE) | 2 | The workflow's next step; today red like "reject" |
| الاختبار (فتح الاختبار) | worker training history | 1 | Worker's call to action |

### Success — approve / done

| Action | Where | # | Why |
| --- | --- | --- | --- |
| ✓ موافقة أدمن القسم · ✓ اعتماد السلامة والصحة المهنية | permit review | 2 | Positive decision |
| ✅ اعتماد الصورة | hazard photo | 1 | Positive confirmation |
| ✅ تم الحل والإغلاق · ✅ تأكيد الإصلاح والإغلاق · تأكيد الإصلاح والإغلاق (modal) | hazard card / resolve modal | 3 | Marks done |
| ✅ قبول (طلب محاضرة) | training requests | 1 | Positive decision |
| اكتمل بأمان | worker closes own permit | 1 | Positive outcome |
| ✓ تحقق (حضور) | training/drill attendee | 2 | Positive state toggle (un-verify = Secondary) |

### Danger — outline + icon + confirmation (filled only inside the dialog)

| Action | Where | # | Confirm | Why |
| --- | --- | --- | --- | --- |
| 🗑 حذف (مستخدم · موظف · طلب · بلاغ · محاضرة · تجربة · جزاء · قسم · صنف · فحص) | lists | 14 | ✓ | Deletes data |
| ❌ حذف نهائي | trash (permits, hazards, trainings) | 3 | ✓ | Irreversible |
| 🗑️ مسح كل التصاريح / البلاغات / الموظفين / التدريبات / التجارب / الجزاءات | page toolbars → "منطقة الخطر" | 6 | ✓ | Bulk, irreversible |
| ✗ رفض (تصريح) | permit review | 2 | ✓ (opens the note first) | Negative decision, needs a reason |
| 🚫 رفض البلاغ | hazard card quick reject | 1 | **+** | Negative decision; today one click |
| 🚫 رفض البلاغ نهائياً | hazard card (HSE) | 1 | ✓ (modal) | Today styled as "approve" |
| ❌ رفض (طلب محاضرة) | training requests | 1 | **+** | Negative decision |
| إغلاق جبري | worker closes own permit | 1 | **+** | Forced, abnormal close |
| Final button: حذف الطلب · حذف الجزاء · تأكيد الرفض (×4) | confirmation modals | 6 | — | `.btn-danger-solid`, the only filled red-danger |

### Warning — careful, not destructive

| Action | Where | # | Why |
| --- | --- | --- | --- |
| 🛑 إنهاء وإغلاق المحاضرة / التجربة | live training / drill | 2 | Stops attendance; already confirmed |
| 🔓 فتح للكل · 🔓 فتح لعامل معيّن | training quiz | 2 | Changes who can answer |
| 🔐 توليد كلمات سر لحسابات الأقسام · 🔄 إعادة تعيين (كلمة سر عضو) | users | 2 | Replaces passwords; already confirmed |
| لم يكتمل | worker closes own permit | 1 | Abnormal outcome |
| ↩️ رجوع لقيد المراجعة | training requests | 1 | Reverses a decision |
| 📢 إعادة التوجيه لقسم آخر | hazard card | 1 | Re-routes an assigned report |

### Info — view / print / in progress

| Action | Where | # | Why |
| --- | --- | --- | --- |
| 🖨️ طباعة | permit card, hazard card, drill report, reports | 4 | Print / preview |
| 🛠️ بدء الإصلاح | hazard card | 2 | Moves the report to "in progress"; today red |
| 🎥 مشاهدة · 👥 الحضور | worker history, drill card | 2 | View |

### Export — one look for export, import, download and send

| Action | Where | # |
| --- | --- | --- |
| ⬇ تصدير Excel / سجل البلاغات / الموظفين / الجزاءات / المحاضرات المفلترة / سجل الأصناف / فحص الشهر | all registers | 12 |
| 📊 تصدير بالرسوم البيانية · 📈 بيانات Power BI · 📄 حفظ PDF · ⬇️ تحميل Word | dashboard, reports, drill report | 4 |
| ⬇ تنزيل نسخة احتياطية كاملة · ⬇ تنزيل القائمة (CSV) · ⬇ (snapshot) | backups, users | 3 |
| 📤 رفع / 📥 استيراد (تصاريح · بلاغات · محاضرات · جزاءات · ملفات الفحص القديمة) | admin toolbars | 6 |
| 📧 إرسال الشيت بالإيميل · 📧 توجيه بالإيميل · ✉️ إرسال (التقرير) · 📤 ابعت النسخة / نسخة دلوقتي · ✉️ ابعت إيميل تجريبي · 📤 ابعت تجربة | permits, hazards, reports, settings | 9 |

Why: these move data in or out of the platform; one recognizable look (icon first) lets people
find them on every page. "✉️ SEND MAIL" becomes "✉️ إرسال".

### Secondary — supporting actions

إلغاء (every modal, 12) · رجوع / → رجوع للأقسام / ⬅ رجوع للوحة التحكم / رجوع لكلمة السر /
رجوع لدخول الموظفين / رجوع / كود تاني (9) · مسح الفلاتر (6) · عرض المزيد (3) · ✏️ تعديل (4) ·
👥 الأعضاء · 📝 الريبورت · 🎥 تسجيل واختبار · ➕ إضافة حضور يدوي · ➕ إضافة مستلم · ➕ إضافة سؤال ·
+ إضافة خطر · 📷 التقاط / إرفاق صورة · 🔄 إعادة التقاط · 🔄 استرجاع / استعادة (3) · ✓ إلغاء التحقق ·
💾 حفظ الكود (inline field on the permit card) · 🎲 توليد · 🔴 تنبيهات الخطورة العالية (settings) ·
✖ إلغاء فلتر القسم · إخفاء · إغلاق · 📁 سجل طلباتي · 🛡️ دخول المشرفين / الإدارة · تسجيل الخروج ·
⬇ تثبيت التطبيق · Gmail / Office 365 / Outlook presets · 🧪 اختبر استرجاع آخر نسخة ·
تحديد الكل كمقروء.

Why: they support the main action and must not compete with it. "تسجيل الخروج" stops being red
(logging out is not destructive).

### Ghost — icon-only (with tooltip and accessible name) or text link

| Action | # |
| --- | --- |
| 🌙 / ☀️ الوضع الليلي · EN / ع اللغة | 6 |
| 🔔 الإشعارات · ⟳ تحديث البيانات (header, hazards page) | 3 |
| 👁️ إظهار كلمة المرور | 1 |
| ✕ إغلاق (modals, chat) · ⟳ مسح المحادثة | 4 |
| ➖ / ➕ تكبير وتصغير الصورة · ⬇️ تحميل الصورة | 3 |
| ✏️ تعديل صنف · 🗑 حذف صنف (danger ghost, confirmed) · ✕ حذف صف (alerts) · 🗑️ حذف سؤال | 4 |
| نسيت كلمة السر؟ (text link) | 2 |

### Not action buttons (kept as their own components)

Filter chips and segmented controls keep their component styles: `.chip`, `.dash-quick-btn`
(آخر 7 أيام … آخر سنة), `.notif-pill`, `.mh-filter-btn`, `.lb-filter-btn`. The chat launcher
(`.cb-fab`), send (`.cb-send`) and mic (`.cb-mic`) stay as the chat widget's own controls.

## 4. Decisions (all four approved and applied)

1. **Add a confirmation** to the three one-click negative actions marked **+** (quick reject of a
   hazard, decline a training request, worker's forced close). This adds a dialog; the request
   sent to the server is unchanged.
2. **Replace the browser's `confirm()` boxes** with the styled confirmation dialog (title naming
   the item, consequence line, Cancel + filled danger button). Same handlers, same outcome.
3. **Move "مسح كل …" bulk deletes** into a "منطقة الخطر" block at the bottom of each page
   (same buttons, IDs and handlers; only their position changes).
4. **Delete the old classes** once each page is migrated: `act-btn`, `um-btn`, `export-btn`,
   `emp-dir-btn`, `dash-refresh-btn`, `dash-apply-btn`, `btn-amber/emerald/red/cyan`, `again-btn`,
   `settings-save`, `adv-filter-clear-btn`, `add-risk-btn`, and `logout-btn` / `submit-btn` where
   they style something else. Classes used by JS (`dash-quick-btn`, `notif-pill`, `wl-admin-btn`)
   stay.
