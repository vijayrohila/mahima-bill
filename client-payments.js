let allPayments = [];
let allSheets = [];
let paymentDatePicker = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await updateCompanyLabel();
        setupEventListeners();
        initPaymentDatePicker();
        resetPaymentForm();
        await loadClientPaymentsPage();
    } catch (error) {
        console.error('Error initializing client payments page:', error);
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

function normalizeApiDateString(value) {
    if (value == null || value === '') return '';
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatYMDToDDMMYYYY(value) {
    const ymd = normalizeApiDateString(value);
    if (!ymd) return '';
    const [year, month, day] = ymd.split('-');
    return `${day}-${month}-${year}`;
}

function formatDateDDMMYY(value) {
    const ymd = normalizeApiDateString(value);
    if (!ymd) return '';
    const [year, month, day] = ymd.split('-');
    return `${day}-${month}-${String(year).slice(-2)}`;
}

function formatCurrency(value) {
    return (parseFloat(value || 0) || 0).toFixed(2);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildBankDetailsLines(payment) {
    const lines = [];
    if (payment.bank_name) lines.push(`Bank: ${payment.bank_name}`);
    if (payment.account_number) lines.push(`A/C No: ${payment.account_number}`);
    if (payment.ifsc_code) lines.push(`IFSC: ${payment.ifsc_code}`);
    if (!lines.length && payment.bank_details) lines.push(String(payment.bank_details));
    return lines;
}

function buildBankDetailsHtml(payment) {
    return buildBankDetailsLines(payment).map(line => escapeHtml(line)).join('<br>');
}

function setupEventListeners() {
    document.getElementById('btnBack').addEventListener('click', () => {
        window.location.href = 'sheets.html';
    });
    document.getElementById('btnSavePayment').addEventListener('click', savePaymentForm);
    document.getElementById('btnCancelPayment').addEventListener('click', resetPaymentForm);
    document.getElementById('btnDownloadPaymentsPDF').addEventListener('click', downloadPaymentsPDF);
}

function initPaymentDatePicker() {
    if (typeof flatpickr === 'undefined') return;
    paymentDatePicker = flatpickr('#paymentDate', {
        dateFormat: 'd-m-Y',
        allowInput: true
    });
}

async function updateCompanyLabel() {
    const el = document.getElementById('clientPaymentsCompanyLabel');
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

async function loadClientPaymentsPage() {
    const companyId = getCurrentCompanyId();
    if (!companyId) {
        allPayments = [];
        allSheets = [];
        renderPaymentsTable();
        updateSummaryCards();
        return;
    }

    try {
        const [paymentsRes, sheetsRes] = await Promise.all([
            window.electronAPI.getSheetPayments(companyId, { fetch_all: true }),
            window.electronAPI.getSheets(companyId, { fetch_all: true })
        ]);

        allPayments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : Array.isArray(paymentsRes) ? paymentsRes : [];
        allSheets = Array.isArray(sheetsRes?.data) ? sheetsRes.data : Array.isArray(sheetsRes) ? sheetsRes : [];
        renderPaymentsTable();
        updateSummaryCards();
    } catch (error) {
        console.error('Error loading client payments:', error);
        showErrorAlert('Error loading client payments: ' + error.message);
    }
}

function calculateTotals() {
    const totalBaseAmount = allSheets.reduce((sum, sheet) => sum + (parseFloat(sheet.amount || 0) || 0), 0);
    const totalRccAmount = allSheets.reduce((sum, sheet) => {
        const gross = parseFloat(sheet.amount_with_gst ?? sheet.amount ?? 0);
        return sum + (gross || 0);
    }, 0);
    const totalReceived = allPayments.reduce((sum, payment) => sum + (parseFloat(payment.amount || 0) || 0), 0);
    const remainingAmount = totalRccAmount - totalReceived;

    return {
        totalBaseAmount,
        totalRccAmount,
        totalReceived,
        remainingAmount
    };
}

function updateSummaryCards() {
    const totals = calculateTotals();
    document.getElementById('summaryTotalBaseAmount').textContent = formatCurrency(totals.totalBaseAmount);
    document.getElementById('summaryTotalRccAmount').textContent = formatCurrency(totals.totalRccAmount);
    document.getElementById('summaryTotalReceived').textContent = formatCurrency(totals.totalReceived);
    document.getElementById('summaryRemainingAmount').textContent = formatCurrency(totals.remainingAmount);
}

function renderPaymentsTable() {
    const tbody = document.getElementById('clientPaymentsTableBody');
    tbody.innerHTML = '';

    if (!allPayments.length) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="6" style="text-align: center; padding: 2rem; color: #666;">
                No client payments available
            </td>
        `;
        tbody.appendChild(row);
        return;
    }

    allPayments.forEach((payment, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${escapeHtml(payment.firm_name || '')}</td>
            <td style="white-space: pre-line;">${buildBankDetailsHtml(payment)}</td>
            <td>${formatCurrency(payment.amount)}</td>
            <td>${formatYMDToDDMMYYYY(payment.payment_date)}</td>
            <td>
                <div style="display: flex; gap: 0.5rem; justify-content: center;">
                    <button type="button" class="btn btn-secondary btn-small" data-action="edit" data-id="${payment.id}">Edit</button>
                    <button type="button" class="btn btn-danger btn-small" data-action="delete" data-id="${payment.id}">Delete</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    tbody.querySelectorAll('button[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => editPayment(parseInt(btn.dataset.id, 10)));
    });
    tbody.querySelectorAll('button[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => deletePayment(parseInt(btn.dataset.id, 10)));
    });
}

function resetPaymentForm() {
    document.getElementById('paymentFormId').value = '';
    document.getElementById('paymentFirmName').value = '';
    document.getElementById('paymentBankName').value = '';
    document.getElementById('paymentAccountNumber').value = '';
    document.getElementById('paymentIfscCode').value = '';
    document.getElementById('paymentAmount').value = '';
    const now = new Date();
    const today = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
    if (paymentDatePicker) {
        paymentDatePicker.setDate(now, false);
    } else {
        document.getElementById('paymentDate').value = today;
    }
    document.getElementById('btnSavePayment').textContent = 'Save Payment';
}

function editPayment(id) {
    const payment = allPayments.find(item => Number(item.id) === Number(id));
    if (!payment) return;

    document.getElementById('paymentFormId').value = String(payment.id);
    document.getElementById('paymentFirmName').value = payment.firm_name || '';
    document.getElementById('paymentBankName').value = payment.bank_name || '';
    document.getElementById('paymentAccountNumber').value = payment.account_number || '';
    document.getElementById('paymentIfscCode').value = payment.ifsc_code || '';
    document.getElementById('paymentAmount').value = formatCurrency(payment.amount);
    const paymentDate = formatYMDToDDMMYYYY(payment.payment_date);
    if (paymentDatePicker) {
        paymentDatePicker.setDate(paymentDate, false, 'd-m-Y');
    } else {
        document.getElementById('paymentDate').value = paymentDate;
    }
    document.getElementById('btnSavePayment').textContent = 'Update Payment';
    document.getElementById('paymentFirmName').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function savePaymentForm() {
    const companyId = getCurrentCompanyId();
    if (!companyId) {
        await showWarningAlert('Please select a company on the main Invoice page first.');
        return;
    }

    const formId = document.getElementById('paymentFormId').value.trim();
    const firmName = document.getElementById('paymentFirmName').value.trim();
    const bankName = document.getElementById('paymentBankName').value.trim();
    const accountNumber = document.getElementById('paymentAccountNumber').value.trim();
    const ifscCode = document.getElementById('paymentIfscCode').value.trim();
    const amountRaw = document.getElementById('paymentAmount').value.trim();
    const paymentDateRaw = document.getElementById('paymentDate').value.trim();
    const paymentDate = parseDDMMYYYY(paymentDateRaw);
    const amount = parseFloat(amountRaw);

    if (!firmName) {
        await showWarningAlert('Please enter firm name', 'paymentFirmName', true);
        return;
    }
    if (!amountRaw || isNaN(amount) || amount <= 0) {
        await showWarningAlert('Please enter a valid amount', 'paymentAmount', true);
        return;
    }
    if (!paymentDate) {
        await showWarningAlert('Please enter a valid date (DD-MM-YYYY)', 'paymentDate', true);
        return;
    }

    const payload = {
        company_id: companyId,
        firm_name: firmName,
        bank_name: bankName,
        account_number: accountNumber,
        ifsc_code: ifscCode,
        amount: amount,
        payment_date: `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}-${String(paymentDate.getDate()).padStart(2, '0')}`
    };
    if (formId) {
        payload.id = parseInt(formId, 10);
    }

    try {
        await window.electronAPI.saveSheetPayment(payload);
        await loadClientPaymentsPage();
        resetPaymentForm();
        await showSuccessAlert(formId ? 'Payment updated successfully!' : 'Payment saved successfully!');
    } catch (error) {
        console.error('Error saving payment:', error);
        showErrorAlert('Error saving payment: ' + error.message);
    }
}

async function deletePayment(id) {
    const payment = allPayments.find(item => Number(item.id) === Number(id));
    if (!payment) return;

    const result = await Swal.fire({
        title: 'Delete payment?',
        text: `Delete payment from ${payment.firm_name || 'this client'}?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#d33'
    });

    if (!result.isConfirmed) return;

    try {
        await window.electronAPI.deleteSheetPayment(id);
        await loadClientPaymentsPage();
        if (String(id) === document.getElementById('paymentFormId').value) {
            resetPaymentForm();
        }
        await showSuccessAlert('Payment deleted successfully!');
    } catch (error) {
        console.error('Error deleting payment:', error);
        showErrorAlert('Error deleting payment: ' + error.message);
    }
}

async function downloadPaymentsPDF() {
    if (!allPayments.length) {
        await showWarningAlert('No client payments to download');
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

        const printHTML = generateClientPaymentsHTML(companySettings, allPayments, calculateTotals());
        if (!printHTML || !printHTML.trim()) {
            await showErrorAlert('Error: Print content is empty. Please try again.');
            return;
        }

        if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
        try {
            await window.electronAPI.downloadPDF(printHTML);
        } catch (error) {
            showErrorAlert('Error downloading PDF: ' + error.message);
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Error downloading client payments PDF:', error);
        showErrorAlert('Error downloading PDF: ' + error.message);
    }
}

function generateClientPaymentsHTML(company, payments, totals) {
    const formattedDate = formatDateDDMMYY(new Date());

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Client Payments Report</title>
<style>
@page {
  size: A4;
  margin: 8mm;
}
body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td, th {
  border: 1px solid #000;
  padding: 4px;
  vertical-align: top;
}
.center { text-align: center; }
.right { text-align: right; }
.bold { font-weight: bold; }
.big { font-size: 18px; }
.summary-table td {
  width: 25%;
}
</style>
</head>
<body>
<table>
  <tr>
    <td colspan="5" class="center bold big">CLIENT PAYMENTS REPORT</td>
  </tr>
  <tr>
    <td colspan="5" class="center bold">${escapeHtml(company.company_name || 'Company')}</td>
  </tr>
  <tr>
    <td colspan="5" class="right bold">Date: ${formattedDate.replace(/-/g, '/')}</td>
  </tr>
</table>
<br>
<table class="summary-table">
  <tr class="bold center">
    <td>Total RCC Amount</td>
    <td>Total RCC Amount With GST</td>
    <td>Total Payment Received</td>
    <td>Remaining Amount</td>
  </tr>
  <tr class="center">
    <td>${formatCurrency(totals.totalBaseAmount)}</td>
    <td>${formatCurrency(totals.totalRccAmount)}</td>
    <td>${formatCurrency(totals.totalReceived)}</td>
    <td>${formatCurrency(totals.remainingAmount)}</td>
  </tr>
</table>
<br>
<table>
  <tr class="center bold">
    <td>S.No</td>
    <td>Firm Name</td>
    <td>Bank Details</td>
    <td>Amount</td>
    <td>Date</td>
  </tr>
  ${payments.map((payment, index) => `
    <tr>
      <td class="center">${index + 1}</td>
      <td>${escapeHtml(payment.firm_name || '')}</td>
      <td>${buildBankDetailsHtml(payment)}</td>
      <td class="right">${formatCurrency(payment.amount)}</td>
      <td class="center">${formatYMDToDDMMYYYY(payment.payment_date)}</td>
    </tr>
  `).join('')}
  <tr class="bold">
    <td colspan="3" class="right">TOTAL RECEIVED:</td>
    <td class="right">${formatCurrency(totals.totalReceived)}</td>
    <td></td>
  </tr>
</table>
</body>
</html>`;
}

async function showAlert(title, text, icon = 'info', focusElementId = null, selectText = false) {
    await Swal.fire({
        title: title,
        text: text,
        icon: icon,
        confirmButtonText: 'OK',
        confirmButtonColor: '#667eea'
    });

    if (focusElementId) {
        restoreFocusAfterAlert(focusElementId, selectText);
    }
}

function showErrorAlert(message, focusElementId = null, selectText = false) {
    return showAlert('Error', message, 'error', focusElementId, selectText);
}

function showSuccessAlert(message) {
    return showAlert('Success', message, 'success');
}

function showWarningAlert(message, focusElementId = null, selectText = false) {
    return showAlert('Warning', message, 'warning', focusElementId, selectText);
}

function restoreFocusAfterAlert(elementId, selectText = false) {
    setTimeout(() => {
        if (window.focus) {
            window.focus();
        }

        const element = document.getElementById(elementId);
        if (element) {
            element.focus();
            if (typeof element.select === 'function' && selectText) {
                element.select();
            }
        }
    }, 100);
}
