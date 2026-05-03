let allPayments = [];
let paymentDatePicker = null;
let cpFilterDateFromPicker = null;
let cpFilterDateToPicker = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await updateCompanyLabel();
        setupEventListeners();
        initPaymentDatePicker();
        initCpListDateFilters();
        resetForm();
        await loadPage();
        updateCpSubmitButtonLabel();
    } catch (error) {
        console.error('Customer payment page init:', error);
        showErrorAlert('Error initializing page: ' + error.message);
    }
});

function getCurrentCompanyId() {
    const saved = localStorage.getItem('currentCompanyId');
    return saved ? parseInt(saved, 10) : null;
}

function parseDDMMYYYY(str) {
    if (!str || typeof str !== 'string') return null;
    const trimmed = str.trim();
    const parts = trimmed.split('-');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    const d = new Date(year, month, day);
    if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
    return d;
}

function paymentDateToYmd() {
    const el = document.getElementById('cpPaymentDate');
    if (!el || !el.value.trim()) return '';
    const d = parseDDMMYYYY(el.value.trim());
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatYMDToDDMMYYYY(value) {
    if (value == null || value === '') return '';
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '';
    return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatCurrency(value) {
    return (parseFloat(value || 0) || 0).toFixed(2);
}

/** Calendar date as YYYYMMDD (local) for comparing payment dates. */
function paymentLocalYyyymmdd(isoOrDate) {
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** List filters as YYYY-MM-DD for API / local DB. */
function getCustomerPaymentListFiltersForApi() {
    const fromEl = document.getElementById('cpFilterDateFrom');
    const toEl = document.getElementById('cpFilterDateTo');
    const fromVal = fromEl && fromEl.value ? fromEl.value.trim() : '';
    const toVal = toEl && toEl.value ? toEl.value.trim() : '';
    const out = {};
    if (fromVal) {
        const d = parseDDMMYYYY(fromVal);
        if (d) {
            out.date_from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    if (toVal) {
        const d = parseDDMMYYYY(toVal);
        if (d) {
            out.date_to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    if (out.date_from && out.date_to && out.date_from > out.date_to) {
        const t = out.date_from;
        out.date_from = out.date_to;
        out.date_to = t;
    }
    const filterCust = document.getElementById('cpFilterCustomer');
    const cid = filterCust && filterCust.value ? parseInt(filterCust.value, 10) : 0;
    if (cid) {
        out.customer_id = cid;
    }
    return out;
}

function hasActiveCustomerPaymentListFilters() {
    const f = getCustomerPaymentListFiltersForApi();
    return !!(f.date_from || f.date_to || f.customer_id);
}

function formatDateDDMMYY(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
}

function calculateCustomerPaymentsTotal() {
    return allPayments.reduce((sum, row) => sum + (parseFloat(row.amount || 0) || 0), 0);
}

function updateSummaryTotal() {
    const el = document.getElementById('cpSummaryTotalAmount');
    if (el) {
        el.textContent = formatCurrency(calculateCustomerPaymentsTotal());
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updateCpSubmitButtonLabel() {
    const btn = document.getElementById('btnSaveCp');
    if (!btn) return;
    if (btn.textContent === 'Saving...' || btn.textContent === 'Updating...') {
        return;
    }
    const id = document.getElementById('cpFormId')?.value?.trim();
    btn.textContent = id ? 'Update' : 'Save';
}

function setupEventListeners() {
    document.getElementById('btnBack').addEventListener('click', () => {
        window.location.href = 'index.html';
    });
    document.getElementById('btnSaveCp').addEventListener('click', saveForm);
    document.getElementById('btnCancelCp').addEventListener('click', resetForm);
    document.getElementById('btnDownloadCpPdf').addEventListener('click', downloadCustomerPaymentsPDF);

    const filterCust = document.getElementById('cpFilterCustomer');
    if (filterCust) {
        filterCust.addEventListener('change', () => {
            void loadPage().catch((err) => console.error('Customer payment filter:', err));
        });
    }
    const btnClear = document.getElementById('btnCpFilterClear');
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            if (filterCust) filterCust.value = '';
            if (cpFilterDateFromPicker) cpFilterDateFromPicker.clear();
            else {
                const a = document.getElementById('cpFilterDateFrom');
                if (a) a.value = '';
            }
            if (cpFilterDateToPicker) cpFilterDateToPicker.clear();
            else {
                const b = document.getElementById('cpFilterDateTo');
                if (b) b.value = '';
            }
            if (cpFilterDateToPicker) cpFilterDateToPicker.set('minDate', null);
            void loadPage().catch((err) => console.error('Clear customer payment filters:', err));
        });
    }
}

function initCpListDateFilters() {
    if (typeof flatpickr === 'undefined') return;
    const fromEl = document.getElementById('cpFilterDateFrom');
    const toEl = document.getElementById('cpFilterDateTo');
    if (!fromEl || !toEl) return;

    const refreshList = () => {
        void loadPage().catch((err) => console.error('Customer payment date filter:', err));
    };

    function resolveFromDate() {
        if (cpFilterDateFromPicker && cpFilterDateFromPicker.selectedDates.length) {
            return cpFilterDateFromPicker.selectedDates[0];
        }
        const v = fromEl.value.trim();
        return v ? parseDDMMYYYY(v) : null;
    }

    function applyToPickerMinFromFrom() {
        if (!cpFilterDateToPicker) return;
        const fromDate = resolveFromDate();
        if (fromDate) {
            cpFilterDateToPicker.set('minDate', fromDate);
            const toSel = cpFilterDateToPicker.selectedDates[0];
            if (toSel && paymentLocalYyyymmdd(toSel) < paymentLocalYyyymmdd(fromDate)) {
                cpFilterDateToPicker.setDate(fromDate, false);
            }
        } else {
            cpFilterDateToPicker.set('minDate', null);
        }
    }

    cpFilterDateFromPicker = flatpickr(fromEl, {
        dateFormat: 'd-m-Y',
        allowInput: true,
        onChange: () => {
            applyToPickerMinFromFrom();
            refreshList();
        },
    });

    cpFilterDateToPicker = flatpickr(toEl, {
        dateFormat: 'd-m-Y',
        allowInput: true,
        onChange: refreshList,
    });

    fromEl.addEventListener('blur', () => {
        applyToPickerMinFromFrom();
        refreshList();
    });
    toEl.addEventListener('blur', () => {
        const fromD = resolveFromDate();
        if (fromD && cpFilterDateToPicker) {
            let toD = cpFilterDateToPicker.selectedDates[0];
            if (!toD && toEl.value.trim()) toD = parseDDMMYYYY(toEl.value.trim());
            if (toD && paymentLocalYyyymmdd(toD) < paymentLocalYyyymmdd(fromD)) {
                cpFilterDateToPicker.setDate(fromD, false);
            }
        }
        refreshList();
    });
}

function initPaymentDatePicker() {
    if (typeof flatpickr === 'undefined') return;
    paymentDatePicker = flatpickr('#cpPaymentDate', {
        dateFormat: 'd-m-Y',
        allowInput: true,
    });
}

async function updateCompanyLabel() {
    const el = document.getElementById('customerPaymentCompanyLabel');
    if (!el) return;
    const companyId = getCurrentCompanyId();
    if (!companyId) {
        el.textContent = 'Select a company on the main Invoice page';
        return;
    }
    try {
        const companies = await window.electronAPI.getCompanies();
        const company = (companies || []).find(c => c.id === companyId);
        el.textContent = company ? `Company: ${company.company_name || '—'}` : '';
    } catch (error) {
        el.textContent = '';
    }
}

async function populateCustomerSelects() {
    const formSel = document.getElementById('cpCustomerId');
    const filterSel = document.getElementById('cpFilterCustomer');
    const companyId = getCurrentCompanyId();
    const prevForm = formSel ? formSel.value : '';
    const prevFilter = filterSel ? filterSel.value : '';

    if (formSel) {
        formSel.innerHTML = '<option value="">— Select customer —</option>';
    }
    if (filterSel) {
        filterSel.innerHTML = '<option value="">All customers</option>';
    }
    if (!companyId) return;

    try {
        const customers = await window.electronAPI.getCustomers(companyId);
        const list = Array.isArray(customers) ? customers : [];
        list.forEach((c) => {
            if (formSel) {
                const opt = document.createElement('option');
                opt.value = String(c.id);
                opt.textContent = c.name || `Customer ${c.id}`;
                formSel.appendChild(opt);
            }
            if (filterSel) {
                const optF = document.createElement('option');
                optF.value = String(c.id);
                optF.textContent = c.name || `Customer ${c.id}`;
                filterSel.appendChild(optF);
            }
        });
        if (formSel && prevForm && Array.from(formSel.options).some((o) => o.value === prevForm)) {
            formSel.value = prevForm;
        }
        if (filterSel && prevFilter && Array.from(filterSel.options).some((o) => o.value === prevFilter)) {
            filterSel.value = prevFilter;
        }
    } catch (e) {
        console.error(e);
    }
}

async function loadPage() {
    const companyId = getCurrentCompanyId();
    await populateCustomerSelects();
    if (!companyId) {
        allPayments = [];
        renderTable();
        updateSummaryTotal();
        return;
    }
    try {
        const filterOpts = getCustomerPaymentListFiltersForApi();
        const res = await window.electronAPI.getCustomerPayments(companyId, { fetch_all: true, ...filterOpts });
        allPayments = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        renderTable();
    } catch (error) {
        console.error(error);
        showErrorAlert('Error loading payments: ' + error.message);
        updateSummaryTotal();
    }
}

function renderTable() {
    const tbody = document.getElementById('cpTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!allPayments.length) {
        const tr = document.createElement('tr');
        const emptyMsg = hasActiveCustomerPaymentListFilters()
            ? 'No customer payments match these filters'
            : 'No customer payments yet';
        tr.innerHTML = `
            <td colspan="11" style="text-align: center; padding: 2rem; color: #666;">${emptyMsg}</td>
        `;
        tbody.appendChild(tr);
        updateSummaryTotal();
        return;
    }
    allPayments.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(row.customer_name || '')}</td>
            <td>${escapeHtml(formatYMDToDDMMYYYY(row.payment_date))}</td>
            <td class="right">${formatCurrency(row.amount)}</td>
            <td>${escapeHtml(row.payee_name || '')}</td>
            <td>${escapeHtml(row.account_number || '')}</td>
            <td>${escapeHtml(row.ifsc_code || '')}</td>
            <td>${escapeHtml(row.bank_name || '')}</td>
            <td>${escapeHtml(row.site || '')}</td>
            <td>${escapeHtml(row.rtgs || '')}</td>
            <td>${escapeHtml(row.utr_no || '')}</td>
            <td>
                <button type="button" class="btn btn-primary btn-small" data-action="edit" data-id="${row.id}">Edit</button>
                <button type="button" class="btn btn-danger btn-small" data-action="del" data-id="${row.id}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    tbody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
        btn.addEventListener('click', () => editRow(parseInt(btn.getAttribute('data-id'), 10)));
    });
    tbody.querySelectorAll('button[data-action="del"]').forEach((btn) => {
        btn.addEventListener('click', () => deleteRow(parseInt(btn.getAttribute('data-id'), 10)));
    });
    updateSummaryTotal();
}

function resetForm() {
    document.getElementById('cpFormId').value = '';
    document.getElementById('cpCustomerId').value = '';
    document.getElementById('cpAmount').value = '';
    document.getElementById('cpPayeeName').value = '';
    document.getElementById('cpAccountNumber').value = '';
    document.getElementById('cpIfscCode').value = '';
    document.getElementById('cpBankName').value = '';
    document.getElementById('cpSite').value = '';
    document.getElementById('cpRtgs').value = '';
    document.getElementById('cpUtrNo').value = '';
    if (paymentDatePicker) paymentDatePicker.clear();
    else {
        const el = document.getElementById('cpPaymentDate');
        if (el) el.value = '';
    }
    const btn = document.getElementById('btnSaveCp');
    if (btn) {
        btn.disabled = false;
        btn.textContent = '';
    }
    updateCpSubmitButtonLabel();
}

function editRow(id) {
    const row = allPayments.find((r) => r.id === id);
    if (!row) return;
    document.getElementById('cpFormId').value = String(row.id);
    document.getElementById('cpCustomerId').value = String(row.customer_id || '');
    document.getElementById('cpAmount').value = row.amount != null ? String(row.amount) : '';
    document.getElementById('cpPayeeName').value = row.payee_name || '';
    document.getElementById('cpAccountNumber').value = row.account_number || '';
    document.getElementById('cpIfscCode').value = row.ifsc_code || '';
    document.getElementById('cpBankName').value = row.bank_name || '';
    document.getElementById('cpSite').value = row.site || '';
    document.getElementById('cpRtgs').value = row.rtgs || '';
    document.getElementById('cpUtrNo').value = row.utr_no || '';
    const ddmm = formatYMDToDDMMYYYY(row.payment_date);
    if (paymentDatePicker && ddmm) {
        const [d, m, y] = ddmm.split('-').map(Number);
        if (d && m && y) paymentDatePicker.setDate(new Date(y, m - 1, d), false);
    } else {
        const el = document.getElementById('cpPaymentDate');
        if (el) el.value = ddmm;
    }
    updateCpSubmitButtonLabel();
}

async function deleteRow(id) {
    const result = await Swal.fire({
        title: 'Delete this payment?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
    });
    if (!result.isConfirmed) return;
    try {
        await window.electronAPI.deleteCustomerPayment(id);
        await showAlert('Success', 'Payment deleted.', 'success');
        await loadPage();
        resetForm();
    } catch (error) {
        showErrorAlert(error.message || 'Delete failed');
    }
}

async function saveForm() {
    const companyId = getCurrentCompanyId();
    if (!companyId) {
        showErrorAlert('Please select a company on the main Invoice page first.');
        return;
    }
    const customerId = parseInt(document.getElementById('cpCustomerId').value, 10);
    if (!customerId) {
        showErrorAlert('Please select a customer.', 'cpCustomerId');
        return;
    }
    const ymd = paymentDateToYmd();
    if (!ymd) {
        showErrorAlert('Please enter a valid date (DD-MM-YYYY).', 'cpPaymentDate');
        return;
    }
    const amount = parseFloat(document.getElementById('cpAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) {
        showErrorAlert('Please enter a valid amount greater than zero.', 'cpAmount');
        return;
    }
    const idVal = document.getElementById('cpFormId').value.trim();
    const payload = {
        company_id: companyId,
        customer_id: customerId,
        payment_date: ymd,
        amount,
        payee_name: document.getElementById('cpPayeeName').value.trim() || null,
        account_number: document.getElementById('cpAccountNumber').value.trim() || null,
        ifsc_code: document.getElementById('cpIfscCode').value.trim() || null,
        bank_name: document.getElementById('cpBankName').value.trim() || null,
        site: document.getElementById('cpSite').value.trim() || null,
        rtgs: document.getElementById('cpRtgs').value.trim() || null,
        utr_no: document.getElementById('cpUtrNo').value.trim() || null,
    };
    if (idVal) payload.id = parseInt(idVal, 10);

    const btn = document.getElementById('btnSaveCp');
    const isEdit = !!idVal;
    const busyLabel = isEdit ? 'Updating...' : 'Saving...';
    const idleLabel = isEdit ? 'Update' : 'Save';

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = busyLabel;
        }
        await window.electronAPI.saveCustomerPayment(payload);
        await showAlert('Success', isEdit ? 'Payment updated.' : 'Payment saved.', 'success');
        resetForm();
        await loadPage();
    } catch (error) {
        showErrorAlert(error.message || 'Save failed');
        if (btn) {
            btn.disabled = false;
            btn.textContent = idleLabel;
        }
    }
}

async function downloadCustomerPaymentsPDF() {
    if (!allPayments.length) {
        await showWarningAlert(
            hasActiveCustomerPaymentListFilters()
                ? 'No customer payments to download for the current filters'
                : 'No customer payments to download'
        );
        return;
    }
    const companyId = getCurrentCompanyId();
    if (!companyId) {
        await showWarningAlert('Please select a company on the main Invoice page first.');
        return;
    }
    try {
        const companySettings = await window.electronAPI.getCompanySettings(companyId);
        if (!companySettings) {
            await showWarningAlert('Please configure company settings first');
            return;
        }
        const total = calculateCustomerPaymentsTotal();
        const printHTML = generateCustomerPaymentsHTML(companySettings, allPayments, total);
        if (!printHTML || !printHTML.trim()) {
            await showErrorAlert('Could not build PDF content. Please try again.');
            return;
        }
        await window.electronAPI.downloadPDF(printHTML);
    } catch (error) {
        console.error('Customer payments PDF:', error);
        showErrorAlert('Error downloading PDF: ' + (error.message || ''));
    }
}

function generateCustomerPaymentsHTML(company, payments, totalAmount) {
    const formattedDate = formatDateDDMMYY(new Date());
    const dateForFileLine = formattedDate.replace(/-/g, '/');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Customer Payments Report</title>
<style>
@page { size: A4 landscape; margin: 8mm; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #000; padding: 3px; vertical-align: top; word-break: break-word; }
.center { text-align: center; }
.right { text-align: right; }
.bold { font-weight: bold; }
.big { font-size: 16px; }
</style>
</head>
<body>
<table>
  <tr>
    <td colspan="11" class="center bold big">CUSTOMER PAYMENTS REPORT</td>
  </tr>
  <tr>
    <td colspan="11" class="center bold">${escapeHtml(company.company_name || 'Company')}</td>
  </tr>
  <tr>
    <td colspan="11" class="right bold">Date: ${dateForFileLine}</td>
  </tr>
</table>
<br>
<table>
  <tr>
    <td colspan="8"></td>
    <td colspan="2" class="right bold">Total amount</td>
    <td class="right bold">${formatCurrency(totalAmount)}</td>
  </tr>
</table>
<br>
<table>
  <tr class="center bold">
    <td>S.No</td>
    <td>Customer name</td>
    <td>Date</td>
    <td>Amount</td>
    <td>Name</td>
    <td>A/C no.</td>
    <td>IFSC</td>
    <td>Bank name</td>
    <td>Site</td>
    <td>RTGS</td>
    <td>UTR no.</td>
  </tr>
  ${payments.map((row, index) => `
  <tr>
    <td class="center">${index + 1}</td>
    <td>${escapeHtml(row.customer_name || '')}</td>
    <td class="center">${escapeHtml(formatYMDToDDMMYYYY(row.payment_date))}</td>
    <td class="right">${formatCurrency(row.amount)}</td>
    <td>${escapeHtml(row.payee_name || '')}</td>
    <td>${escapeHtml(row.account_number || '')}</td>
    <td>${escapeHtml(row.ifsc_code || '')}</td>
    <td>${escapeHtml(row.bank_name || '')}</td>
    <td>${escapeHtml(row.site || '')}</td>
    <td>${escapeHtml(row.rtgs || '')}</td>
    <td>${escapeHtml(row.utr_no || '')}</td>
  </tr>
  `).join('')}
  <tr class="bold">
    <td colspan="3" class="right">TOTAL</td>
    <td class="right">${formatCurrency(totalAmount)}</td>
    <td colspan="7"></td>
  </tr>
</table>
</body>
</html>`;
}

async function showAlert(title, text, icon = 'info', focusElementId = null, selectText = false) {
    await Swal.fire({
        title,
        text,
        icon,
        confirmButtonText: 'OK',
        confirmButtonColor: '#667eea',
    });
    if (focusElementId) {
        setTimeout(() => {
            const element = document.getElementById(focusElementId);
            if (element) {
                element.focus();
                if (selectText && typeof element.select === 'function') element.select();
            }
        }, 100);
    }
}

function showErrorAlert(message, focusElementId = null, selectText = false) {
    return showAlert('Error', message, 'error', focusElementId, selectText);
}

function showWarningAlert(message, focusElementId = null, selectText = false) {
    return showAlert('Warning', message, 'warning', focusElementId, selectText);
}
