// Global variables
let allSheets = [];
let filteredSheets = [];
let productSummary = [];
let flatpickrFrom = null;
let flatpickrTo = null;

/** Current company (from main page selection, shared via localStorage) */
function getCurrentCompanyId() {
    const saved = localStorage.getItem('currentCompanyId');
    return saved ? parseInt(saved, 10) : null;
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await updateCompanyLabel();
        setupEventListeners();
        initProductSummaryDatePickers();
        await loadProductSummary();
    } catch (error) {
        console.error('Error initializing app:', error);
        showErrorAlert('Error initializing application: ' + error.message);
    }
});

/**
 * Parse DD-MM-YYYY string to Date. Returns null if invalid.
 */
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

/**
 * Initialize date pickers for From/To filter (DD-MM-YYYY)
 */
function initProductSummaryDatePickers() {
    if (typeof flatpickr === 'undefined') return;
    const commonOptions = {
        dateFormat: 'd-m-Y',
        allowInput: true,
        onChange: function() { applyProductSummaryFilters(); }
    };
    flatpickrFrom = flatpickr('#filterFromDate', commonOptions);
    flatpickrTo = flatpickr('#filterToDate', commonOptions);
}

/** Show current company name in header (white text) */
async function updateCompanyLabel() {
    const el = document.getElementById('productSummaryCompanyLabel');
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
    } catch (e) {
        el.textContent = '';
    }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Back button
    document.getElementById('btnBack').addEventListener('click', () => {
        window.location.href = 'sheets.html';
    });

    // Download PDF button
    document.getElementById('btnDownloadPDF').addEventListener('click', downloadProductSummaryPDF);

    // Filters
    document.getElementById('filterFromDate').addEventListener('change', applyProductSummaryFilters);
    document.getElementById('filterToDate').addEventListener('change', applyProductSummaryFilters);
    document.getElementById('filterRalti').addEventListener('change', applyProductSummaryFilters);
    document.getElementById('btnClearFilters').addEventListener('click', clearProductSummaryFilters);
}

/**
 * Load product summary (scoped by current company)
 */
async function loadProductSummary() {
    try {
        const companyId = getCurrentCompanyId();
        if (!companyId) {
            allSheets = [];
            applyProductSummaryFilters();
            return;
        }
        const sheetsRes = await window.electronAPI.getSheets(companyId, { fetch_all: true });
        allSheets = Array.isArray(sheetsRes?.data) ? sheetsRes.data : Array.isArray(sheetsRes) ? sheetsRes : [];
        applyProductSummaryFilters();
    } catch (error) {
        console.error('Error loading product summary:', error);
        showErrorAlert('Error loading product summary: ' + error.message);
    }
}

/**
 * Apply ralti and date filters, then recalculate and display summary
 */
function applyProductSummaryFilters() {
    const fromDateStr = document.getElementById('filterFromDate').value;
    const toDateStr = document.getElementById('filterToDate').value;
    const raltiFilter = document.getElementById('filterRalti').value;
    const fromParsed = parseDDMMYYYY(fromDateStr);
    const toParsed = parseDDMMYYYY(toDateStr);

    filteredSheets = allSheets.filter(sheet => {
        const matchRalti = !raltiFilter || sheet.ralti === raltiFilter;

        let matchDate = true;
        if (fromParsed || toParsed) {
            const sheetDate = new Date(sheet.date);
            sheetDate.setHours(0, 0, 0, 0);

            if (fromParsed) {
                const from = new Date(fromParsed);
                from.setHours(0, 0, 0, 0);
                if (sheetDate < from) matchDate = false;
            }
            if (toParsed && matchDate) {
                const to = new Date(toParsed);
                to.setHours(23, 59, 59, 999);
                if (sheetDate > to) matchDate = false;
            }
        }

        return matchRalti && matchDate;
    });

    calculateProductSummary();
    displayProductSummary();
}

/**
 * Clear all filters and refresh summary
 */
function clearProductSummaryFilters() {
    if (flatpickrFrom) flatpickrFrom.clear();
    if (flatpickrTo) flatpickrTo.clear();
    document.getElementById('filterRalti').value = '';
    const showBRatePdfEl = document.getElementById('filterShowBRatePdf');
    if (showBRatePdfEl) showBRatePdfEl.checked = true;
    applyProductSummaryFilters();
}

/**
 * Calculate product-wise summary grouped by product name and rate
 */
function calculateProductSummary() {
    const summaryMap = {};

    filteredSheets.forEach(sheet => {
        const productName = sheet.product_name || 'Unknown Product';
        const rate = parseFloat(sheet.rate || 0);
        const bRate = Math.round((parseFloat(sheet.b_rate || 0) || 0) * 100) / 100;
        const weight = parseFloat(sheet.weight || 0);
        // Create unique key combining product name and rate
        const key = `${productName}_${rate}_${bRate}`;
        
        if (!summaryMap[key]) {
            summaryMap[key] = {
                product_name: productName,
                rate: rate,
                b_rate: bRate,
                total_records: 0,
                total_weight: 0,
                total_b_amount: 0,
                total_amount: 0,
                total_amount_with_gst: 0
            };
        }
        
        summaryMap[key].total_records += 1;
        summaryMap[key].total_weight += weight;
        summaryMap[key].total_b_amount += bRate * weight;
        summaryMap[key].total_amount += parseFloat(sheet.amount || 0);
        summaryMap[key].total_amount_with_gst += parseFloat(sheet.amount_with_gst || 0);
    });
    
    // Convert map to array and sort by product name, then by rate
    productSummary = Object.values(summaryMap).sort((a, b) => {
        const nameCompare = a.product_name.localeCompare(b.product_name);
        if (nameCompare !== 0) {
            return nameCompare;
        }
        const rateCompare = a.rate - b.rate;
        if (rateCompare !== 0) return rateCompare;
        return (a.b_rate || 0) - (b.b_rate || 0);
    });
}

/**
 * Display product summary
 */
function displayProductSummary() {
    const tbody = document.getElementById('productSummaryTableBody');
    tbody.innerHTML = '';
    
    if (productSummary.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="9" style="text-align: center; padding: 2rem; color: #666;">
                No product data available
            </td>
        `;
        tbody.appendChild(row);
        return;
    }
    
    productSummary.forEach((summary, index) => {
        const row = document.createElement('tr');
        // Calculate GST amount (difference between amount with GST and amount)
        const gstAmount = summary.total_amount_with_gst - summary.total_amount;
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${summary.product_name}</td>
            <td>${summary.total_weight.toFixed(2)}</td>
            <td>${summary.rate.toFixed(2)}</td>
            <td>${parseFloat(summary.b_rate || 0).toFixed(2)}</td>
            <td>${summary.total_b_amount.toFixed(2)}</td>
            <td>${summary.total_amount.toFixed(2)}</td>
            <td>${gstAmount.toFixed(2)}</td>
            <td>${summary.total_amount_with_gst.toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
    
    // Add total row
    const totalRow = document.createElement('tr');
    totalRow.style.fontWeight = 'bold';
    totalRow.style.backgroundColor = '#f8f9fa';
    const totalWeight = productSummary.reduce((sum, p) => sum + p.total_weight, 0);
    const totalBAmount = productSummary.reduce((sum, p) => sum + p.total_b_amount, 0);
    const totalAmount = productSummary.reduce((sum, p) => sum + p.total_amount, 0);
    const totalAmountWithGst = productSummary.reduce((sum, p) => sum + p.total_amount_with_gst, 0);
    const totalGst = totalAmountWithGst - totalAmount;
    
    totalRow.innerHTML = `
        <td colspan="2" style="text-align: right; padding-right: 1rem;">TOTAL:</td>
        <td>${totalWeight.toFixed(2)}</td>
        <td></td>
        <td></td>
        <td>${totalBAmount.toFixed(2)}</td>
        <td>${totalAmount.toFixed(2)}</td>
        <td>${totalGst.toFixed(2)}</td>
        <td>${totalAmountWithGst.toFixed(2)}</td>
    `;
    tbody.appendChild(totalRow);
}

/**
 * SweetAlert helper functions
 */
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

function showInfoAlert(message) {
    return showAlert('Info', message, 'info');
}

/**
 * Helper function to restore focus after alert
 */
function restoreFocusAfterAlert(elementId, selectText = false) {
    setTimeout(() => {
        if (window.focus) {
            window.focus();
        }
        
        const element = document.getElementById(elementId);
        if (element) {
            if (element.readOnly) {
                element.readOnly = false;
            }
            if (element.disabled) {
                element.disabled = false;
            }
            
            element.focus();
            if (selectText && element.select) {
                element.select();
            }
        }
    }, 300);
}

/**
 * Format date as DD-MM-YY
 */
function formatDateDDMMYY(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2); // Last 2 digits of year
    return `${day}-${month}-${year}`;
}

/**
 * Download Product Summary as PDF
 */
async function downloadProductSummaryPDF() {
    try {
        if (!productSummary || productSummary.length === 0) {
            await showWarningAlert('No product summary data to download');
            return;
        }

        // Get company settings for current company
        const companyId = getCurrentCompanyId();
        if (!companyId) {
            await showWarningAlert('Please select a company on the main Invoice page first.');
            return;
        }
        const companySettings = await window.electronAPI.getCompanySettings(companyId);
        if (!companySettings) {
            await showWarningAlert('Please configure company settings first');
            return;
        }

        const showBRatePdfEl = document.getElementById('filterShowBRatePdf');
        const includeBRate = !(showBRatePdfEl) || !!showBRatePdfEl.checked;

        // Generate PDF HTML
        const printHTML = generateProductSummaryHTML(companySettings, productSummary, { includeBRate });

        // Verify content is there
        if (!printHTML || printHTML.trim() === '') {
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
        console.error('Error downloading product summary PDF:', error);
        showErrorAlert('Error downloading PDF: ' + error.message);
    }
}

/**
 * Generate Product Summary HTML for PDF
 */
function generateProductSummaryHTML(company, summaryData, options = {}) {
    try {
        const includeBRate = options.includeBRate !== false;
        const totalCols = includeBRate ? 9 : 7;
        const formattedDate = formatDateDDMMYY(new Date());
        const totalWeight = summaryData.reduce((sum, p) => sum + p.total_weight, 0);
        const totalBAmount = summaryData.reduce((sum, p) => sum + p.total_b_amount, 0);
        const totalAmount = summaryData.reduce((sum, p) => sum + p.total_amount, 0);
        const totalAmountWithGst = summaryData.reduce((sum, p) => sum + p.total_amount_with_gst, 0);
        const totalGst = totalAmountWithGst - totalAmount;

        return `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <title>Product Summary Report</title>
    
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
    
    .center {
      text-align: center;
    }
    
    .right {
      text-align: right;
    }
    
    .bold {
      font-weight: bold;
    }
    
    .big {
      font-size: 18px;
    }
    
    .medium {
      font-size: 14px;
    }
    </style>
    </head>
    
    <body>
    
    <table>
      <!-- HEADER -->
      <tr>
        <td colspan="${totalCols}" class="center bold big">RCC Behat Plant</td>
      </tr>
   
      <!-- TABLE HEADER -->
      <tr class="center bold">
        <td>S.NO</td>
        <td>MATERIAL</td>
        <td>QTY</td>
        <td>RS</td>
        ${includeBRate ? '<td>B Rate</td>' : ''}
        ${includeBRate ? '<td>B Amount</td>' : ''}
        <td>AMT</td>
        <td>GST</td>
        <td>AMT WITH GST</td>
      </tr>
    
      <!-- RECORDS -->
      ${summaryData.map((summary, index) => {
        const gstAmount = summary.total_amount_with_gst - summary.total_amount;
        return `
      <tr class="center">
        <td>${index + 1}</td>
        <td>${summary.product_name || ''}</td>
        <td class="right">${summary.total_weight.toFixed(2)}</td>
        <td class="right">${summary.rate.toFixed(2)}</td>
        ${includeBRate ? `<td class="right">${parseFloat(summary.b_rate || 0).toFixed(2)}</td>` : ''}
        ${includeBRate ? `<td class="right">${summary.total_b_amount.toFixed(2)}</td>` : ''}
        <td class="right">${summary.total_amount.toFixed(2)}</td>
        <td class="right">${gstAmount.toFixed(2)}</td>
        <td class="right">${summary.total_amount_with_gst.toFixed(2)}</td>
      </tr>
      `;
      }).join('')}
    
      <!-- TOTALS -->
      <tr class="bold">
        <td colspan="2" class="right">TOTAL:</td>
        <td class="right">${totalWeight.toFixed(2)}</td>
        <td class="right"></td>
        ${includeBRate ? '<td class="right"></td>' : ''}
        ${includeBRate ? `<td class="right">${totalBAmount.toFixed(2)}</td>` : ''}
        <td class="right">${totalAmount.toFixed(2)}</td>
        <td class="right">${totalGst.toFixed(2)}</td>
        <td class="right">${totalAmountWithGst.toFixed(2)}</td>
      </tr>
    
    </table>
    
    </body>
    </html>
    `;
        
    } catch (error) {
        console.error('Error generating product summary HTML:', error);
        showErrorAlert('Error generating product summary HTML: ' + error.message);
        return '';
    }
}

