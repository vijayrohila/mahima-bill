// Global variables
let allSheets = [];
let filteredSheets = [];
let sheetsListTotal = 0;
let currentSheetsPage = 1;
let sheetsPerPage = 25;
let products = [];
let flatpickrFrom = null;
let flatpickrTo = null;
let sheetFormDatePicker = null;

// RCC: add form accordion + in-table row edit
let sheetFormAccordionEl = null;
let sheetFormAccordionDefaultLocation = null;
/** When set, that record row is rendered as inline editors (same columns as the list). */
let inlineEditingSheetId = null;
let inlineEditFlatpickr = null;

function sheetFormEl(root, field) {
    if (!root) return null;
    return root.querySelector(`[data-sheet-field="${field}"]`);
}

function destroyInlineEditFlatpickr() {
    if (inlineEditFlatpickr) {
        try {
            inlineEditFlatpickr.destroy();
        } catch (e) { /* ignore */ }
        inlineEditFlatpickr = null;
    }
}

function wireRootFormCalculations(root) {
    const rateField = sheetFormEl(root, 'rate');
    const weightField = sheetFormEl(root, 'weight');
    const bRateField = sheetFormEl(root, 'b_rate');
    const gstField = sheetFormEl(root, 'gst');
    if (!rateField || !weightField || !gstField) return;
    const newRateField = rateField.cloneNode(true);
    const newWeightField = weightField.cloneNode(true);
    const newBRateField = bRateField ? bRateField.cloneNode(true) : null;
    const newGstField = gstField.cloneNode(true);
    rateField.parentNode.replaceChild(newRateField, rateField);
    weightField.parentNode.replaceChild(newWeightField, weightField);
    if (bRateField && newBRateField) bRateField.parentNode.replaceChild(newBRateField, bRateField);
    gstField.parentNode.replaceChild(newGstField, gstField);
    sheetFormEl(root, 'rate').addEventListener('input', () => calculateSheetAmounts(root));
    sheetFormEl(root, 'weight').addEventListener('input', () => calculateSheetAmounts(root));
    if (sheetFormEl(root, 'b_rate')) {
        sheetFormEl(root, 'b_rate').addEventListener('input', () => calculateSheetAmounts(root));
    }
    sheetFormEl(root, 'gst').addEventListener('input', () => calculateSheetAmounts(root));
}

function wireInlineEditRow(tr) {
    const root = tr;
    const productSelect = sheetFormEl(root, 'product_id');
    if (productSelect) {
        productSelect.onchange = function() {
            const selectedId = parseInt(this.value, 10);
            const product = products.find(p => p.id === selectedId);
            const rateInput = sheetFormEl(root, 'rate');
            if (product && rateInput) {
                rateInput.value = parseFloat(product.rate || 0);
                calculateSheetAmounts(root);
            }
        };
    }
    wireRootFormCalculations(root);
    const dateInput = sheetFormEl(root, 'date');
    if (dateInput && typeof flatpickr !== 'undefined') {
        destroyInlineEditFlatpickr();
        inlineEditFlatpickr = flatpickr(dateInput, { dateFormat: 'd-m-Y', allowInput: true });
    }
}

function renderInlineEditRow(sheet, serialNumber) {
    const tr = document.createElement('tr');
    tr.id = `sheetRow_${sheet.id}`;
    tr.dataset.sheetId = String(sheet.id);
    tr.className = 'rcc-row-editing';

    const pid = sheet.product_id != null ? Number(sheet.product_id) : NaN;

    const tdSn = document.createElement('td');
    tdSn.textContent = String(serialNumber);
    tr.appendChild(tdSn);

    const tdInv = document.createElement('td');
    const inv = document.createElement('input');
    inv.type = 'text';
    inv.className = 'rcc-inline-input';
    inv.id = `rccInlineInv_${sheet.id}`;
    inv.setAttribute('data-sheet-field', 'invoice_no');
    inv.value = sheet.invoice_no || '';
    inv.required = true;
    inv.dataset.sheetId = String(sheet.id);
    tdInv.appendChild(inv);
    tr.appendChild(tdInv);

    const tdProd = document.createElement('td');
    const sel = document.createElement('select');
    sel.className = 'rcc-inline-select';
    sel.id = `rccInlineProd_${sheet.id}`;
    sel.setAttribute('data-sheet-field', 'product_id');
    sel.required = true;
    const o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = '-- Select Product --';
    sel.appendChild(o0);
    products.forEach(p => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name;
        if (Number(p.id) === pid) o.selected = true;
        sel.appendChild(o);
    });
    tdProd.appendChild(sel);
    tr.appendChild(tdProd);

    const tdW = document.createElement('td');
    const w = document.createElement('input');
    w.type = 'number';
    w.className = 'rcc-inline-input';
    w.id = `rccInlineW_${sheet.id}`;
    w.setAttribute('data-sheet-field', 'weight');
    w.step = '1';
    w.value = sheet.weight != null ? String(sheet.weight) : '0';
    tdW.appendChild(w);
    tr.appendChild(tdW);

    const tdTruck = document.createElement('td');
    const truck = document.createElement('input');
    truck.type = 'text';
    truck.className = 'rcc-inline-input';
    truck.id = `rccInlineTruck_${sheet.id}`;
    truck.setAttribute('data-sheet-field', 'truck_number');
    truck.value = sheet.truck_number || '';
    tdTruck.appendChild(truck);
    tr.appendChild(tdTruck);

    const tdRalti = document.createElement('td');
    const rsel = document.createElement('select');
    rsel.className = 'rcc-inline-select';
    rsel.id = `rccInlineRalti_${sheet.id}`;
    rsel.setAttribute('data-sheet-field', 'ralti');
    rsel.required = true;
    ['Yes', 'No'].forEach(val => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = val;
        if ((sheet.ralti || 'No') === val) o.selected = true;
        rsel.appendChild(o);
    });
    tdRalti.appendChild(rsel);
    tr.appendChild(tdRalti);

    const tdRate = document.createElement('td');
    const rate = document.createElement('input');
    rate.type = 'number';
    rate.className = 'rcc-inline-input';
    rate.id = `rccInlineRate_${sheet.id}`;
    rate.setAttribute('data-sheet-field', 'rate');
    rate.step = '1';
    rate.value = sheet.rate != null ? String(sheet.rate) : '0';
    tdRate.appendChild(rate);
    tr.appendChild(tdRate);

    const tdBRate = document.createElement('td');
    const bRate = document.createElement('input');
    bRate.type = 'number';
    bRate.className = 'rcc-inline-input';
    bRate.id = `rccInlineBRate_${sheet.id}`;
    bRate.setAttribute('data-sheet-field', 'b_rate');
    bRate.step = '0.01';
    bRate.value = sheet.b_rate != null ? String(sheet.b_rate) : '0';
    tdBRate.appendChild(bRate);
    tr.appendChild(tdBRate);

    const tdBAmount = document.createElement('td');
    const bAmount = document.createElement('input');
    bAmount.type = 'number';
    bAmount.className = 'rcc-inline-input';
    bAmount.id = `rccInlineBAmount_${sheet.id}`;
    bAmount.setAttribute('data-sheet-field', 'b_amount');
    bAmount.step = '0.01';
    bAmount.readOnly = true;
    bAmount.value = calculateBAmount(sheet.weight, sheet.b_rate).toFixed(2);
    tdBAmount.appendChild(bAmount);
    tr.appendChild(tdBAmount);

    const tdGst = document.createElement('td');
    const gst = document.createElement('input');
    gst.type = 'number';
    gst.className = 'rcc-inline-input';
    gst.id = `rccInlineGst_${sheet.id}`;
    gst.setAttribute('data-sheet-field', 'gst');
    gst.step = '1';
    gst.value = sheet.gst != null ? String(sheet.gst) : '5';
    tdGst.appendChild(gst);
    tr.appendChild(tdGst);

    const tdAmt = document.createElement('td');
    const amt = document.createElement('input');
    amt.type = 'number';
    amt.className = 'rcc-inline-input';
    amt.id = `rccInlineAmt_${sheet.id}`;
    amt.setAttribute('data-sheet-field', 'amount');
    amt.step = '0.01';
    amt.readOnly = true;
    amt.value = sheet.amount != null ? String(parseFloat(sheet.amount).toFixed(2)) : '0';
    tdAmt.appendChild(amt);
    tr.appendChild(tdAmt);

    const tdAmtG = document.createElement('td');
    const amtG = document.createElement('input');
    amtG.type = 'number';
    amtG.className = 'rcc-inline-input';
    amtG.id = `rccInlineAmtG_${sheet.id}`;
    amtG.setAttribute('data-sheet-field', 'amount_with_gst');
    amtG.step = '0.01';
    amtG.readOnly = true;
    amtG.value = sheet.amount_with_gst != null ? String(parseFloat(sheet.amount_with_gst).toFixed(2)) : '0';
    tdAmtG.appendChild(amtG);
    tr.appendChild(tdAmtG);

    const tdDate = document.createElement('td');
    const dateInp = document.createElement('input');
    dateInp.type = 'text';
    dateInp.className = 'rcc-inline-input';
    dateInp.id = `rccInlineDate_${sheet.id}`;
    dateInp.setAttribute('data-sheet-field', 'date');
    dateInp.required = true;
    dateInp.value = formatDateDDMMYYYY(new Date(sheet.date));
    tdDate.appendChild(dateInp);
    tr.appendChild(tdDate);

    const tdAct = document.createElement('td');
    tdAct.className = 'rcc-inline-actions';
    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'btn btn-success btn-small';
    btnUp.textContent = '✓';
    btnUp.title = 'Update';
    btnUp.setAttribute('aria-label', 'Update');
    btnUp.onclick = () => saveInlineRcc(sheet.id);
    const btnCan = document.createElement('button');
    btnCan.type = 'button';
    btnCan.className = 'btn btn-secondary btn-small';
    btnCan.textContent = '✕';
    btnCan.title = 'Cancel';
    btnCan.setAttribute('aria-label', 'Cancel');
    btnCan.onclick = () => cancelInlineRcc();
    tdAct.appendChild(btnUp);
    tdAct.appendChild(btnCan);
    tr.appendChild(tdAct);

    return tr;
}

function cancelInlineRcc() {
    inlineEditingSheetId = null;
    displaySheets();
}

async function saveInlineRcc(sheetId) {
    const row = document.getElementById(`sheetRow_${sheetId}`);
    if (!row) return;
    await validateAndSaveRccFromRoot(row);
}

/** Current company (from main page selection, shared via localStorage) */
function getCurrentCompanyId() {
    const saved = localStorage.getItem('currentCompanyId');
    return saved ? parseInt(saved, 10) : null;
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

/** Format date as DD-MM-YYYY */
function formatDateDDMMYYYY(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

function normalizeSheetsResponse(res) {
    if (Array.isArray(res)) {
        const n = res.length;
        return {
            data: res,
            meta: { total: n, current_page: 1, per_page: Math.max(1, n || 1), last_page: n ? 1 : 0 },
        };
    }
    return {
        data: Array.isArray(res?.data) ? res.data : [],
        meta: res?.meta || { total: 0, current_page: 1, per_page: 25, last_page: 0 },
    };
}

function calculateBAmount(weight, bRate) {
    return (parseFloat(weight) || 0) * (parseFloat(bRate) || 0);
}

function buildSheetsListOptions(overrides = {}) {
    const productFilter = document.getElementById('filterProduct').value;
    const raltiFilter = document.getElementById('filterRalti').value;
    const searchTerm = document.getElementById('filterSearch').value.trim();
    const fromDate = document.getElementById('filterFromDate').value.trim();
    const toDate = document.getElementById('filterToDate').value.trim();
    const sortBy = document.getElementById('sortBy').value;
    const sortOrder = document.getElementById('sortOrder').value;

    const o = {
        fetch_all: false,
        sort_by: sortBy,
        sort_order: sortOrder,
        ...overrides,
    };
    if (!o.fetch_all) {
        o.page = currentSheetsPage;
        o.per_page = sheetsPerPage;
    }
    if (productFilter) o.product_name = productFilter;
    if (raltiFilter) o.ralti = raltiFilter;
    if (searchTerm) o.search = searchTerm;
    if (fromDate) {
        const d = parseDDMMYYYY(fromDate);
        if (d) {
            o.date_from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    if (toDate) {
        const d = parseDDMMYYYY(toDate);
        if (d) {
            o.date_to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    if (o.date_from && o.date_to && o.date_from > o.date_to) {
        const t = o.date_from;
        o.date_from = o.date_to;
        o.date_to = t;
    }
    return o;
}

async function fetchSheetsPage(resetPage = true) {
    const companyId = getCurrentCompanyId();
    if (!companyId) {
        allSheets = [];
        filteredSheets = [];
        sheetsListTotal = 0;
        displaySheets();
        return;
    }
    if (resetPage) {
        currentSheetsPage = 1;
    }
    try {
        const raw = await window.electronAPI.getSheets(companyId, buildSheetsListOptions());
        const norm = normalizeSheetsResponse(raw);
        const totalPages = norm.meta.total > 0 ? Math.ceil(norm.meta.total / sheetsPerPage) : 0;
        if (norm.meta.total > 0 && currentSheetsPage > totalPages) {
            currentSheetsPage = totalPages;
            return fetchSheetsPage(false);
        }
        allSheets = norm.data;
        filteredSheets = norm.data;
        sheetsListTotal = norm.meta.total;
        displaySheets();
    } catch (e) {
        console.error('RCC list fetch:', e);
        showErrorAlert('Error loading RCC records: ' + (e.message || ''));
    }
}

function populateProductFilterFromProducts() {
    const productFilter = document.getElementById('filterProduct');
    if (!productFilter) return;
    const prev = productFilter.value;
    productFilter.innerHTML = '<option value="">All Products</option>';
    products.forEach(product => {
        const option = document.createElement('option');
        option.value = product.name;
        option.textContent = product.name;
        productFilter.appendChild(option);
    });
    if (prev && [...productFilter.options].some(o => o.value === prev)) {
        productFilter.value = prev;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
    try {
        await updateCompanyLabel();
        await loadInitialData();
        setupEventListeners();
        initFilterDatePickers();
        initSheetFormDatePicker();
        await loadSheets();
    } catch (error) {
        console.error('Error initializing app:', error);
        showErrorAlert('Error initializing application: ' + error.message);
    } finally {
        if (typeof window.endAppLoading === 'function') window.endAppLoading();
    }
});

/**
 * Initialize date pickers for From/To filter with DD-MM-YYYY format
 */
function initFilterDatePickers() {
    if (typeof flatpickr === 'undefined') return;
    const commonOptions = {
        dateFormat: 'd-m-Y',
        allowInput: true,
        onChange: function() { applySheetsFilters(); }
    };
    flatpickrFrom = flatpickr('#filterFromDate', commonOptions);
    flatpickrTo = flatpickr('#filterToDate', commonOptions);
}

/**
 * Initialize date picker for Add/Edit RCC record form (DD-MM-YYYY)
 */
function initSheetFormDatePicker() {
    if (typeof flatpickr === 'undefined') return;
    const el = document.getElementById('sheetFormDate');
    if (!el) return;
    sheetFormDatePicker = flatpickr('#sheetFormDate', {
        dateFormat: 'd-m-Y',
        allowInput: true
    });
}

/** Show current company name in header (from main page selection) */
async function updateCompanyLabel() {
    const el = document.getElementById('sheetsCompanyLabel');
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
 * Load initial data (products for current company)
 */
async function loadInitialData() {
    try {
        const companyId = getCurrentCompanyId();
        if (!companyId) {
            products = [];
            return;
        }
        const productsData = await window.electronAPI.getProducts(companyId);
        products = Array.isArray(productsData) ? productsData : [];
    } catch (error) {
        console.error('Error loading initial data:', error);
        showErrorAlert('Error loading data: ' + error.message);
        products = [];
    }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Back button
    document.getElementById('btnBack').addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    // Product Summary button
    document.getElementById('btnProductSummary').addEventListener('click', () => {
        window.location.href = 'product-summary.html';
    });
    document.getElementById('btnClientPayments').addEventListener('click', () => {
        window.location.href = 'client-payments.html';
    });

    // Sheets
    document.getElementById('btnAddNewSheet').addEventListener('click', () => {
        inlineEditingSheetId = null;
        openSheetForm();
        if (sheetFormAccordionEl) {
            moveSheetFormAccordionToDefault();
            sheetFormAccordionEl.style.display = 'table-row';
            sheetFormAccordionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
    document.getElementById('btnSaveSheetForm').addEventListener('click', saveSheetForm);
    document.getElementById('btnCancelSheetForm').addEventListener('click', () => {
        inlineEditingSheetId = null;
        if (sheetFormAccordionEl) {
            sheetFormAccordionEl.style.display = 'none';
            moveSheetFormAccordionToDefault();
        }
    });
    const toggleBtn = document.getElementById('btnToggleSheetForm');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const accordion = sheetFormAccordionEl;
            if (!accordion) return;
            if (accordion.style.display === 'none' || accordion.style.display === '') {
                accordion.style.display = 'table-row';
            } else {
                inlineEditingSheetId = null;
                accordion.style.display = 'none';
            }
        });
    }

    // Capture accordion element + default location once
    sheetFormAccordionEl = document.getElementById('sheetFormAccordion');
    if (sheetFormAccordionEl && !sheetFormAccordionDefaultLocation) {
        sheetFormAccordionDefaultLocation = {
            parent: sheetFormAccordionEl.parentNode,
            nextSibling: sheetFormAccordionEl.nextSibling // can be null
        };
    }
    document.getElementById('btnDownloadSheetsPDF').addEventListener('click', downloadSheetsPDF);
    
    // Sheets filters and pagination
    document.getElementById('filterSearch').addEventListener('input', applySheetsFilters);
    document.getElementById('filterFromDate').addEventListener('change', applySheetsFilters);
    document.getElementById('filterToDate').addEventListener('change', applySheetsFilters);
    document.getElementById('filterProduct').addEventListener('change', applySheetsFilters);
    document.getElementById('filterRalti').addEventListener('change', applySheetsFilters);
    document.getElementById('sortBy').addEventListener('change', applySheetsFilters);
    document.getElementById('sortOrder').addEventListener('change', applySheetsFilters);
    document.getElementById('btnClearFilters').addEventListener('click', clearSheetsFilters);
    document.getElementById('sheetsPerPage').addEventListener('change', function() {
        sheetsPerPage = parseInt(this.value, 10);
        void fetchSheetsPage(true);
    });
    document.getElementById('btnSheetsPrev').addEventListener('click', () => {
        if (currentSheetsPage > 1) {
            currentSheetsPage--;
            void fetchSheetsPage(false);
        }
    });
    document.getElementById('btnSheetsNext').addEventListener('click', () => {
        const totalPages = sheetsListTotal > 0 ? Math.ceil(sheetsListTotal / sheetsPerPage) : 0;
        if (currentSheetsPage < totalPages) {
            currentSheetsPage++;
            void fetchSheetsPage(false);
        }
    });

    // Modal close buttons
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            closeModal(modal.id);
        });
    });

    // Close modal when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal(this.id);
            }
        });
    });
}

/**
 * Sheets functions (scoped by current company)
 */
async function loadSheets() {
    try {
        const companyId = getCurrentCompanyId();
        if (!companyId) {
            allSheets = [];
            filteredSheets = [];
            sheetsListTotal = 0;
            const productFilter = document.getElementById('filterProduct');
            if (productFilter) productFilter.innerHTML = '<option value="">All Products</option>';
            displaySheets();
            return;
        }
        populateProductFilterFromProducts();
        await fetchSheetsPage(true);
    } catch (error) {
        console.error('Error loading sheets:', error);
        showErrorAlert('Error loading RCC records: ' + error.message);
    }
}

function applySheetsFilters() {
    void fetchSheetsPage(true);
}

function clearSheetsFilters() {
    document.getElementById('filterSearch').value = '';
    if (flatpickrFrom) flatpickrFrom.clear();
    if (flatpickrTo) flatpickrTo.clear();
    document.getElementById('filterProduct').value = '';
    document.getElementById('filterRalti').value = '';
    document.getElementById('sortBy').value = 'date';
    document.getElementById('sortOrder').value = 'DESC';
    const showBRatePdfEl = document.getElementById('filterShowBRatePdf');
    if (showBRatePdfEl) showBRatePdfEl.checked = true;
    applySheetsFilters();
}

function moveSheetFormAccordionToDefault() {
    if (!sheetFormAccordionEl || !sheetFormAccordionDefaultLocation) return;
    const parent = sheetFormAccordionDefaultLocation.parent;
    if (!parent) return;
    const nextSibling = sheetFormAccordionDefaultLocation.nextSibling;
    if (nextSibling) {
        parent.insertBefore(sheetFormAccordionEl, nextSibling);
    } else {
        parent.appendChild(sheetFormAccordionEl);
    }
}

function displaySheets() {
    destroyInlineEditFlatpickr();

    const tbody = document.getElementById('sheetsTableBody');
    tbody.innerHTML = '';

    const total = sheetsListTotal;
    const totalPages = total > 0 ? Math.ceil(total / sheetsPerPage) : 0;
    const currentPageSheets = allSheets;

    // Display current page records
    currentPageSheets.forEach((sheet, index) => {
        const serialNumber = total - ((currentSheetsPage - 1) * sheetsPerPage + index);

        if (inlineEditingSheetId === sheet.id) {
            const editRow = renderInlineEditRow(sheet, serialNumber);
            tbody.appendChild(editRow);
            wireInlineEditRow(editRow);
            calculateSheetAmounts(editRow);
            return;
        }

        const row = document.createElement('tr');
        const formattedDate = formatDateDDMMYY(sheet.date);
        const bAmount = calculateBAmount(sheet.weight, sheet.b_rate);
        row.innerHTML = `
            <td>${serialNumber}</td>
            <td>${sheet.invoice_no || ''}</td>
            <td>${sheet.product_name || ''}</td>
            <td>${sheet.weight || 0}</td>
            <td>${sheet.truck_number || ''}</td>
            <td>${sheet.ralti || 'No'}</td>
            <td>${parseFloat(sheet.rate || 0).toFixed(2)}</td>
            <td>${parseFloat(sheet.b_rate || 0).toFixed(2)}</td>
            <td>${bAmount.toFixed(2)}</td>
            <td>${parseFloat(sheet.gst || 5).toFixed(2)}%</td>
            <td>${parseFloat(sheet.amount || 0).toFixed(2)}</td>
            <td>${parseFloat(sheet.amount_with_gst || 0).toFixed(2)}</td>
            <td>${formattedDate}</td>
            <td>
                <button class="btn btn-primary btn-small" title="Edit" aria-label="Edit" onclick="editSheet(${sheet.id})">✎</button>
            </td>
        `;

        row.id = `sheetRow_${sheet.id}`;
        row.dataset.sheetId = String(sheet.id);
        tbody.appendChild(row);
    });

    if (inlineEditingSheetId && !currentPageSheets.some(s => s.id === inlineEditingSheetId)) {
        inlineEditingSheetId = null;
    }

    const startRecord = total > 0 ? (currentSheetsPage - 1) * sheetsPerPage + 1 : 0;
    const endRecord = total > 0 ? startRecord + currentPageSheets.length - 1 : 0;
    document.getElementById('sheetsPaginationInfo').textContent =
        `Showing ${startRecord} - ${endRecord} of ${total} records`;

    const prevBtn = document.getElementById('btnSheetsPrev');
    const nextBtn = document.getElementById('btnSheetsNext');
    prevBtn.disabled = currentSheetsPage === 1;
    nextBtn.disabled = currentSheetsPage >= totalPages || totalPages === 0;

    const pageNumbersDiv = document.getElementById('sheetsPageNumbers');
    pageNumbersDiv.innerHTML = '';

    if (totalPages === 0) {
        return;
    }

    let startPage = Math.max(1, currentSheetsPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);

    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    const goPage = (p) => {
        currentSheetsPage = p;
        void fetchSheetsPage(false);
    };

    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.className = 'btn btn-secondary btn-small';
        firstBtn.textContent = '1';
        firstBtn.onclick = () => goPage(1);
        pageNumbersDiv.appendChild(firstBtn);
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '0 0.3rem';
            pageNumbersDiv.appendChild(ellipsis);
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = 'btn btn-small';
        if (i === currentSheetsPage) {
            pageBtn.classList.add('btn-primary');
        } else {
            pageBtn.classList.add('btn-secondary');
        }
        pageBtn.textContent = i;
        const pi = i;
        pageBtn.onclick = () => goPage(pi);
        pageNumbersDiv.appendChild(pageBtn);
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '0 0.3rem';
            pageNumbersDiv.appendChild(ellipsis);
        }
        const lastBtn = document.createElement('button');
        lastBtn.className = 'btn btn-secondary btn-small';
        lastBtn.textContent = totalPages;
        lastBtn.onclick = () => goPage(totalPages);
        pageNumbersDiv.appendChild(lastBtn);
    }
}

/**
 * Calculate amount and amount with GST for RCC form
 */
function calculateSheetAmounts(root) {
    root = root || document.getElementById('rccSheetFormRoot');
    if (!root) return;
    const rateEl = sheetFormEl(root, 'rate');
    const weightEl = sheetFormEl(root, 'weight');
    const bRateEl = sheetFormEl(root, 'b_rate');
    const bAmountEl = sheetFormEl(root, 'b_amount');
    const gstEl = sheetFormEl(root, 'gst');
    const amtEl = sheetFormEl(root, 'amount');
    const amtGstEl = sheetFormEl(root, 'amount_with_gst');
    if (!rateEl || !weightEl || !gstEl || !amtEl || !amtGstEl) return;

    const rate = parseFloat(rateEl.value) || 0;
    const weight = parseFloat(weightEl.value) || 0;
    const bRate = bRateEl ? parseFloat(bRateEl.value) || 0 : 0;
    const gst = parseFloat(gstEl.value) || 0;

    const amount = rate * weight;
    const bAmount = calculateBAmount(weight, bRate);
    const amountWithGst = amount + (amount * gst / 100);

    if (bAmountEl) bAmountEl.value = bAmount.toFixed(2);
    amtEl.value = amount.toFixed(2);
    amtGstEl.value = amountWithGst.toFixed(2);
}

function openSheetForm() {
    const root = document.getElementById('rccSheetFormRoot');
    if (!root) return;

    const saveBtn = document.getElementById('btnSaveSheetForm');
    if (saveBtn) saveBtn.textContent = 'Save';

    const titleEl = document.getElementById('sheetFormTitle');
    if (titleEl) titleEl.textContent = 'Add RCC Record';

    const productSelect = sheetFormEl(root, 'product_id');
    if (!productSelect) return;
    productSelect.innerHTML = '<option value="">-- Select Product --</option>';
    products.forEach(product => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = product.name;
        productSelect.appendChild(option);
    });

    productSelect.onchange = function() {
        const selectedId = parseInt(this.value, 10);
        const product = products.find(p => p.id === selectedId);
        const rateInput = sheetFormEl(root, 'rate');
        if (product && rateInput) {
            rateInput.value = parseFloat(product.rate || 0);
            calculateSheetAmounts(root);
        }
    };

    wireRootFormCalculations(root);

    const invEl = sheetFormEl(root, 'invoice_no');
    if (invEl) {
        invEl.value = '';
        delete invEl.dataset.sheetId;
    }

    const now = new Date();
    const dateEl = sheetFormEl(root, 'date');
    if (sheetFormDatePicker && dateEl) sheetFormDatePicker.setDate(now, false);
    else if (dateEl) dateEl.value = formatDateDDMMYYYY(now);

    sheetFormEl(root, 'product_id').value = '';
    sheetFormEl(root, 'weight').value = '0';
    sheetFormEl(root, 'truck_number').value = '';
    sheetFormEl(root, 'ralti').value = 'No';
    sheetFormEl(root, 'rate').value = '0';
    sheetFormEl(root, 'b_rate').value = '0';
    if (sheetFormEl(root, 'b_amount')) sheetFormEl(root, 'b_amount').value = '0';
    sheetFormEl(root, 'gst').value = '5';
    sheetFormEl(root, 'amount').value = '0';
    sheetFormEl(root, 'amount_with_gst').value = '0';

    calculateSheetAmounts(root);
}

async function validateAndSaveRccFromRoot(root) {
    try {
        const invEl = sheetFormEl(root, 'invoice_no');
        const dateEl = sheetFormEl(root, 'date');
        const prodEl = sheetFormEl(root, 'product_id');
        if (!invEl || !dateEl || !prodEl) return;

        const sheetIdRaw = invEl.dataset.sheetId ? String(invEl.dataset.sheetId) : '';
        const sheetIdNum = sheetIdRaw ? parseInt(sheetIdRaw, 10) : null;

        const dateValue = dateEl.value.trim();
        const dateObj = parseDDMMYYYY(dateValue);
        if (!dateObj) {
            await showWarningAlert('Please enter a valid date (DD-MM-YYYY)', dateEl.id || 'sheetFormDate');
            return;
        }

        calculateSheetAmounts(root);

        const companyId = getCurrentCompanyId();
        if (!companyId) {
            showErrorAlert('Please select a company on the main Invoice page first.');
            return;
        }

        const sheet = {
            id: sheetIdNum,
            invoice_no: invEl.value.trim(),
            company_id: companyId,
            product_id: parseInt(prodEl.value, 10),
            weight: parseFloat(sheetFormEl(root, 'weight').value) || 0,
            truck_number: sheetFormEl(root, 'truck_number').value.trim(),
            ralti: sheetFormEl(root, 'ralti').value,
            rate: parseFloat(sheetFormEl(root, 'rate').value) || 0,
            b_rate: parseFloat(sheetFormEl(root, 'b_rate').value) || 0,
            gst: parseFloat(sheetFormEl(root, 'gst').value) || 5,
            amount: parseFloat(sheetFormEl(root, 'amount').value) || 0,
            amount_with_gst: parseFloat(sheetFormEl(root, 'amount_with_gst').value) || 0,
            date: new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).toISOString()
        };

        if (!sheet.invoice_no) {
            await showWarningAlert('Please enter invoice number', invEl.id || 'sheetFormInvoiceNo', true);
            return;
        }

        if (!sheet.product_id) {
            await showWarningAlert('Please select a product', prodEl.id || 'sheetFormProduct');
            return;
        }

        if (!sheet.date) {
            await showWarningAlert('Please select a date', dateEl.id || 'sheetFormDate');
            return;
        }

        try {
            if (typeof window.beginAppLoading === 'function') window.beginAppLoading();

        let originalInvoiceNo = null;
        if (sheetIdRaw) {
            const originalSheet = await window.electronAPI.getSheet(sheetIdNum);
            if (originalSheet) {
                originalInvoiceNo = originalSheet.invoice_no;
            }
        }

        if (!sheetIdRaw || sheet.invoice_no !== originalInvoiceNo) {
            const existingSheet = await window.electronAPI.getSheetByInvoiceNo(sheet.invoice_no, sheetIdRaw || null, companyId);
            if (existingSheet) {
                await showErrorAlert('Error: Invoice number already exists. Invoice numbers must be unique.', invEl.id || 'sheetFormInvoiceNo', true);
                return;
            }
        }

        await window.electronAPI.saveSheet(sheet);
        showSuccessToast('RCC Record saved successfully!');
        inlineEditingSheetId = null;
        destroyInlineEditFlatpickr();

        const isMainAddForm = root.id === 'rccSheetFormRoot';
        const wasNewRecord = !sheetIdRaw;

        if (!(isMainAddForm && wasNewRecord)) {
            if (sheetFormAccordionEl) {
                sheetFormAccordionEl.style.display = 'none';
                moveSheetFormAccordionToDefault();
            }
            document.getElementById('filterProduct').innerHTML = '<option value="">All Products</option>';
            document.getElementById('filterRalti').value = '';
        }

        await loadSheets();

        if (isMainAddForm && wasNewRecord) {
            if (sheetFormAccordionEl) {
                sheetFormAccordionEl.style.display = 'table-row';
            }
            openSheetForm();
        }
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Error saving sheet:', error);
        const errorMessage = error.message || 'Unknown error occurred';
        const invEl = sheetFormEl(root, 'invoice_no');
        if (errorMessage.includes('UNIQUE constraint') || errorMessage.includes('unique')) {
            showErrorAlert('Error: Invoice number already exists. Invoice numbers must be unique.', invEl ? invEl.id : 'sheetFormInvoiceNo', true);
        } else {
            showErrorAlert('Error saving RCC record: ' + errorMessage);
        }
    }
}

async function saveSheetForm() {
    const root = document.getElementById('rccSheetFormRoot');
    if (!root) return;
    await validateAndSaveRccFromRoot(root);
}

async function editSheet(id) {
    if (sheetFormAccordionEl && sheetFormAccordionEl.style.display !== 'none' && sheetFormAccordionEl.style.display !== '') {
        sheetFormAccordionEl.style.display = 'none';
        moveSheetFormAccordionToDefault();
    }
    inlineEditingSheetId = id;
    displaySheets();
    const row = document.getElementById(`sheetRow_${id}`);
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Download RCC Records as PDF
 */
async function downloadSheetsPDF() {
    try {
        const companyId = getCurrentCompanyId();
        if (!companyId) {
            await showWarningAlert('Please select a company on the main Invoice page first.');
            return;
        }

        const raw = await window.electronAPI.getSheets(companyId, buildSheetsListOptions({ fetch_all: true }));
        const norm = normalizeSheetsResponse(raw);
        const rowsForPdf = norm.data;

        if (!rowsForPdf || rowsForPdf.length === 0) {
            await showWarningAlert('No RCC records to download');
            return;
        }

        const filteredCount = rowsForPdf.length;
        let message = `Download ${filteredCount} filtered RCC record${filteredCount !== 1 ? 's' : ''}?`;
        if (filteredCount < norm.meta.total) {
            message += `\n\n(Filtered from ${norm.meta.total} total records)`;
        }

        const result = await Swal.fire({
            title: 'Download PDF',
            text: message,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#28a745',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Download',
            cancelButtonText: 'Cancel'
        });

        if (!result.isConfirmed) {
            return;
        }

        if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
        try {
        const companySettings = await window.electronAPI.getCompanySettings(companyId);
        if (!companySettings) {
            await showWarningAlert('Please configure company settings first');
            return;
        }

        const showBRatePdfEl = document.getElementById('filterShowBRatePdf');
        const includeBRate = !!(showBRatePdfEl ? showBRatePdfEl.checked : true);

        // Generate PDF HTML using filtered records
        const printHTML = generateSheetsHTML(companySettings, rowsForPdf, { includeBRate });

        // Verify content is there
        if (!printHTML || printHTML.trim() === '') {
            await showErrorAlert('Error: Print content is empty. Please try again.');
            return;
        }
        
        await window.electronAPI.downloadPDF(printHTML);
        } catch (error) {
            showErrorAlert('Error downloading PDF: ' + error.message);
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Error downloading RCC records PDF:', error);
        showErrorAlert('Error downloading PDF: ' + error.message);
    }
}

/**
 * Generate RCC Records HTML for PDF
 */
function generateSheetsHTML(company, sheets, options = {}) {
    try {
        const includeBRate = options.includeBRate !== false;
        const totalCols = includeBRate ? 13 : 11;
        const gstLabelColSpan = totalCols - 5;

        const formattedDate = formatDateDDMMYY(new Date());

        // Calculate totals
        let totalWeight = 0;
        let totalBAmount = 0;
        let totalAmount = 0;
        let totalAmountWithGst = 0;
        sheets.forEach(sheet => {
            totalWeight += parseFloat(sheet.weight || 0);
            totalBAmount += calculateBAmount(sheet.weight, sheet.b_rate);
            totalAmount += parseFloat(sheet.amount || 0);
            totalAmountWithGst += parseFloat(sheet.amount_with_gst || 0);
        });

        return `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <title>RCC Records Report</title>
    
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
    
    .no-border {
      border: none;
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
        <td colspan="${totalCols}" class="center bold big">RCC RECORDS REPORT</td>
      </tr>
      <tr>
        <td colspan="${totalCols}" class="center bold medium">${company.company_name || ''}</td>
      </tr>
      <tr>
        <td colspan="5">GSTIN: ${company.gstin || ''}</td>
        <td colspan="${gstLabelColSpan}" class="right">Date: ${formattedDate}</td>
      </tr>
      <tr>
        <td colspan="${totalCols}" class="center">${company.address || ''}</td>
      </tr>
    
      <!-- TABLE HEADER -->
      <tr class="center bold">
        <td>S.No</td>
        <td>Invoice No</td>
        <td>Product</td>
        <td>Weight</td>
        <td>Truck Number</td>
        <td>Ralti</td>
        <td>Rate</td>
        ${includeBRate ? '<td>B Rate</td>' : ''}
        ${includeBRate ? '<td>B Amount</td>' : ''}
        <td>GST</td>
        <td>Amount</td>
        <td>Amount with GST</td>
        <td>Date</td>
      </tr>
    
      <!-- RECORDS -->
      ${sheets.map((sheet, index) => {
        const formattedDate = formatDateDDMMYY(sheet.date);
        const bAmount = calculateBAmount(sheet.weight, sheet.b_rate);
        return `
      <tr class="center">
        <td>${index + 1}</td>
        <td>${sheet.invoice_no || ''}</td>
        <td>${sheet.product_name || ''}</td>
        <td>${sheet.weight || 0}</td>
        <td>${sheet.truck_number || ''}</td>
        <td>${sheet.ralti || 'No'}</td>
        <td class="right">${parseFloat(sheet.rate || 0).toFixed(2)}</td>
        ${includeBRate ? `<td class="right">${parseFloat(sheet.b_rate || 0).toFixed(2)}</td>` : ''}
        ${includeBRate ? `<td class="right">${bAmount.toFixed(2)}</td>` : ''}
        <td>${parseFloat(sheet.gst || 5).toFixed(2)}%</td>
        <td class="right">${parseFloat(sheet.amount || 0).toFixed(2)}</td>
        <td class="right">${parseFloat(sheet.amount_with_gst || 0).toFixed(2)}</td>
        <td>${formattedDate}</td>
      </tr>
      `;
      }).join('')}
    
      <!-- TOTALS -->
      <tr class="bold">
        <td colspan="3" class="right">TOTAL:</td>
        <td class="right">${totalWeight.toFixed(2)}</td>
        <td colspan="2" class="right">TOTAL:</td> 
        <td class="right"></td>
        ${includeBRate ? '<td class="right"></td>' : ''}
        ${includeBRate ? `<td class="right">${totalBAmount.toFixed(2)}</td>` : ''}
        <td></td>
        <td class="right">${totalAmount.toFixed(2)}</td>
        <td class="right">${totalAmountWithGst.toFixed(2)}</td>
        <td></td>
      </tr>
    
      <!-- FOOTER -->
      <tr>
        <td colspan="${totalCols}" style="height:60px;">
            <strong>Total Weight:</strong> ${totalWeight.toFixed(2)}<br>
            ${includeBRate ? `<strong>Total B Amount:</strong> ${totalBAmount.toFixed(2)}<br>` : ''}
            <strong>Total Amount:</strong> ${totalAmount.toFixed(2)}<br>
            <strong>Total Amount with GST:</strong> ${totalAmountWithGst.toFixed(2)}
        </td>
      </tr>
    
    </table>
    
    </body>
    </html>
    `;
        
    } catch (error) {
        console.error('Error generating RCC records HTML:', error);
        showErrorAlert('Error generating RCC records HTML: ' + error.message);
        return '';
    }
}

/**
 * SweetAlert helper functions
 */
const sheetsToast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    didOpen: (el) => {
        el.addEventListener('mouseenter', Swal.stopTimer);
        el.addEventListener('mouseleave', Swal.resumeTimer);
    }
});

function showSuccessToast(message) {
    return sheetsToast.fire({
        icon: 'success',
        title: `Success: ${message}`
    });
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

function showInfoAlert(message) {
    return showAlert('Info', message, 'info');
}

/**
 * Helper function to restore focus after alert
 */
function restoreFocusAfterAlert(elementId, selectText = false) {
    setTimeout(() => {
        // First, ensure window has focus
        if (window.focus) {
            window.focus();
        }
        
        // Then focus the element
        const element = document.getElementById(elementId);
        if (element) {
            // Remove readonly if it was set
            if (element.readOnly) {
                element.readOnly = false;
            }
            // Remove disabled if it was set
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
 * Modal functions
 */
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('show');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('show');
}

// Make functions available globally for onclick handlers
window.editSheet = editSheet;
window.cancelInlineRcc = cancelInlineRcc;

