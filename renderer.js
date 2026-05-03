// Global variables
let currentCompanyId = null; // multi-company: selected company
let currentInvoice = null;
let customers = [];
let products = [];
let invoiceItems = [];
let itemSerialNumber = 1;
// Pagination variables
let allCustomers = [];
let currentCustomersPage = 1;
let customersPerPage = 25;
let allProducts = [];
let currentProductsPage = 1;
let productsPerPage = 25;
let allInvoices = [];
let currentInvoicesPage = 1;
let invoicesPerPage = 25;
let invoicesListTotal = 0;
let invoicesListSums = { total_value: 0, total_amount: 0 };
let appBootstrapped = false;
let authLocked = false;
let autoDataRefreshInterval = null;
let lastCompaniesVersion = null;
let lastCompanyDataVersion = null;

/**
 * Display invoice number (strip company prefix e.g. "1-01" -> "01")
 */
function displayInvoiceNumber(invoiceNumber) {
    if (!invoiceNumber) return '';
    const dash = String(invoiceNumber).indexOf('-');
    return dash >= 0 ? String(invoiceNumber).substring(dash + 1) : String(invoiceNumber);
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
 * Format date as DD-MM-YYYY
 */
function formatDateDDMMYYYY(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
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

/**
 * Calendar date as YYYYMMDD (local) for comparing invoice_date values.
 */
function invoiceLocalYyyymmdd(isoOrDate) {
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function normalizeInvoicesListResponse(res) {
    if (Array.isArray(res)) {
        let totalValue = 0;
        let totalAmount = 0;
        for (const inv of res) {
            totalValue += parseFloat(inv.total_value || 0);
            totalAmount += parseFloat(inv.total_amount || 0);
        }
        const n = res.length;
        return {
            data: res,
            meta: { total: n, current_page: 1, per_page: Math.max(1, n || 1), last_page: n ? 1 : 0 },
            sums: { total_value: totalValue, total_amount: totalAmount },
        };
    }
    const data = Array.isArray(res?.data) ? res.data : [];
    const meta = res?.meta || { total: data.length, current_page: 1, per_page: 25, last_page: 0 };
    const sums = res?.sums || { total_value: 0, total_amount: 0 };
    return { data, meta, sums };
}

/** Invoice list modal date filter as YYYY-MM-DD for API / local DB. */
function getInvoiceFilterDatesForApi() {
    const fromEl = document.getElementById('invoiceFilterDateFrom');
    const toEl = document.getElementById('invoiceFilterDateTo');
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
    return out;
}

async function fetchInvoicesList(resetPage = true) {
    if (!currentCompanyId) {
        allInvoices = [];
        invoicesListTotal = 0;
        invoicesListSums = { total_value: 0, total_amount: 0 };
        displayInvoices();
        return;
    }
    if (resetPage) {
        currentInvoicesPage = 1;
    }
    const dateOpts = getInvoiceFilterDatesForApi();
    const raw = await window.electronAPI.getInvoices(currentCompanyId, {
        fetch_all: false,
        page: currentInvoicesPage,
        per_page: invoicesPerPage,
        ...dateOpts,
    });
    const norm = normalizeInvoicesListResponse(raw);
    const totalPages = norm.meta.total > 0 ? Math.ceil(norm.meta.total / invoicesPerPage) : 0;
    if (norm.meta.total > 0 && currentInvoicesPage > totalPages) {
        currentInvoicesPage = totalPages;
        return fetchInvoicesList(false);
    }
    allInvoices = norm.data;
    invoicesListTotal = norm.meta.total;
    invoicesListSums = norm.sums;
    displayInvoices();
}

let invoiceDatePicker = null;
let invoiceFilterDateFromPicker = null;
let invoiceFilterDateToPicker = null;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    try {
        initInvoiceDatePicker();
        initInvoiceListDateFilters();
        setupEventListeners();
        if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
        try {
            await ensureAuthenticatedAndStart();
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Error initializing app:', error);
        showErrorAlert('Error initializing application: ' + error.message);
    }
});

/**
 * Initialize date picker for Invoice Date (DD-MM-YYYY)
 */
function initInvoiceDatePicker() {
    if (typeof flatpickr === 'undefined') return;
    const el = document.getElementById('invoiceDate');
    if (!el) return;
    invoiceDatePicker = flatpickr('#invoiceDate', {
        dateFormat: 'd-m-Y',
        allowInput: true,
        onChange: () => {
            refreshSuggestedInvoiceNumberForNewInvoice();
        }
    });
}

/**
 * When creating a new invoice, suggested invoice # follows the financial year of the invoice date (March–February).
 */
async function refreshSuggestedInvoiceNumberForNewInvoice() {
    if (!currentCompanyId || currentInvoice) return;
    const d = parseDDMMYYYY(document.getElementById('invoiceDate').value.trim());
    if (!d) return;
    const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    try {
        const nextNum = await window.electronAPI.getNextInvoiceNumber(currentCompanyId, iso);
        document.getElementById('invoiceNumber').value = nextNum;
    } catch (e) {
        console.error('Error updating suggested invoice number:', e);
    }
}

/**
 * Invoice list modal: same Flatpickr as main invoice date (DD-MM-YYYY).
 * To date cannot be before From; calendar and minDate enforce it.
 */
function initInvoiceListDateFilters() {
    if (typeof flatpickr === 'undefined') return;
    const fromEl = document.getElementById('invoiceFilterDateFrom');
    const toEl = document.getElementById('invoiceFilterDateTo');
    if (!fromEl || !toEl) return;

    const refreshFilter = () => {
        void fetchInvoicesList(true).catch((err) => console.error('Invoice list filter:', err));
    };

    /** Resolve current From as a Date (picker selection or typed DD-MM-YYYY). */
    function resolveFromDate() {
        if (invoiceFilterDateFromPicker && invoiceFilterDateFromPicker.selectedDates.length) {
            return invoiceFilterDateFromPicker.selectedDates[0];
        }
        const v = fromEl.value.trim();
        return v ? parseDDMMYYYY(v) : null;
    }

    function applyToPickerMinFromFrom() {
        if (!invoiceFilterDateToPicker) return;
        const fromDate = resolveFromDate();
        if (fromDate) {
            invoiceFilterDateToPicker.set('minDate', fromDate);
            const toSel = invoiceFilterDateToPicker.selectedDates[0];
            if (toSel && invoiceLocalYyyymmdd(toSel) < invoiceLocalYyyymmdd(fromDate)) {
                invoiceFilterDateToPicker.setDate(fromDate, false);
            }
        } else {
            invoiceFilterDateToPicker.set('minDate', null);
        }
    }

    invoiceFilterDateFromPicker = flatpickr(fromEl, {
        dateFormat: 'd-m-Y',
        allowInput: true,
        onChange: () => {
            applyToPickerMinFromFrom();
            refreshFilter();
        }
    });

    invoiceFilterDateToPicker = flatpickr(toEl, {
        dateFormat: 'd-m-Y',
        allowInput: true,
        onChange: refreshFilter
    });

    fromEl.addEventListener('blur', () => {
        applyToPickerMinFromFrom();
        refreshFilter();
    });
    toEl.addEventListener('blur', () => {
        const fromD = resolveFromDate();
        if (fromD && invoiceFilterDateToPicker) {
            let toD = invoiceFilterDateToPicker.selectedDates[0];
            if (!toD && toEl.value.trim()) toD = parseDDMMYYYY(toEl.value.trim());
            if (toD && invoiceLocalYyyymmdd(toD) < invoiceLocalYyyymmdd(fromD)) {
                invoiceFilterDateToPicker.setDate(fromD, false);
            }
        }
        refreshFilter();
    });
}

/**
 * Initialize the application (load companies, set current company)
 */
async function initializeApp() {
    const now = new Date();
    if (invoiceDatePicker) invoiceDatePicker.setDate(now, false);
    else document.getElementById('invoiceDate').value = formatDateDDMMYYYY(now);

    const companies = await window.electronAPI.getCompanies();
    applyCompaniesToHeader(companies);
    lastCompaniesVersion = await window.electronAPI.getCompaniesVersion();
    if (currentCompanyId) {
        lastCompanyDataVersion = await window.electronAPI.getCompanyDataVersion(currentCompanyId);
    } else {
        lastCompanyDataVersion = null;
    }
}

function applyCompaniesToHeader(companies) {
    const companySelect = document.getElementById('companySelect');
    companySelect.innerHTML = '<option value="">-- Select Company --</option>';
    companies.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.company_name || 'Company ' + c.id;
        companySelect.appendChild(opt);
    });

    const savedId = localStorage.getItem('currentCompanyId');
    if (savedId && companies.some(c => String(c.id) === savedId)) {
        currentCompanyId = parseInt(savedId);
        companySelect.value = currentCompanyId;
    } else if (companies.length > 0) {
        currentCompanyId = companies[0].id;
        companySelect.value = currentCompanyId;
        localStorage.setItem('currentCompanyId', String(currentCompanyId));
    } else {
        currentCompanyId = null;
    }
}

/**
 * Load customers, products, invoices, and invoice number for the current company
 */
async function loadDataForCurrentCompany() {
    if (!currentCompanyId) {
        customers = [];
        products = [];
        allInvoices = [];
        invoicesListTotal = 0;
        invoicesListSums = { total_value: 0, total_amount: 0 };
        populateCustomerSelect();
        document.getElementById('invoiceNumber').value = '';
        return;
    }
    try {
        const invoicesModalOpen = document.getElementById('invoicesModal')?.classList.contains('show');
        const [custData, prodData] = await Promise.all([
            window.electronAPI.getCustomers(currentCompanyId),
            window.electronAPI.getProducts(currentCompanyId),
        ]);
        customers = Array.isArray(custData) ? custData : [];
        products = Array.isArray(prodData) ? prodData : [];
        if (invoicesModalOpen) {
            await fetchInvoicesList(true);
        }
        populateCustomerSelect();
        const d = parseDDMMYYYY(document.getElementById('invoiceDate').value.trim()) || new Date();
        const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
        const nextNum = await window.electronAPI.getNextInvoiceNumber(currentCompanyId, iso);
        document.getElementById('invoiceNumber').value = nextNum;
        currentCustomersPage = 1;
        currentProductsPage = 1;
        if (document.getElementById('customersModal').classList.contains('show')) displayCustomers();
        if (document.getElementById('productsModal').classList.contains('show')) displayProducts();
    } catch (error) {
        console.error('Error loading company data:', error);
        customers = [];
        products = [];
        allInvoices = [];
        invoicesListTotal = 0;
        invoicesListSums = { total_value: 0, total_amount: 0 };
        populateCustomerSelect();
    }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Company switcher
    document.getElementById('companySelect').addEventListener('change', async function() {
        const val = this.value;
        currentCompanyId = val ? parseInt(val) : null;
        if (currentCompanyId) localStorage.setItem('currentCompanyId', String(currentCompanyId));
        if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
        try {
            await loadDataForCurrentCompany();
            await initializeNewInvoice();
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    });

    // Header buttons
    document.getElementById('btnSettings').addEventListener('click', () => openModal('settingsModal'));
    document.getElementById('btnCustomers').addEventListener('click', () => openModal('customersModal'));
    document.getElementById('btnProducts').addEventListener('click', () => openModal('productsModal'));
    document.getElementById('btnInvoices').addEventListener('click', () => openModal('invoicesModal'));
    document.getElementById('btnDownloadAllInvoicesPDF').addEventListener('click', () => downloadAllInvoicesPDF());
    document.getElementById('btnSheets').addEventListener('click', () => {
        window.location.href = 'sheets.html';
    });
    document.getElementById('btnClientPaymentsMenu').addEventListener('click', () => {
        window.location.href = 'client-payments.html';
    });
    document.getElementById('btnChangePasswordScreen').addEventListener('click', () => openModal('changePasswordModal'));
    document.getElementById('btnMigrateLocalScreen').addEventListener('click', () => openModal('migrateLocalModal'));
    document.getElementById('btnUserLogout').addEventListener('click', logoutToLoginPage);

    // Customer selection
    document.getElementById('customerSelect').addEventListener('change', handleCustomerSelect);
    document.getElementById('btnAddCustomer').addEventListener('click', () => openCustomerForm());

    // Invoice items
    document.getElementById('btnAddItem').addEventListener('click', addInvoiceItem);

    // Tax calculations
    document.getElementById('sgstRate').addEventListener('input', calculateTotals);
    document.getElementById('cgstRate').addEventListener('input', calculateTotals);

    // Invoice actions (save happens automatically on download)
    document.getElementById('btnPrintInvoice').addEventListener('click', printInvoice);
    document.getElementById('btnUpdateInvoice').addEventListener('click', async () => {
        const saved = await saveInvoice(true);
        if (saved) {
            await initializeNewInvoice();
        }
    });
    document.getElementById('btnDownloadPDF').addEventListener('click', downloadPDF);
    document.getElementById('btnNewInvoice').addEventListener('click', () => initializeNewInvoice());
    
    // Handle print dialog close
    window.addEventListener('beforeprint', () => {
        // Ensure print section is visible before print
        const printSection = document.getElementById('printSection');
        if (printSection) {
            printSection.style.display = 'block';
        }
    });

    // Settings
    document.getElementById('btnChooseDatabaseLocation').addEventListener('click', chooseDatabaseLocation);
    document.getElementById('btnManageCompanies').addEventListener('click', () => openModal('companiesModal'));
    document.getElementById('btnAddNewCompany').addEventListener('click', () => openCompanyForm(null));
    document.getElementById('btnSaveCompanyForm').addEventListener('click', saveCompanyForm);
    document.getElementById('btnCancelCompanyForm').addEventListener('click', () => closeModal('companyFormModal'));
    document.getElementById('btnResetInvoiceNumberSettings').addEventListener('click', resetInvoiceNumber);
    document.getElementById('btnSetInvoiceNumberSettings').addEventListener('click', setInvoiceNumberFromSettings);
    document.getElementById('btnLoginPageSubmit').addEventListener('click', loginFromLoginPage);
    document.getElementById('btnSubmitChangePassword').addEventListener('click', submitChangePassword);
    document.getElementById('btnCancelChangePassword').addEventListener('click', () => closeModal('changePasswordModal'));
    document.getElementById('btnDownloadMigrateQuery').addEventListener('click', downloadLocalMysqlQuery);
    document.getElementById('btnCancelMigrateLocal').addEventListener('click', () => closeModal('migrateLocalModal'));

    // Customers
    document.getElementById('btnAddNewCustomer').addEventListener('click', () => openCustomerForm());
    document.getElementById('btnSaveCustomerForm').addEventListener('click', saveCustomerForm);
    document.getElementById('btnCancelCustomerForm').addEventListener('click', () => closeModal('customerFormModal'));

    // Products
    document.getElementById('btnAddNewProduct').addEventListener('click', () => openProductForm());
    document.getElementById('btnSaveProductForm').addEventListener('click', saveProductForm);
    document.getElementById('btnCancelProductForm').addEventListener('click', () => closeModal('productFormModal'));


    // Customers pagination
    document.getElementById('customersPerPage').addEventListener('change', function() {
        customersPerPage = parseInt(this.value);
        currentCustomersPage = 1;
        displayCustomers();
    });
    document.getElementById('btnCustomersPrev').addEventListener('click', () => {
        if (currentCustomersPage > 1) {
            currentCustomersPage--;
            displayCustomers();
        }
    });
    document.getElementById('btnCustomersNext').addEventListener('click', () => {
        const totalPages = Math.ceil(allCustomers.length / customersPerPage);
        if (currentCustomersPage < totalPages) {
            currentCustomersPage++;
            displayCustomers();
        }
    });

    // Products pagination
    document.getElementById('productsPerPage').addEventListener('change', function() {
        productsPerPage = parseInt(this.value);
        currentProductsPage = 1;
        displayProducts();
    });
    document.getElementById('btnProductsPrev').addEventListener('click', () => {
        if (currentProductsPage > 1) {
            currentProductsPage--;
            displayProducts();
        }
    });
    document.getElementById('btnProductsNext').addEventListener('click', () => {
        const totalPages = Math.ceil(allProducts.length / productsPerPage);
        if (currentProductsPage < totalPages) {
            currentProductsPage++;
            displayProducts();
        }
    });

    // Invoices pagination
    document.getElementById('invoicesPerPage').addEventListener('change', function() {
        invoicesPerPage = parseInt(this.value);
        void fetchInvoicesList(true).catch((err) => console.error('Invoices per page:', err));
    });
    document.getElementById('btnInvoicesPrev').addEventListener('click', () => {
        if (currentInvoicesPage > 1) {
            currentInvoicesPage--;
            void fetchInvoicesList(false).catch((err) => console.error('Invoices prev page:', err));
        }
    });
    document.getElementById('btnInvoicesNext').addEventListener('click', () => {
        const totalPages = invoicesListTotal > 0 ? Math.ceil(invoicesListTotal / invoicesPerPage) : 0;
        if (currentInvoicesPage < totalPages) {
            currentInvoicesPage++;
            void fetchInvoicesList(false).catch((err) => console.error('Invoices next page:', err));
        }
    });

    const btnInvoiceFilterClear = document.getElementById('btnInvoiceFilterClear');
    if (btnInvoiceFilterClear) {
        btnInvoiceFilterClear.addEventListener('click', () => {
            if (invoiceFilterDateFromPicker) invoiceFilterDateFromPicker.clear();
            else {
                const a = document.getElementById('invoiceFilterDateFrom');
                if (a) a.value = '';
            }
            if (invoiceFilterDateToPicker) invoiceFilterDateToPicker.clear();
            else {
                const b = document.getElementById('invoiceFilterDateTo');
                if (b) b.value = '';
            }
            if (invoiceFilterDateToPicker) invoiceFilterDateToPicker.set('minDate', null);
            void fetchInvoicesList(true).catch((err) => console.error('Invoice filter clear:', err));
        });
    }

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

async function submitChangePassword() {
    const currentPassword = document.getElementById('cpCurrentPassword')?.value || '';
    const newPassword = document.getElementById('cpNewPassword')?.value || '';
    const confirmPassword = document.getElementById('cpConfirmPassword')?.value || '';
    if (!currentPassword || !newPassword || !confirmPassword) {
        await showWarningAlert('Please fill all password fields.');
        return;
    }
    if (newPassword !== confirmPassword) {
        await showWarningAlert('New password and confirm password do not match.', 'cpConfirmPassword', true);
        return;
    }
    try {
        try {
            if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
            await window.electronAPI.apiChangePassword(currentPassword, newPassword, confirmPassword);
            document.getElementById('cpCurrentPassword').value = '';
            document.getElementById('cpNewPassword').value = '';
            document.getElementById('cpConfirmPassword').value = '';
            closeModal('changePasswordModal');
            showSuccessToast('Password updated successfully.');
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Change password failed:', error);
        showErrorAlert('Change password failed: ' + error.message);
    }
}

async function downloadLocalMysqlQuery() {
    try {
        const res = await window.electronAPI.downloadLocalMysqlQuery();
        if (res?.canceled) return;
        if (!res?.ok) {
            await showWarningAlert('Could not generate SQL file.');
            return;
        }
        await showSuccessAlert(`SQL file saved:\n${res.path}`);
    } catch (error) {
        console.error('Download SQL failed:', error);
        await showErrorAlert('Download SQL failed: ' + error.message);
    }
}

async function ensureAuthenticatedAndStart() {
    const status = await window.electronAPI.apiGetStatus();
    if (!status?.hasToken) {
        showLoginGate();
        return;
    }
    hideLoginGate();
    await bootstrapAppIfNeeded();
}

function showLoginGate() {
    authLocked = true;
    const loginPage = document.getElementById('loginPage');
    const appShell = document.getElementById('appShell');
    const passwordInput = document.getElementById('loginPassword');
    const statusEl = document.getElementById('loginPageStatus');
    if (loginPage) loginPage.style.display = 'flex';
    if (appShell) appShell.style.display = 'none';
    if (passwordInput) passwordInput.value = '';
    if (statusEl) {
        statusEl.style.color = '#666';
        statusEl.textContent = 'Please login to access the application.';
    }
}

function hideLoginGate() {
    authLocked = false;
    const loginPage = document.getElementById('loginPage');
    const appShell = document.getElementById('appShell');
    if (loginPage) loginPage.style.display = 'none';
    if (appShell) appShell.style.display = '';
}

async function bootstrapAppIfNeeded() {
    if (appBootstrapped) return;
    if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
    try {
        await initializeApp();
        await loadDataForCurrentCompany();
        await initializeNewInvoice();
        startAutoDataRefresh();
        appBootstrapped = true;
    } finally {
        if (typeof window.endAppLoading === 'function') window.endAppLoading();
    }
}

function startAutoDataRefresh() {
    if (autoDataRefreshInterval) clearInterval(autoDataRefreshInterval);
    autoDataRefreshInterval = setInterval(async () => {
        if (authLocked || !appBootstrapped) return;
        try {
            const companiesVersion = await window.electronAPI.getCompaniesVersion();
            if (companiesVersion !== lastCompaniesVersion) {
                lastCompaniesVersion = companiesVersion;
                const companies = await window.electronAPI.getCompanies();
                const previousCompanyId = currentCompanyId;
                applyCompaniesToHeader(companies);
                const hasCompanyChanged = previousCompanyId !== currentCompanyId;
                await loadDataForCurrentCompany();
                if (hasCompanyChanged) {
                    await initializeNewInvoice();
                }
                lastCompanyDataVersion = currentCompanyId
                    ? await window.electronAPI.getCompanyDataVersion(currentCompanyId)
                    : null;
                return;
            }

            if (!currentCompanyId) return;
            const companyDataVersion = await window.electronAPI.getCompanyDataVersion(currentCompanyId);
            if (companyDataVersion !== lastCompanyDataVersion) {
                lastCompanyDataVersion = companyDataVersion;
                await loadDataForCurrentCompany();
            }
        } catch (error) {
            console.error('Auto refresh failed:', error);
        }
    }, 15000);
}

async function loginFromLoginPage() {
    const emailEl = document.getElementById('loginEmail');
    const passwordEl = document.getElementById('loginPassword');
    const statusEl = document.getElementById('loginPageStatus');
    const email = (emailEl?.value || '').trim();
    const password = passwordEl?.value || '';

    if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
    try {
        const apiStatus = await window.electronAPI.apiGetStatus();
        if (!apiStatus?.baseUrl) {
            if (statusEl) {
                statusEl.style.color = '#b71c1c';
                statusEl.textContent = 'API URL not configured. Set API_BASE_URL or APP_URL in root .env.';
            }
            return;
        }
        if (!email || !password) {
            if (statusEl) {
                statusEl.style.color = '#b71c1c';
                statusEl.textContent = 'Enter email and password.';
            }
            return;
        }

        try {
            await window.electronAPI.apiLogin(email, password);
            if (statusEl) {
                statusEl.style.color = '#1b5e20';
                statusEl.textContent = 'Login successful. Loading application...';
            }
            hideLoginGate();
            await bootstrapAppIfNeeded();
        } catch (error) {
            if (statusEl) {
                statusEl.style.color = '#b71c1c';
                statusEl.textContent = `Login failed: ${error.message}`;
            }
        }
    } finally {
        if (typeof window.endAppLoading === 'function') window.endAppLoading();
    }
}

async function logoutToLoginPage() {
    try {
        await window.electronAPI.apiLogout();
    } catch (error) {
        console.error('API logout failed:', error);
    } finally {
        showLoginGate();
    }
}

/**
 * Load initial data (customers, products, company settings)
 */
// loadInitialData replaced by loadDataForCurrentCompany (multi-company)

/**
 * Initialize a new invoice
 */
async function initializeNewInvoice() {
    try {
        if (!currentCompanyId) {
            document.getElementById('invoiceNumber').value = '';
            return;
        }
        const d = parseDDMMYYYY(document.getElementById('invoiceDate').value.trim()) || new Date();
        const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
        const invoiceNumber = await window.electronAPI.getNextInvoiceNumber(currentCompanyId, iso);
        document.getElementById('invoiceNumber').value = invoiceNumber;

        // Reset form
        document.getElementById('tpNumber').value = '';
        document.getElementById('vehicleNumber').value = '';
        document.getElementById('customerSelect').value = '';
        document.getElementById('customerDetails').style.display = 'none';

        // Clear items
        invoiceItems = [];
        itemSerialNumber = 1;
        document.getElementById('itemsTableBody').innerHTML = '';

        // Reset totals
        document.getElementById('sgstRate').value = '2.5';
        document.getElementById('cgstRate').value = '2.5';

        calculateTotals();
        currentInvoice = null;
        updateBillingSectionMode();
    } catch (error) {
        console.error('Error initializing new invoice:', error);
        showErrorAlert('Error initializing invoice: ' + error.message);
    }
}

/**
 * Update billing section heading and button visibility based on edit vs new mode.
 * In edit mode: only show Update Invoice; hide Download PDF and New Invoice.
 */
function updateBillingSectionMode() {
    const titleEl = document.getElementById('billingSectionTitle');
    const updateBtn = document.getElementById('btnUpdateInvoice');
    const downloadBtn = document.getElementById('btnDownloadPDF');
    const newBtn = document.getElementById('btnNewInvoice');
    if (titleEl) {
        titleEl.textContent = currentInvoice ? 'Edit Invoice' : 'Create New Invoice';
    }
    const isEdit = !!currentInvoice;
    if (updateBtn) {
        updateBtn.style.display = isEdit ? 'inline-block' : 'none';
    }
    if (downloadBtn) {
        downloadBtn.style.display = isEdit ? 'none' : 'inline-block';
    }
    if (newBtn) {
        newBtn.style.display = isEdit ? 'none' : 'inline-block';
    }
}

/**
 * Populate customer select dropdown
 */
function populateCustomerSelect() {
    const select = document.getElementById('customerSelect');
    if (!select) {
        console.error('Customer select element not found!');
        return;
    }
    
    select.innerHTML = '<option value="">-- Select Customer --</option>';
    
    if (customers && customers.length > 0) {
        customers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.id;
            option.textContent = customer.name || 'Unnamed Customer';
            select.appendChild(option);
        });
        console.log(`Populated ${customers.length} customers in dropdown`);
    } else {
        console.log('No customers to populate');
    }
}

/**
 * Handle customer selection
 */
function handleCustomerSelect() {
    const customerId = parseInt(document.getElementById('customerSelect').value);
    if (!customerId) {
        document.getElementById('customerDetails').style.display = 'none';
        return;
    }

    const customer = customers.find(c => c.id === customerId);
    if (customer) {
        document.getElementById('customerName').value = customer.name || '';
        document.getElementById('customerGstin').value = customer.gstin || '';
        document.getElementById('customerMobile').value = customer.mobile || '';
        document.getElementById('customerBilledAddress').value = customer.billed_address || customer.address || '';
        document.getElementById('customerShippedAddress').value = customer.shipped_address || customer.billed_address || customer.address || '';
        document.getElementById('customerState').value = customer.state || '';
        document.getElementById('customerDetails').style.display = 'block';
    }
}

/**
 * Add a new invoice item row
 */
function addInvoiceItem() {
    const tbody = document.getElementById('itemsTableBody');
    const row = document.createElement('tr');
    row.dataset.itemIndex = invoiceItems.length;

    // Create product select
    const productSelect = document.createElement('select');
    productSelect.className = 'product-select';
    productSelect.innerHTML = '<option value="">-- Select Product --</option>';
    products.forEach(product => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = `${product.name} (${product.rate})`;
        option.dataset.rate = product.rate;
        option.dataset.hsn = product.hsn_code || '';
        productSelect.appendChild(option);
    });

    productSelect.addEventListener('change', function() {
        const selectedOption = this.options[this.selectedIndex];
        if (selectedOption.value) {
            const rate = parseFloat(selectedOption.dataset.rate) || 0;
            const hsn = selectedOption.dataset.hsn || '';
            row.querySelector('.item-rate').value = rate;
            row.querySelector('.item-hsn').textContent = hsn;
            calculateItemAmount(row);
        }
    });

    row.innerHTML = `
        <td>${itemSerialNumber++}</td>
        <td>
            <select class="product-select">
                ${products.map(p => `<option value="${p.id}" data-rate="${p.rate}" data-hsn="${p.hsn_code || ''}">${p.name} (${p.rate})</option>`).join('')}
            </select>
        </td>
        <td class="item-hsn"></td>
        <td><input type="number" class="item-quantity" step="1" value="0" min="0"></td>
        <td><input type="number" class="item-rate" step="1" value="0" min="0"></td>
        <td class="item-amount">0.00</td>
        <td><button class="btn btn-danger btn-small" onclick="removeInvoiceItem(this)">Remove</button></td>
    `;

    // Update product select
    const select = row.querySelector('.product-select');
    select.innerHTML = '<option value="">-- Select Product --</option>';
    products.forEach(product => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = `${product.name} (${product.rate})`;
        option.dataset.rate = product.rate;
        option.dataset.hsn = product.hsn_code || '';
        select.appendChild(option);
    });

    select.addEventListener('change', function() {
        const selectedOption = this.options[this.selectedIndex];
        if (selectedOption.value) {
            const rate = parseFloat(selectedOption.dataset.rate) || 0;
            const hsn = selectedOption.dataset.hsn || '';
            row.querySelector('.item-rate').value = rate;
            row.querySelector('.item-hsn').textContent = hsn;
            calculateItemAmount(row);
        }
    });

    // Add event listeners for quantity and rate
    const quantityInput = row.querySelector('.item-quantity');
    const rateInput = row.querySelector('.item-rate');

    quantityInput.addEventListener('input', () => calculateItemAmount(row));
    rateInput.addEventListener('input', () => calculateItemAmount(row));

    tbody.appendChild(row);
    updateSerialNumbers();
}

/**
 * Calculate amount for a single item
 */
function calculateItemAmount(row) {
    const quantity = parseFloat(row.querySelector('.item-quantity').value) || 0;
    const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
    const amount = quantity * rate;
    row.querySelector('.item-amount').textContent = amount.toFixed(2);
    calculateTotals();
}

/**
 * Remove an invoice item
 */
function removeInvoiceItem(button) {
    const row = button.closest('tr');
    row.remove();
    updateSerialNumbers();
    calculateTotals();
}

/**
 * Update serial numbers in the items table
 */
function updateSerialNumbers() {
    const rows = document.querySelectorAll('#itemsTableBody tr');
    rows.forEach((row, index) => {
        row.querySelector('td:first-child').textContent = index + 1;
    });
}

/**
 * Calculate all totals (items, taxes, final amount)
 */
function calculateTotals() {
    // Calculate total value from items
    let totalValue = 0;
    document.querySelectorAll('#itemsTableBody tr').forEach(row => {
        const amount = parseFloat(row.querySelector('.item-amount').textContent) || 0;
        totalValue += amount;
    });

    // Get tax rates
    const sgstRate = parseFloat(document.getElementById('sgstRate').value) || 0;
    const cgstRate = parseFloat(document.getElementById('cgstRate').value) || 0;

    // Calculate taxes
    const sgstAmount = (totalValue * sgstRate) / 100;
    const cgstAmount = (totalValue * cgstRate) / 100;

    // Calculate total amount (SGST + CGST only)
    const totalAmount = totalValue + sgstAmount + cgstAmount;

    // Update UI
    document.getElementById('totalValue').textContent = totalValue.toFixed(2);
    document.getElementById('sgstAmount').textContent = sgstAmount.toFixed(2);
    document.getElementById('cgstAmount').textContent = cgstAmount.toFixed(2);
    document.getElementById('totalAmount').textContent = totalAmount.toFixed(2);
}

/**
 * Save invoice (optionally show success alert; used automatically on download when shouldShowSuccessAlert is false)
 */
async function saveInvoice(shouldShowSuccessAlert = true) {
    try {
        if (!currentCompanyId) {
            await showWarningAlert('Please select a company first.', 'companySelect');
            return false;
        }
        // Validate form
        const customerId = parseInt(document.getElementById('customerSelect').value);
        if (!customerId) {
            await showWarningAlert('Please select a customer', 'customerSelect');
            return false;
        }

        const rows = document.querySelectorAll('#itemsTableBody tr');
        if (rows.length === 0) {
            await showWarningAlert('Please add at least one item', 'btnAddItem');
            return false;
        }

        // Collect invoice items
        const items = [];
        rows.forEach((row, index) => {
            const productSelect = row.querySelector('.product-select');
            const productId = parseInt(productSelect.value);
            if (!productId) {
                showWarningAlert(`Please select a product for item ${index + 1}`);
                setTimeout(() => {
                    window.focus();
                    productSelect.focus();
                }, 300);
                throw new Error('Invalid product');
            }

            const quantity = parseFloat(row.querySelector('.item-quantity').value) || 0;
            const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
            const amount = parseFloat(row.querySelector('.item-amount').textContent) || 0;

            if (quantity <= 0 || rate <= 0) {
                showWarningAlert(`Please enter valid quantity and rate for item ${index + 1}`);
                setTimeout(() => {
                    window.focus();
                    if (quantity <= 0) {
                        const qtyField = row.querySelector('.item-quantity');
                        qtyField.focus();
                        qtyField.select();
                    } else {
                        const rateField = row.querySelector('.item-rate');
                        rateField.focus();
                        rateField.select();
                    }
                }, 300);
                throw new Error('Invalid item data');
            }

            items.push({
                product_id: productId,
                serial_number: index + 1,
                quantity: quantity,
                rate: rate,
                amount: amount
            });
        });

        // Get company and customer snapshot for invoice record
        let companySettings;
        let customer;
        let formInvoiceNum;
        let invoiceNumber;
        let invoiceData;
        try {
        if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
        companySettings = await window.electronAPI.getCompanySettings(currentCompanyId);
        customer = customers.find(c => c.id === customerId);

        // Prepare invoice data (include company & customer snapshot for PDF from list)
        // Use form value for invoice number (user can edit). On update send with company prefix for DB.
        formInvoiceNum = document.getElementById('invoiceNumber').value.trim();
        invoiceNumber = currentInvoice && currentCompanyId
            ? `${currentCompanyId}-${formInvoiceNum}`
            : formInvoiceNum;
        invoiceData = {
            id: currentInvoice ? currentInvoice.id : null,
            invoice_number: invoiceNumber,
            invoice_date: (() => { const d = parseDDMMYYYY(document.getElementById('invoiceDate').value.trim()); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString() : new Date().toISOString(); })(),
            tp_number: document.getElementById('tpNumber').value || null,
            vehicle_number: document.getElementById('vehicleNumber').value || null,
            customer_id: customerId,
            payment_mode: 'ONLINE',
            total_value: parseFloat(document.getElementById('totalValue').textContent) || 0,
            royalty_on_weight: 0,
            dmft_on_royalty: 0,
            reverse_charge: 0,
            sgst_rate: parseFloat(document.getElementById('sgstRate').value) || 0,
            sgst_amount: parseFloat(document.getElementById('sgstAmount').textContent) || 0,
            cgst_rate: parseFloat(document.getElementById('cgstRate').value) || 0,
            cgst_amount: parseFloat(document.getElementById('cgstAmount').textContent) || 0,
            igst_rate: 0,
            igst_amount: 0,
            total_amount: parseFloat(document.getElementById('totalAmount').textContent) || 0,
            items: items,
            company_id: currentCompanyId,
            // Company snapshot
            company_name: companySettings ? companySettings.company_name : '',
            company_gstin: companySettings ? companySettings.gstin : '',
            company_mobile: companySettings ? companySettings.mobile : '',
            company_address: companySettings ? companySettings.address : '',
            company_email: companySettings ? companySettings.email : '',
            company_bank_name: companySettings ? companySettings.bank_name : '',
            company_account_number: companySettings ? companySettings.account_number : '',
            company_ifsc_code: companySettings ? companySettings.ifsc_code : '',
            // Customer snapshot
            customer_name: customer ? customer.name : '',
            customer_address: customer ? (customer.billed_address || customer.address || '') : '',
            customer_billed_address: customer ? (customer.billed_address || customer.address || '') : '',
            customer_shipped_address: customer ? (customer.shipped_address || customer.billed_address || customer.address || '') : '',
            customer_state: customer ? customer.state : '',
            customer_gstin: customer ? customer.gstin : '',
            customer_mobile: customer ? customer.mobile : ''
        };

        // Validate invoice data before saving
        if (!invoiceData.invoice_number || invoiceData.invoice_number.trim() === '') {
            await showWarningAlert('Invoice number is required', 'invoiceNumber', true);
            return false;
        }
        
        if (!invoiceData.customer_id) {
            await showWarningAlert('Customer is required', 'customerSelect');
            return false;
        }
        
        if (!invoiceData.items || invoiceData.items.length === 0) {
            await showWarningAlert('Please add at least one item to the invoice', 'btnAddItem');
            return false;
        }

        const storedForFy = `${currentCompanyId}-${formInvoiceNum}`;
        const duplicateInFy = await window.electronAPI.invoiceNumberExistsInFY(
            currentCompanyId,
            storedForFy,
            invoiceData.invoice_date,
            invoiceData.id || null
        );
        if (duplicateInFy) {
            await showWarningAlert(
                'This invoice number is already used in the same financial year (1 March – end of February) for this company. Choose another number or change the invoice date to a different financial year.',
                'invoiceNumber',
                true
            );
            return false;
        }

        // Save invoice
        const savedInvoiceId = await window.electronAPI.saveInvoice(invoiceData);
        const wasNewInvoice = !invoiceData.id;
        if (wasNewInvoice) {
            try {
                await window.electronAPI.incrementInvoiceCount(currentCompanyId);
            } catch (e) {
                console.error('Error incrementing invoice count:', e);
            }
        }
        if (shouldShowSuccessAlert) {
            showSuccessToast('Invoice saved successfully!');
        }
        
        // Update current invoice reference (single fetch; list may be paginated)
        if (savedInvoiceId != null) {
            const latest = await window.electronAPI.getInvoice(Number(savedInvoiceId));
            if (latest) {
                currentInvoice = latest;
            }
        }
        
        // Reload invoices if modal is open
        if (document.getElementById('invoicesModal').classList.contains('show')) {
            await loadInvoices();
        }
        return true;
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Error saving invoice:', error);
        const errorMessage = error.message || 'Unknown error occurred';
        showErrorAlert('Error saving invoice: ' + errorMessage + '\n\nPlease check:\n- All required fields are filled\n- Customer is selected\n- At least one item is added\n- Product is selected for each item');
        return false;
    }
}

/**
 * Print invoice
 */
async function printInvoice() {
    try {
        // Validate that invoice is saved or has data
        const customerId = parseInt(document.getElementById('customerSelect').value);
        if (!customerId) {
            await showWarningAlert('Please select a customer and save the invoice first');
            return;
        }

        // Get company settings
        const companySettings = await window.electronAPI.getCompanySettings(currentCompanyId);
        if (!companySettings) {
            await showWarningAlert('Please configure company settings first');
            return;
        }

        // Get customer data
        const customer = customers.find(c => c.id === customerId);
        if (!customer) {
            await showErrorAlert('Customer not found');
            return;
        }

        // Get invoice items
        const items = [];
        document.querySelectorAll('#itemsTableBody tr').forEach((row, index) => {
            const productSelect = row.querySelector('.product-select');
            const productId = parseInt(productSelect.value);
            const product = products.find(p => p.id === productId);
            
            items.push({
                serial_number: index + 1,
                particulars: product ? product.name : '',
                hsn_code: row.querySelector('.item-hsn').textContent,
                quantity: parseFloat(row.querySelector('.item-quantity').value) || 0,
                rate: parseFloat(row.querySelector('.item-rate').value) || 0,
                amount: parseFloat(row.querySelector('.item-amount').textContent) || 0
            });
        });

        // Generate print HTML
        const printHTML = generateInvoiceHTML(companySettings, customer, items);
        
        // Verify content is there
        if (!printHTML || printHTML.trim() === '') {
            await showErrorAlert('Error: Print content is empty. Please try again.');
            return;
        }
        
        // Use Electron's print API with the HTML content
        try {
            await window.electronAPI.printInvoice(printHTML);
        } catch (error) {
            console.error('Print error:', error);
            showErrorAlert('Error printing invoice: ' + error.message);
        }
    } catch (error) {
        console.error('Error printing invoice:', error);
        showErrorAlert('Error printing invoice: ' + error.message);
    }
}

/**
 * Download invoice as PDF (saves invoice automatically first)
 */
async function downloadPDF() {
    try {
        if (!currentCompanyId) {
            await showWarningAlert('Please select a company first.');
            return;
        }
        // Require product selected for every item before download
        const rows = document.querySelectorAll('#itemsTableBody tr');
        if (rows.length === 0) {
            await showWarningAlert('Please add at least one item before downloading the invoice.');
            return;
        }
        for (let i = 0; i < rows.length; i++) {
            const productSelect = rows[i].querySelector('.product-select');
            const productId = productSelect ? parseInt(productSelect.value) : 0;
            if (!productId) {
                await showWarningAlert(`Please select a product for item ${i + 1} before downloading the invoice.`);
                return;
            }
        }

        // Save invoice first (validates customer, items, etc.; no success toast)
        if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
        try {
        const saved = await saveInvoice(false);
        if (!saved) return;

        const customerId = parseInt(document.getElementById('customerSelect').value);
        // Get company settings
        const companySettings = await window.electronAPI.getCompanySettings(currentCompanyId);
        
        if (!companySettings) {
            await showWarningAlert('Please configure company settings first');
            return;
        }

        // Get customer data
        const customer = customers.find(c => c.id === customerId);
       
        if (!customer) {
            await showErrorAlert('Customer not found');
            return;
        }

        // Get invoice items
        var items = [];
        document.querySelectorAll('#itemsTableBody tr').forEach((row, index) => {
            let productSelect = row.querySelector('.product-select');
            let productId = parseInt(productSelect.value);
            let product = products.find(p => p.id === productId);
            
            items.push({
                serial_number: index + 1,
                particulars: product ? product.name : '',
                hsn_code: row.querySelector('.item-hsn').textContent,
                quantity: parseFloat(row.querySelector('.item-quantity').value) || 0,
                rate: parseFloat(row.querySelector('.item-rate').value) || 0,
                amount: parseFloat(row.querySelector('.item-amount').textContent) || 0
            });
        });

        

        // Generate print HTML
        const printHTML = generateInvoiceHTML(companySettings, customer, items);

        // Verify content is there
        if (!printHTML || printHTML.trim() === '') {
            await showErrorAlert('Error: Print content is empty. Please try again.');
            return;
        }
        
        await window.electronAPI.downloadPDF(printHTML);
        // Reset form for next invoice after download
        await initializeNewInvoice();
        } catch (error) {
            showErrorAlert('Error downloading PDF: ' + error.message);
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        showErrorAlert('Error downloading PDF: ' + error.message);
    }
}

/**
 * Generate invoice HTML for printing
 */
function generateInvoiceHTML(company, customer, items) {
    try {
    let invoiceNumber = document.getElementById('invoiceNumber').value;
    const dateVal = document.getElementById('invoiceDate').value.trim();
    const invoiceDate = parseDDMMYYYY(dateVal) || new Date();
    let formattedDate = formatDateDDMMYYYY(invoiceDate);

    let totalValue = parseFloat(document.getElementById('totalValue').textContent) || 0;
    let sgstRate = parseFloat(document.getElementById('sgstRate').value) || 0;
    let sgstAmount = parseFloat(document.getElementById('sgstAmount').textContent) || 0;
    let cgstRate = parseFloat(document.getElementById('cgstRate').value) || 0;
    let cgstAmount = parseFloat(document.getElementById('cgstAmount').textContent) || 0;
    let totalAmount = parseFloat(document.getElementById('totalAmount').textContent) || 0;
    let tpNumber = document.getElementById('tpNumber').value || '';
    let vehicleNumber = document.getElementById('vehicleNumber').value || '';
    let placeOfSupply = customer.state ? `${customer.state} (${(customer.gstin || '').substring(0, 2) || '—'})` : '—';
    let customerStateCode = (customer.gstin || '').substring(0, 2) || '';

    let amountInWords = numberToWords(totalAmount);
    let companyNameUpper = (company.company_name || '').toUpperCase();
    let companyNameDisplay = companyNameUpper ? (companyNameUpper.startsWith('M/S ') ? companyNameUpper : 'M/S ' + companyNameUpper) : '';

    return `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <title>Invoice - ${invoiceNumber}</title>
    
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
    .header-top-left { text-align: left; vertical-align: middle; border: 1px solid #000; padding: 4px; }
    .header-top-center { text-align: center; vertical-align: middle; border: 1px solid #000; padding: 4px; font-size: 18px; font-weight: bold; }
    .header-top-right { text-align: right; vertical-align: middle; border: 1px solid #000; padding: 4px; font-size: 11px; }
    .header-company-block { text-align: center; border: 1px solid #000; padding: 6px 4px; border-bottom: 1px solid #000; }
    .header-company-name { font-size: 16px; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
    .header-company-address { font-size: 12px; }
    .header-company-mobile { font-size: 12px; }
    .header-section-row td { border: 1px solid #000; padding: 4px; vertical-align: top; border-top: 1px solid #000; }
    .header-detail-label { white-space: nowrap; }
    .billed-shipped-label { font-weight: bold; }
    </style>
    </head>
    
    <body>
    
    <table>
      <!-- TOP ROW: GSTIN (left) | TAX INVOICE (center) | Original Copy (right) -->
      <tr>
        <td class="header-top-left" colspan="2" style="border:none;">GSTIN: ${company.gstin}</td>
        <td class="header-top-center" colspan="3" style="border:none;"></td>
        <td class="header-top-right" colspan="2" style="border:none;">Original Copy</td>
      </tr>
      <tr>
        <td class="header-top-left" colspan="2" style="border:none;"></td>
        <td class="header-top-center" colspan="3" style="border:none;">TAX INVOICE</td>
        <td class="header-top-right" colspan="2" style="border:none;"></td>
      </tr>
      <!-- COMPANY BLOCK: name, address, mobile (centered) -->
      <tr>
        <td colspan="7" class="header-company-block" style="border:none;">
          <div class="header-company-name">${companyNameDisplay}</div>
          <div class="header-company-address">${company.address || ''}</div>
          <div class="header-company-mobile">MOB:- ${company.mobile || ''}</div>
        </td>
      </tr>
      <!-- INVOICE DETAILS: two columns with horizontal line above -->
      <tr class="header-section-row">
        <td colspan="3" style="border-bottom: 1px solid #000;">
          <span class="header-detail-label">Invoice No :</span> ${invoiceNumber}<br>
          <span class="header-detail-label">Dated :</span> ${formattedDate}<br>
          <span class="header-detail-label">Place of Supply :</span> ${placeOfSupply}
        </td>
        <td colspan="4" style="border-bottom: 1px solid #000; border-left: 1px solid #000;">
          <span class="header-detail-label">TP Number :</span> ${tpNumber || ''}<br>
          <span class="header-detail-label">Vehicle No :</span> ${vehicleNumber || ''}<br>
        </td>
      </tr>
      <!-- BILLED TO / SHIPPED TO -->
      <tr class="header-section-row">
        <td colspan="3" style="border-bottom: 1px solid #000;">
          <span class="billed-shipped-label">Billed to :</span><br>
          ${customer.name || ''}<br>
          ${customer.billed_address || customer.address || ''}<br>
          STATE : ${customer.state || ''}<br>
          STATE CODE : ${customerStateCode}<br>
          GST: ${customer.gstin || ''}
        </td>
        <td colspan="4" style="border-bottom: 1px solid #000; border-left: 1px solid #000;">
          <span class="billed-shipped-label">Shipped to :</span><br>
          ${customer.name || ''}<br>
          ${customer.shipped_address || customer.billed_address || customer.address || ''}<br>
          GST: ${customer.gstin || ''}
        </td>
      </tr>
    
      <!-- ITEMS HEADER -->
      <tr class="center bold">
        <td>S.No</td>
        <td>Description of Goods</td>
        <td>HSN CODE</td>
        <td>QTY</td>
        <td>UNIT</td>
        <td>PRICE</td>
        <td>AMOUNT</td>
      </tr>
    
      <!-- ITEMS -->
      ${items.map(i => `
      <tr class="center">
        <td>${i.serial_number}</td>
        <td>${i.particulars}</td>
        <td>${i.hsn_code}</td>
        <td>${i.quantity}</td>
        <td>Qtl</td>
        <td>${i.rate}</td>
        <td>${(Number(i.amount) || 0).toFixed(2)}</td>
      </tr>
      `).join('')}
    
      <!-- TOTALS -->
      <tr>
      <!-- BANK DETAILS (LEFT) -->
        <td colspan="5" rowspan="4">
            <strong>Bank Details:</strong><br><br>
            ${company.bank_name || ''}<br>
            <strong>A/C No:</strong> ${company.account_number || ''}<br>
            <strong>IFSC:</strong> ${company.ifsc_code || ''}<br><br>

            <strong>Amount in Words:</strong><br>
            ${amountInWords}
        </td>
        <td class="bold">Total Value</td>
        <td class="right">${totalValue.toFixed(2)}</td>
      </tr>
      <tr>
        <td>SGST @ ${sgstRate}%</td>
        <td class="right">${sgstAmount.toFixed(2)}</td>
      </tr>
      <tr>
        <td>CGST @ ${cgstRate}%</td>
        <td class="right">${cgstAmount.toFixed(2)}</td>
      </tr>
      <tr class="bold">
        <td>Total After Tax</td>
        <td class="right">${totalAmount.toFixed(2)}</td>
      </tr>
  
   
      <!-- FOOTER -->
      <!-- TERMS & CONDITIONS + SIGNATURES -->
        <tr>
        <!-- TERMS & CONDITIONS -->
        <td colspan="5" style="height:120px;">
            <strong>Terms & Conditions:</strong><br><br>
            1. Goods once sold will not be taken back.<br>
            2. Interest @18% p.a. will be charged if payment is not made within due date.<br>
            3. Our responsibility ceases once goods leave our premises.<br>
            4. Subject to 'Uttar Pradesh' jurisdiction only.
        </td>

        <!-- SIGNATURE BOX -->
        <td colspan="2" class="center" style="border-top:none;">
            <strong>For ${company.company_name}</strong><br><br><br><br>
            Authorised Signatory
        </td>
        </tr>

        <tr>
        <td colspan="5" class="center bold" style="border-top:none;">
            Customer Signature
        </td>
        <td colspan="2" class="center bold" style="border-top:none;">
            Authorised Signature
        </td>
        </tr>

    </table>
    
    </body>
    </html>
    `;
    
    } catch (error) {
        console.error('Error generating invoice HTML:', error);
        showErrorAlert('Error generating invoice HTML: ' + error.message);
        return '';
    }
}

/**
 * Generate invoice HTML from a saved invoice record (for PDF download from list)
 */
function generateInvoiceHTMLFromRecord(invoice) {
    try {
        const company = {
            company_name: invoice.company_name || '',
            gstin: invoice.company_gstin || '',
            mobile: invoice.company_mobile || '',
            address: invoice.company_address || '',
            email: invoice.company_email || '',
            bank_name: invoice.company_bank_name || '',
            account_number: invoice.company_account_number || '',
            ifsc_code: invoice.company_ifsc_code || ''
        };
        const customer = {
            name: invoice.customer_name_join || invoice.customer_name || '',
            address: invoice.customer_billed_address_join || invoice.customer_address_join || invoice.customer_address || invoice.customer_billed_address || '',
            billed_address: invoice.customer_billed_address_join || invoice.customer_address_join || invoice.customer_billed_address || invoice.customer_address || '',
            shipped_address: invoice.customer_shipped_address_join || invoice.customer_billed_address_join || invoice.customer_address_join || invoice.customer_shipped_address || invoice.customer_billed_address || invoice.customer_address || '',
            state: invoice.customer_state || invoice.customer_state_join || '',
            gstin: invoice.customer_gstin || invoice.customer_gstin_join || '',
            mobile: invoice.customer_mobile || invoice.customer_mobile_join || ''
        };
        const items = (invoice.items || []).map(ii => ({
            serial_number: ii.serial_number,
            particulars: ii.product_name || '',
            hsn_code: ii.hsn_code || '',
            quantity: parseFloat(ii.quantity) || 0,
            rate: parseFloat(ii.rate) || 0,
            amount: parseFloat(ii.amount) || 0
        }));

        const invoiceNumber = displayInvoiceNumber(invoice.invoice_number) || invoice.invoice_number || '';
        const invoiceDate = new Date(invoice.invoice_date);
        const formattedDate = formatDateDDMMYYYY(invoiceDate);
        const tpNumber = invoice.tp_number || '';
        const vehicleNumber = invoice.vehicle_number || '';
        const totalValue = parseFloat(invoice.total_value) || 0;
        const sgstRate = parseFloat(invoice.sgst_rate) || 0;
        const sgstAmount = parseFloat(invoice.sgst_amount) || 0;
        const cgstRate = parseFloat(invoice.cgst_rate) || 0;
        const cgstAmount = parseFloat(invoice.cgst_amount) || 0;
        const totalAmount = parseFloat(invoice.total_amount) || 0;
        const placeOfSupply = customer.state ? `${customer.state} (${(customer.gstin || '').substring(0, 2) || '—'})` : '—';
        const customerStateCode = (customer.gstin || '').substring(0, 2) || '';
        const amountInWords = numberToWords(totalAmount);
        const companyNameUpper = (company.company_name || '').toUpperCase();
        const companyNameDisplay = companyNameUpper ? (companyNameUpper.startsWith('M/S ') ? companyNameUpper : 'M/S ' + companyNameUpper) : '';

        return `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <title>Invoice - ${invoiceNumber}</title>
    <style>
    @page { size: A4; margin: 8mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #000; padding: 4px; vertical-align: top; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .header-top-left { text-align: left; vertical-align: middle; border: 1px solid #000; padding: 4px; }
    .header-top-center { text-align: center; vertical-align: middle; border: 1px solid #000; padding: 4px; font-size: 18px; font-weight: bold; }
    .header-top-right { text-align: right; vertical-align: middle; border: 1px solid #000; padding: 4px; font-size: 11px; }
    .header-company-block { text-align: center; border: 1px solid #000; padding: 6px 4px; }
    .header-company-name { font-size: 16px; font-weight: bold; text-transform: uppercase; }
    .header-company-address { font-size: 12px; }
    .header-company-mobile { font-size: 12px; }
    .header-section-row td { border: 1px solid #000; padding: 4px; vertical-align: top; }
    .header-detail-label { white-space: nowrap; }
    .billed-shipped-label { font-weight: bold; }
    </style>
    </head>
    <body>
    <table>
      <tr>
        <td class="header-top-left" colspan="2" style="border:none;">GSTIN: ${company.gstin}</td>
        <td class="header-top-center" colspan="3" style="border:none;"></td>
        <td class="header-top-right" colspan="2" style="border:none;">Original Copy</td>
      </tr>
      <tr>
        <td class="header-top-left" colspan="2" style="border:none;"></td>
        <td class="header-top-center" colspan="3" style="border:none;">TAX INVOICE</td>
        <td class="header-top-right" colspan="2" style="border:none;"></td>
      </tr>
      <tr>
        <td colspan="7" class="header-company-block" style="border:none;">
          <div class="header-company-name">${companyNameDisplay}</div>
          <div class="header-company-address">${company.address}</div>
          <div class="header-company-mobile">MOB:- ${company.mobile}</div>
        </td>
      </tr>
      <tr class="header-section-row">
        <td colspan="3" style="border-bottom: 1px solid #000;">
          <span class="header-detail-label">Invoice No :</span> ${invoiceNumber}<br>
          <span class="header-detail-label">Dated :</span> ${formattedDate}<br>
          <span class="header-detail-label">Place of Supply :</span> ${placeOfSupply}
        </td>
        <td colspan="4" style="border-bottom: 1px solid #000; border-left: 1px solid #000;">
          <span class="header-detail-label">TP Number :</span> ${tpNumber}<br>
          <span class="header-detail-label">Vehicle No :</span> ${vehicleNumber}<br>
        </td>
      </tr>
      <tr class="header-section-row">
        <td colspan="3" style="border-bottom: 1px solid #000;">
          <span class="billed-shipped-label">Billed to :</span><br>
          ${customer.name}<br>${customer.billed_address}<br>STATE : ${customer.state}<br>STATE CODE : ${customerStateCode}<br>GST: ${customer.gstin}
        </td>
        <td colspan="4" style="border-bottom: 1px solid #000; border-left: 1px solid #000;">
          <span class="billed-shipped-label">Shipped to :</span><br>
          ${customer.name}<br>${customer.shipped_address}<br>GST: ${customer.gstin}
        </td>
      </tr>
      <tr class="center bold">
        <td>S.No</td><td>Description of Goods</td><td>HSN CODE</td><td>QTY</td><td>UNIT</td><td>PRICE</td><td>AMOUNT</td>
      </tr>
      ${items.map(i => `
      <tr class="center">
        <td>${i.serial_number}</td><td>${i.particulars}</td><td>${i.hsn_code}</td><td>${i.quantity}</td><td>Qtl</td><td>${i.rate}</td><td>${(Number(i.amount) || 0).toFixed(2)}</td>
      </tr>
      `).join('')}
      <tr>
        <td colspan="5" rowspan="4">
            <strong>Bank Details:</strong><br><br>${company.bank_name}<br><strong>A/C No:</strong> ${company.account_number}<br><strong>IFSC:</strong> ${company.ifsc_code}<br><br><strong>Amount in Words:</strong><br>${amountInWords}
        </td>
        <td class="bold">Total Value</td>
        <td class="right">${totalValue.toFixed(2)}</td>
      </tr>
      <tr><td>SGST @ ${sgstRate}%</td><td class="right">${sgstAmount.toFixed(2)}</td></tr>
      <tr><td>CGST @ ${cgstRate}%</td><td class="right">${cgstAmount.toFixed(2)}</td></tr>
      <tr class="bold"><td>Total After Tax</td><td class="right">${totalAmount.toFixed(2)}</td></tr>
      <tr>
        <td colspan="5" style="height:120px;"><strong>Terms & Conditions:</strong><br><br>1. Goods once sold will not be taken back.<br>2. Interest @18% p.a. will be charged if payment is not made within due date.<br>3. Our responsibility ceases once goods leave our premises.<br>4. Subject to local jurisdiction only.</td>
        <td colspan="2" class="center"><strong>For ${company.company_name}</strong><br><br><br><br>Authorised Signatory</td>
      </tr>
      <tr>
        <td colspan="5" class="center bold" style="border-top:none;">Customer Signature</td>
        <td colspan="2" class="center bold" style="border-top:none;">Authorised Signature</td>
      </tr>
    </table>
    </body>
    </html>`;
    } catch (error) {
        console.error('Error generating invoice HTML from record:', error);
        showErrorAlert('Error generating invoice PDF: ' + (error.message || ''));
        return '';
    }
}

/**
 * Download PDF for an invoice from the list (uses saved invoice data)
 */
async function downloadInvoicePDF(invoiceId) {
    if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
    try {
        let invoice = await window.electronAPI.getInvoice(invoiceId);
        if (!invoice) {
            await showErrorAlert('Invoice not found');
            return;
        }
        // Always use current company settings for PDF so bank name, account number, IFSC are up to date
        const companySettings = await window.electronAPI.getCompanySettings(invoice.company_id || currentCompanyId);
        if (companySettings) {
            invoice = { ...invoice,
                company_name: companySettings.company_name || invoice.company_name,
                company_gstin: companySettings.gstin ?? invoice.company_gstin,
                company_mobile: companySettings.mobile ?? invoice.company_mobile,
                company_address: companySettings.address ?? invoice.company_address,
                company_email: companySettings.email ?? invoice.company_email,
                company_bank_name: companySettings.bank_name ?? invoice.company_bank_name,
                company_account_number: companySettings.account_number ?? invoice.company_account_number,
                company_ifsc_code: companySettings.ifsc_code ?? invoice.company_ifsc_code
            };
        }
        const printHTML = generateInvoiceHTMLFromRecord(invoice);
        if (!printHTML || !printHTML.trim()) {
            await showErrorAlert('Could not generate invoice PDF');
            return;
        }
        await window.electronAPI.downloadPDF(printHTML);
    } catch (error) {
        console.error('Error downloading invoice PDF:', error);
        showErrorAlert('Error downloading invoice PDF: ' + (error.message || ''));
    } finally {
        if (typeof window.endAppLoading === 'function') window.endAppLoading();
    }
}

/**
 * Download all invoices (current company) as a single PDF
 */
async function downloadAllInvoicesPDF() {
    if (!currentCompanyId) {
        await showWarningAlert('Please select a company first.');
        return;
    }
    const dateOpts = getInvoiceFilterDatesForApi();
    const listRaw = await window.electronAPI.getInvoices(currentCompanyId, { fetch_all: true, ...dateOpts });
    const toExport = normalizeInvoicesListResponse(listRaw).data;
    if (!toExport || toExport.length === 0) {
        await showWarningAlert('No invoices to download (check date filter if set).');
        return;
    }
    if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
    try {
        const bodyRegex = /<body[^>]*>([\s\S]*?)<\/body>\s*/i;
        const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/i;
        let sharedStyle = '';
        const bodyParts = [];

        for (let i = 0; i < toExport.length; i++) {
            const inv = toExport[i];
            let invoice = await window.electronAPI.getInvoice(inv.id);
            if (!invoice) continue;
            // Always use current company settings so bank name, account number, IFSC are up to date
            const companySettings = await window.electronAPI.getCompanySettings(invoice.company_id || currentCompanyId);
            if (companySettings) {
                invoice = { ...invoice,
                    company_name: companySettings.company_name || invoice.company_name,
                    company_gstin: companySettings.gstin ?? invoice.company_gstin,
                    company_mobile: companySettings.mobile ?? invoice.company_mobile,
                    company_address: companySettings.address ?? invoice.company_address,
                    company_email: companySettings.email ?? invoice.company_email,
                    company_bank_name: companySettings.bank_name ?? invoice.company_bank_name,
                    company_account_number: companySettings.account_number ?? invoice.company_account_number,
                    company_ifsc_code: companySettings.ifsc_code ?? invoice.company_ifsc_code
                };
            }
            const html = generateInvoiceHTMLFromRecord(invoice);
            if (!html || !html.trim()) continue;
            const bodyMatch = html.match(bodyRegex);
            if (bodyMatch) bodyParts.push(bodyMatch[1].trim());
            if (i === 0) {
                const styleMatch = html.match(styleRegex);
                if (styleMatch) sharedStyle = styleMatch[1];
            }
        }

        if (bodyParts.length === 0) {
            await showErrorAlert('Could not generate PDF for any invoice.');
            return;
        }

        const combinedHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>All Invoices</title>
<!-- ALL_INVOICES_PDF -->
<style>
${sharedStyle}
.invoice-page { page-break-after: always; }
.invoice-page:last-child { page-break-after: auto; }
</style>
</head>
<body>
${bodyParts.map(b => `<div class="invoice-page">${b}</div>`).join('\n')}
</body>
</html>`;

        await window.electronAPI.downloadPDF(combinedHTML);
        await showSuccessAlert(`Downloaded ${bodyParts.length} invoice(s) in a single PDF.`);
    } catch (error) {
        console.error('Error downloading all invoices PDF:', error);
        showErrorAlert('Error downloading all invoices: ' + (error.message || ''));
    } finally {
        if (typeof window.endAppLoading === 'function') window.endAppLoading();
    }
}

/**
 * Convert number to words (Indian numbering system)
 */
function numberToWords(amount) {
    let ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    let tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    let teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    function convertHundreds(num) {
        let result = '';
        if (num >= 100) {
            result += ones[Math.floor(num / 100)] + ' Hundred ';
            num %= 100;
        }
        if (num >= 20) {
            result += tens[Math.floor(num / 10)] + ' ';
            num %= 10;
        } else if (num >= 10) {
            result += teens[num - 10] + ' ';
            return result;
        }
        if (num > 0) {
            result += ones[num] + ' ';
        }
        return result;
    }

    if (amount === 0) return 'Zero Only';

    let rupees = Math.floor(amount);
    let paise = Math.round((amount - rupees) * 100);

    let result = '';

    if (rupees >= 10000000) {
        result += convertHundreds(Math.floor(rupees / 10000000)) + 'Crore ';
        rupees %= 10000000;
    }
    if (rupees >= 100000) {
        result += convertHundreds(Math.floor(rupees / 100000)) + 'Lakh ';
        rupees %= 100000;
    }
    if (rupees >= 1000) {
        result += convertHundreds(Math.floor(rupees / 1000)) + 'Thousand ';
        rupees %= 1000;
    }
    if (rupees > 0) {
        result += convertHundreds(rupees);
    }

    result = result.trim() + ' Only';
    return result;
}

/**
 * Toast helper functions (non-confirmation alerts)
 */
const toast = Swal.mixin({
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

async function showAlert(title, text, icon = 'info', focusElementId = null, selectText = false) {
    await toast.fire({
        icon: icon,
        title: `${title}: ${text}`
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

/** Success toast only; does not wait for timer — use after closing modals so UI is not blocked. */
function showSuccessToast(message) {
    return toast.fire({
        icon: 'success',
        title: `Success: ${message}`
    });
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

    const dataLoaders = {
        settingsModal: loadSettings,
        companiesModal: loadCompaniesList,
        customersModal: loadCustomers,
        productsModal: loadProducts,
        invoicesModal: loadInvoices
    };
    const loader = dataLoaders[modalId];
    if (!loader) return;

    void (async () => {
        if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
        try {
            await loader();
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    })();
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('show');
}

/**
 * Settings (database location only)
 */
async function loadSettings() {
    try {
        const dbPath = await window.electronAPI.getDatabasePath();
        document.getElementById('settingsDatabasePath').value = dbPath ? dbPath : 'Default location (not set)';
        await updateSettingsInvoiceNumberDisplay();
    } catch (error) {
        console.error('Error loading settings:', error);
        showErrorAlert('Error loading settings: ' + error.message);
    }
}

/**
 * Update the "Next invoice number" display in Settings modal
 */
async function updateSettingsInvoiceNumberDisplay() {
    const el = document.getElementById('settingsNextInvoiceNumber');
    if (!el) return;
    if (!currentCompanyId) {
        el.textContent = '—';
        return;
    }
    try {
        const iso = new Date().toISOString();
        const next = await window.electronAPI.getNextInvoiceNumber(currentCompanyId, iso);
        el.textContent = next;
    } catch (e) {
        el.textContent = '—';
    }
}

/**
 * Set next invoice number from Settings (manual value)
 */
async function setInvoiceNumberFromSettings() {
    if (!currentCompanyId) {
        await showWarningAlert('Please select a company first.');
        return;
    }
    const input = document.getElementById('settingsInvoiceNumberInput');
    const value = parseInt(input?.value, 10);
    if (!value || value < 1) {
        await showWarningAlert('Please enter a valid number (1 or more).', 'settingsInvoiceNumberInput', true);
        return;
    }
    try {
        try {
            if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
            await window.electronAPI.setInvoiceCount(currentCompanyId, value - 1);
            await showSuccessAlert(`Next invoice number set to ${String(value).padStart(2, '0')}.`);
            input.value = '';
            await updateSettingsInvoiceNumberDisplay();
            document.getElementById('invoiceNumber').value = String(value).padStart(2, '0');
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Error setting invoice number:', error);
        showErrorAlert('Error setting invoice number: ' + error.message);
    }
}

/**
 * Choose database location
 */
async function chooseDatabaseLocation() {
    try {
        const result = await window.electronAPI.chooseDatabaseLocation();
        
        if (result.canceled) {
            return;
        }
        
        if (result.success) {
            // Update the path display
            document.getElementById('settingsDatabasePath').value = result.path;
            
            let message = 'Database location changed successfully!';
            if (result.moved) {
                message += '\n\nThe existing database has been moved to the new location.';
            } else if (result.created) {
                message += '\n\nA new database has been created at the new location.';
            } else if (result.switched) {
                message += '\n\nSwitched to the database at the new location.';
            }
            
            await showSuccessAlert(message);
            
            // Reload the page to use the new database
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            await showErrorAlert('Error changing database location: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error choosing database location:', error);
        showErrorAlert('Error choosing database location: ' + error.message);
    }
}

/**
 * Companies modal: load and display companies list
 */
let allCompanies = [];

async function loadCompaniesList() {
    try {
        allCompanies = await window.electronAPI.getCompanies();
        displayCompanies();
    } catch (error) {
        console.error('Error loading companies:', error);
        showErrorAlert('Error loading companies: ' + error.message);
    }
}

function displayCompanies() {
    const tbody = document.getElementById('companiesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    allCompanies.forEach(c => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${c.company_name || ''}</td>
            <td>${c.gstin || ''}</td>
            <td>${c.mobile || ''}</td>
            <td>
                <button class="btn btn-primary btn-small" onclick="editCompany(${c.id})">Edit</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function openCompanyForm(companyId) {
    document.getElementById('companyFormId').value = companyId || '';
    document.getElementById('companyFormTitle').textContent = companyId ? 'Edit Company' : 'Add Company';
    document.getElementById('companyFormName').value = '';
    document.getElementById('companyFormGstin').value = '';
    document.getElementById('companyFormMobile').value = '';
    document.getElementById('companyFormEmail').value = '';
    document.getElementById('companyFormAddress').value = '';
    document.getElementById('companyFormBankName').value = '';
    document.getElementById('companyFormAccountNumber').value = '';
    document.getElementById('companyFormIfscCode').value = '';
    document.getElementById('companyFormTerms').value = '';
    if (companyId) {
        const c = allCompanies.find(x => x.id === parseInt(companyId));
        if (c) {
            document.getElementById('companyFormId').value = c.id;
            document.getElementById('companyFormName').value = c.company_name || '';
            document.getElementById('companyFormGstin').value = c.gstin || '';
            document.getElementById('companyFormMobile').value = c.mobile || '';
            document.getElementById('companyFormEmail').value = c.email || '';
            document.getElementById('companyFormAddress').value = c.address || '';
            document.getElementById('companyFormBankName').value = c.bank_name || '';
            document.getElementById('companyFormAccountNumber').value = c.account_number || '';
            document.getElementById('companyFormIfscCode').value = c.ifsc_code || '';
            document.getElementById('companyFormTerms').value = c.terms_conditions || '';
        }
    }
    closeModal('companiesModal');
    openModal('companyFormModal');
}

function editCompany(id) {
    openCompanyForm(id);
}

async function saveCompanyForm() {
    try {
        const companyId = document.getElementById('companyFormId').value;
        const id = companyId ? parseInt(companyId) : null;
        const settings = {
            id: id,
            company_name: document.getElementById('companyFormName').value,
            gstin: document.getElementById('companyFormGstin').value,
            mobile: document.getElementById('companyFormMobile').value,
            address: document.getElementById('companyFormAddress').value,
            email: document.getElementById('companyFormEmail').value,
            bank_name: document.getElementById('companyFormBankName').value,
            account_number: document.getElementById('companyFormAccountNumber').value,
            ifsc_code: document.getElementById('companyFormIfscCode').value,
            terms_conditions: document.getElementById('companyFormTerms').value
        };
        if (!settings.company_name || !settings.company_name.trim()) {
            await showWarningAlert('Company name is required', 'companyFormName', true);
            return;
        }
        try {
            if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
            const savedId = await window.electronAPI.saveCompanySettings(settings);
            if (!id && savedId) {
                currentCompanyId = savedId;
                localStorage.setItem('currentCompanyId', String(currentCompanyId));
                await loadDataForCurrentCompany();
            } else if (id === currentCompanyId) {
                await loadDataForCurrentCompany();
            }
            const companies = await window.electronAPI.getCompanies();
            const companySelect = document.getElementById('companySelect');
            companySelect.innerHTML = '<option value="">-- Select Company --</option>';
            companies.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.company_name || 'Company ' + c.id;
                if (c.id === currentCompanyId) opt.selected = true;
                companySelect.appendChild(opt);
            });
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
        closeModal('companyFormModal');
        openModal('companiesModal');
        showSuccessToast('Company saved successfully!');
    } catch (error) {
        console.error('Error saving company:', error);
        showErrorAlert('Error saving company: ' + error.message);
    }
}

/**
 * Reset invoice number to 01 (next new invoice will be 01)
 */
async function resetInvoiceNumber() {
    if (!currentCompanyId) {
        await showWarningAlert('Please select a company first.');
        return;
    }
    const result = await Swal.fire({
        title: 'Reset invoice number?',
        text: 'Next new invoice will use number 01. Existing invoices are not changed.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, reset to 01',
        cancelButtonText: 'Cancel'
    });
    if (result.isConfirmed) {
        try {
            try {
                if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
                await window.electronAPI.resetInvoiceCount(currentCompanyId);
                await showSuccessAlert('Invoice number reset. Next invoice will be 01.');
                document.getElementById('invoiceNumber').value = '01';
                await updateSettingsInvoiceNumberDisplay();
            } finally {
                if (typeof window.endAppLoading === 'function') window.endAppLoading();
            }
        } catch (error) {
            console.error('Error resetting invoice number:', error);
            showErrorAlert('Error resetting invoice number: ' + error.message);
        }
    }
}

/**
 * Generic pagination function
 */
function updatePagination(data, currentPage, perPage, paginationId, infoId, prevBtnId, nextBtnId, pageNumbersId) {
    const totalPages = Math.ceil(data.length / perPage);
    const startIndex = (currentPage - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, data.length);
    const startRecord = data.length > 0 ? startIndex + 1 : 0;
    const endRecord = endIndex;

    // Update pagination info
    document.getElementById(infoId).textContent = 
        `Showing ${startRecord} - ${endRecord} of ${data.length} records`;

    // Update pagination controls
    const prevBtn = document.getElementById(prevBtnId);
    const nextBtn = document.getElementById(nextBtnId);
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage >= totalPages || totalPages === 0;

    // Update page numbers
    const pageNumbersDiv = document.getElementById(pageNumbersId);
    pageNumbersDiv.innerHTML = '';
    
    if (totalPages === 0) {
        return { startIndex, endIndex };
    }

    // Show page numbers (max 5 visible at a time)
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.className = 'btn btn-secondary btn-small';
        firstBtn.textContent = '1';
        firstBtn.onclick = () => {
            if (paginationId === 'customersPagination') {
                currentCustomersPage = 1;
                displayCustomers();
            } else if (paginationId === 'productsPagination') {
                currentProductsPage = 1;
                displayProducts();
            }
        };
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
        if (i === currentPage) {
            pageBtn.classList.add('btn-primary');
        } else {
            pageBtn.classList.add('btn-secondary');
        }
        pageBtn.textContent = i;
        pageBtn.onclick = () => {
            if (paginationId === 'customersPagination') {
                currentCustomersPage = i;
                displayCustomers();
            } else if (paginationId === 'productsPagination') {
                currentProductsPage = i;
                displayProducts();
            }
        };
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
        lastBtn.onclick = () => {
            if (paginationId === 'customersPagination') {
                currentCustomersPage = totalPages;
                displayCustomers();
            } else if (paginationId === 'productsPagination') {
                currentProductsPage = totalPages;
                displayProducts();
            }
        };
        pageNumbersDiv.appendChild(lastBtn);
    }

    return { startIndex, endIndex };
}

/**
 * Customer functions
 */
async function loadCustomers() {
    try {
        const customersData = await window.electronAPI.getCustomers(currentCompanyId);
        allCustomers = Array.isArray(customersData) ? customersData : [];
        customers = allCustomers;
        
        currentCustomersPage = 1;
        displayCustomers();
        populateCustomerSelect();
    } catch (error) {
        console.error('Error loading customers:', error);
        showErrorAlert('Error loading customers: ' + error.message);
        allCustomers = [];
        customers = [];
        populateCustomerSelect(); // Still populate to show "Select Customer" option
    }
}

function displayCustomers() {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    const { startIndex, endIndex } = updatePagination(
        allCustomers,
        currentCustomersPage,
        customersPerPage,
        'customersPagination',
        'customersPaginationInfo',
        'btnCustomersPrev',
        'btnCustomersNext',
        'customersPageNumbers'
    );

    const currentPageCustomers = allCustomers.slice(startIndex, endIndex);

    currentPageCustomers.forEach(customer => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${customer.name || ''}</td>
            <td>${customer.gstin || ''}</td>
            <td>${customer.mobile || ''}</td>
            <td>${customer.billed_address || customer.address || ''}</td>
            <td>${customer.shipped_address || customer.billed_address || customer.address || ''}</td>
            <td>${customer.state || ''}</td>
            <td>
                <button class="btn btn-primary btn-small" onclick="editCustomer(${customer.id})">Edit</button>
                <button class="btn btn-danger btn-small" onclick="deleteCustomer(${customer.id})">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function openCustomerForm(customerId = null) {
    document.getElementById('customerFormTitle').textContent = customerId ? 'Edit Customer' : 'Add Customer';
    
    if (customerId) {
        const customer = customers.find(c => c.id === customerId);
        if (customer) {
            document.getElementById('customerFormName').value = customer.name || '';
            document.getElementById('customerFormGstin').value = customer.gstin || '';
            document.getElementById('customerFormMobile').value = customer.mobile || '';
            document.getElementById('customerFormBilledAddress').value = customer.billed_address || customer.address || '';
            document.getElementById('customerFormShippedAddress').value = customer.shipped_address || customer.billed_address || customer.address || '';
            document.getElementById('customerFormState').value = customer.state || '';
            document.getElementById('customerFormPincode').value = customer.pincode || '';
            document.getElementById('customerFormName').dataset.customerId = customerId;
        }
    } else {
        document.getElementById('customerFormName').value = '';
        document.getElementById('customerFormGstin').value = '';
        document.getElementById('customerFormMobile').value = '';
        document.getElementById('customerFormBilledAddress').value = '';
        document.getElementById('customerFormShippedAddress').value = '';
        document.getElementById('customerFormState').value = '';
        document.getElementById('customerFormPincode').value = '';
        delete document.getElementById('customerFormName').dataset.customerId;
    }

    closeModal('customersModal');
    openModal('customerFormModal');
}

async function saveCustomerForm() {
    try {
        const customerId = document.getElementById('customerFormName').dataset.customerId;
        const customer = {
            id: customerId ? parseInt(customerId) : null,
            name: document.getElementById('customerFormName').value,
            gstin: document.getElementById('customerFormGstin').value,
            mobile: document.getElementById('customerFormMobile').value,
            address: document.getElementById('customerFormBilledAddress').value,
            billed_address: document.getElementById('customerFormBilledAddress').value,
            shipped_address: document.getElementById('customerFormShippedAddress').value,
            state: document.getElementById('customerFormState').value,
            pincode: document.getElementById('customerFormPincode').value,
            company_id: currentCompanyId
        };

        if (!currentCompanyId) {
            await showWarningAlert('Please select a company first', 'companySelect', true);
            return;
        }
        if (!customer.name) {
            await showWarningAlert('Please enter customer name', 'customerFormName', true);
            return;
        }

        try {
            if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
            await window.electronAPI.saveCustomer(customer);
            closeModal('customerFormModal');
            showSuccessToast('Customer saved successfully!');
            await loadCustomers();
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Error saving customer:', error);
        showErrorAlert('Error saving customer: ' + error.message);
    }
}

async function editCustomer(id) {
    openCustomerForm(id);
}

async function deleteCustomer(id) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: 'Are you sure you want to delete this customer?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
    });
    
    if (result.isConfirmed) {
        try {
            await window.electronAPI.deleteCustomer(id);
            showSuccessToast('Customer deleted successfully!');
            // Recalculate page if needed
            const totalPages = Math.ceil(allCustomers.length / customersPerPage);
            if (currentCustomersPage > totalPages && totalPages > 0) {
                currentCustomersPage = totalPages;
            }
            await loadCustomers();
        } catch (error) {
            console.error('Error deleting customer:', error);
            showErrorAlert('Error deleting customer: ' + error.message);
        }
    }
}

/**
 * Product functions
 */
async function loadProducts() {
    try {
        allProducts = await window.electronAPI.getProducts(currentCompanyId);
        products = allProducts;
        
        currentProductsPage = 1;
        displayProducts();
    } catch (error) {
        console.error('Error loading products:', error);
        showErrorAlert('Error loading products: ' + error.message);
    }
}

function displayProducts() {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    const { startIndex, endIndex } = updatePagination(
        allProducts,
        currentProductsPage,
        productsPerPage,
        'productsPagination',
        'productsPaginationInfo',
        'btnProductsPrev',
        'btnProductsNext',
        'productsPageNumbers'
    );

    const currentPageProducts = allProducts.slice(startIndex, endIndex);

    currentPageProducts.forEach(product => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${product.name || ''}</td>
            <td>${product.hsn_code || ''}</td>
            <td>${product.unit || ''}</td>
            <td>${product.rate || 0}</td>
            <td>
                <button class="btn btn-primary btn-small" onclick="editProduct(${product.id})">Edit</button>
                <button class="btn btn-danger btn-small" onclick="deleteProduct(${product.id})">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function openProductForm(productId = null) {
    document.getElementById('productFormTitle').textContent = productId ? 'Edit Product' : 'Add Product';
    
    if (productId) {
        const product = products.find(p => p.id === productId);
        if (product) {
            document.getElementById('productFormName').value = product.name || '';
            document.getElementById('productFormHsnCode').value = product.hsn_code || '';
            document.getElementById('productFormUnit').value = product.unit || 'CBM';
            document.getElementById('productFormRate').value = product.rate || 0;
            document.getElementById('productFormName').dataset.productId = productId;
        }
    } else {
        document.getElementById('productFormName').value = '';
        document.getElementById('productFormHsnCode').value = '';
        document.getElementById('productFormUnit').value = 'CBM';
        document.getElementById('productFormRate').value = '';
        delete document.getElementById('productFormName').dataset.productId;
    }

    closeModal('productsModal');
    openModal('productFormModal');
}

async function saveProductForm() {
    try {
        const productId = document.getElementById('productFormName').dataset.productId;
        const product = {
            id: productId ? parseInt(productId) : null,
            name: document.getElementById('productFormName').value,
            hsn_code: document.getElementById('productFormHsnCode').value,
            unit: document.getElementById('productFormUnit').value,
            rate: parseFloat(document.getElementById('productFormRate').value) || 0,
            company_id: currentCompanyId
        };

        if (!currentCompanyId) {
            await showWarningAlert('Please select a company first', 'companySelect', true);
            return;
        }
        if (!product.name) {
            await showWarningAlert('Please enter product name', 'productFormName', true);
            return;
        }

        if (product.rate <= 0) {
            await showWarningAlert('Please enter a valid rate', 'productFormRate', true);
            return;
        }

        try {
            if (typeof window.beginAppLoading === 'function') window.beginAppLoading();
            await window.electronAPI.saveProduct(product);
            closeModal('productFormModal');
            showSuccessToast('Product saved successfully!');
            await loadProducts();
        } finally {
            if (typeof window.endAppLoading === 'function') window.endAppLoading();
        }
    } catch (error) {
        console.error('Error saving product:', error);
        showErrorAlert('Error saving product: ' + error.message);
    }
}

async function editProduct(id) {
    openProductForm(id);
}

async function deleteProduct(id) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: 'Are you sure you want to delete this product?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
    });
    
    if (result.isConfirmed) {
        try {
            await window.electronAPI.deleteProduct(id);
            showSuccessToast('Product deleted successfully!');
            // Recalculate page if needed
            const totalPages = Math.ceil(allProducts.length / productsPerPage);
            if (currentProductsPage > totalPages && totalPages > 0) {
                currentProductsPage = totalPages;
            }
            await loadProducts();
        } catch (error) {
            console.error('Error deleting product:', error);
            showErrorAlert('Error deleting product: ' + error.message);
        }
    }
}

/**
 * Invoice functions
 */
async function loadInvoices() {
    try {
        await fetchInvoicesList(true);
    } catch (error) {
        console.error('Error loading invoices:', error);
        showErrorAlert('Error loading invoices: ' + error.message);
    }
}

function displayInvoices() {
    const tbody = document.getElementById('invoicesTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const total = invoicesListTotal;
    const totalPages = total > 0 ? Math.ceil(total / invoicesPerPage) : 0;
    if (total === 0) {
        currentInvoicesPage = 1;
    } else if (currentInvoicesPage > totalPages) {
        currentInvoicesPage = totalPages;
    }

    const startRecord = total > 0 ? (currentInvoicesPage - 1) * invoicesPerPage + 1 : 0;
    const endRecord = total > 0 ? startRecord + allInvoices.length - 1 : 0;
    const infoEl = document.getElementById('invoicesPaginationInfo');
    if (infoEl) {
        infoEl.textContent = `Showing ${startRecord} - ${endRecord} of ${total} records`;
    }

    const prevBtn = document.getElementById('btnInvoicesPrev');
    const nextBtn = document.getElementById('btnInvoicesNext');
    if (prevBtn) prevBtn.disabled = currentInvoicesPage <= 1;
    if (nextBtn) nextBtn.disabled = totalPages === 0 || currentInvoicesPage >= totalPages;

    const pageNumbersDiv = document.getElementById('invoicesPageNumbers');
    if (pageNumbersDiv) {
        pageNumbersDiv.innerHTML = '';
        if (totalPages > 0) {
            let startPage = Math.max(1, currentInvoicesPage - 2);
            let endPage = Math.min(totalPages, startPage + 4);
            if (endPage - startPage < 4) {
                startPage = Math.max(1, endPage - 4);
            }
            const goPage = (p) => {
                currentInvoicesPage = p;
                void fetchInvoicesList(false).catch((err) => console.error('Invoices page:', err));
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
                if (i === currentInvoicesPage) {
                    pageBtn.classList.add('btn-primary');
                } else {
                    pageBtn.classList.add('btn-secondary');
                }
                pageBtn.textContent = String(i);
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
                lastBtn.textContent = String(totalPages);
                lastBtn.onclick = () => goPage(totalPages);
                pageNumbersDiv.appendChild(lastBtn);
            }
        }
    }

    const exclEl = document.getElementById('invoicesTotalExclGst');
    const inclEl = document.getElementById('invoicesTotalInclGst');
    if (exclEl) exclEl.textContent = Number(invoicesListSums.total_value || 0).toFixed(2);
    if (inclEl) inclEl.textContent = Number(invoicesListSums.total_amount || 0).toFixed(2);

    allInvoices.forEach((invoice) => {
        const row = document.createElement('tr');
        const formattedDate = formatDateDDMMYY(invoice.invoice_date);
        row.innerHTML = `
            <td>${displayInvoiceNumber(invoice.invoice_number)}</td>
            <td>${formattedDate}</td>
            <td>${invoice.customer_name || ''}</td>
            <td>${parseFloat(invoice.total_amount || 0).toFixed(2)}</td>
            <td>
                <button class="btn btn-primary btn-small" onclick="viewInvoice(${invoice.id})">Edit</button>
                <button class="btn btn-success btn-small" onclick="downloadInvoicePDF(${invoice.id})">Download PDF</button>
                <button class="btn btn-danger btn-small" onclick="deleteInvoice(${invoice.id})">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function viewInvoice(id) {
    try {
        const invoice = await window.electronAPI.getInvoice(id);
        if (!invoice) {
            await showErrorAlert('Invoice not found');
            return;
        }

        // Load invoice data into form
        currentInvoice = invoice;
        document.getElementById('invoiceNumber').value = displayInvoiceNumber(invoice.invoice_number);
        const invDate = new Date(invoice.invoice_date);
        if (invoiceDatePicker) invoiceDatePicker.setDate(invDate, false);
        else document.getElementById('invoiceDate').value = formatDateDDMMYYYY(invDate);
        document.getElementById('tpNumber').value = invoice.tp_number || '';
        document.getElementById('vehicleNumber').value = invoice.vehicle_number || '';
        document.getElementById('customerSelect').value = invoice.customer_id;
        handleCustomerSelect();

        // Load items
        invoiceItems = [];
        itemSerialNumber = 1;
        const tbody = document.getElementById('itemsTableBody');
        tbody.innerHTML = '';

        (invoice.items || []).forEach(item => {
            const qty = parseFloat(item.quantity);
            const rate = parseFloat(item.rate);
            const amt = parseFloat(item.amount);
            const qtyStr = Number.isFinite(qty) ? qty : 0;
            const rateStr = Number.isFinite(rate) ? rate : 0;
            const amtStr = (Number.isFinite(amt) ? amt : 0).toFixed(2);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${itemSerialNumber++}</td>
                <td>
                    <select class="product-select">
                        ${products.map(p => `<option value="${p.id}" ${p.id === item.product_id ? 'selected' : ''} data-rate="${p.rate}" data-hsn="${p.hsn_code || ''}">${p.name} (${p.rate})</option>`).join('')}
                    </select>
                </td>
                <td class="item-hsn">${item.hsn_code || ''}</td>
                <td><input type="number" class="item-quantity" step="1" value="${qtyStr}" min="0"></td>
                <td><input type="number" class="item-rate" step="1" value="${rateStr}" min="0"></td>
                <td class="item-amount">${amtStr}</td>
                <td><button class="btn btn-danger btn-small" onclick="removeInvoiceItem(this)">Remove</button></td>
            `;
            tbody.appendChild(row);

            // Add event listeners
            const productSelect = row.querySelector('.product-select');
            productSelect.addEventListener('change', function() {
                const selectedOption = this.options[this.selectedIndex];
                if (selectedOption.value) {
                    const rate = parseFloat(selectedOption.dataset.rate) || 0;
                    const hsn = selectedOption.dataset.hsn || '';
                    row.querySelector('.item-rate').value = rate;
                    row.querySelector('.item-hsn').textContent = hsn;
                    calculateItemAmount(row);
                }
            });

            const quantityInput = row.querySelector('.item-quantity');
            const rateInput = row.querySelector('.item-rate');
            quantityInput.addEventListener('input', () => calculateItemAmount(row));
            rateInput.addEventListener('input', () => calculateItemAmount(row));
        });

        // Load totals
        document.getElementById('sgstRate').value = invoice.sgst_rate || 2.5;
        document.getElementById('cgstRate').value = invoice.cgst_rate || 2.5;

        calculateTotals();
        updateBillingSectionMode();
        closeModal('invoicesModal');
    } catch (error) {
        console.error('Error loading invoice:', error);
        showErrorAlert('Error loading invoice: ' + error.message);
    }
}

async function deleteInvoice(id) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: 'Are you sure you want to delete this invoice?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
    });
    
    if (result.isConfirmed) {
        try {
            await window.electronAPI.deleteInvoice(id);
            showSuccessToast('Invoice deleted successfully!');
            await loadInvoices();
        } catch (error) {
            console.error('Error deleting invoice:', error);
            showErrorAlert('Error deleting invoice: ' + error.message);
        }
    }
}

// Make functions available globally for onclick handlers
window.removeInvoiceItem = removeInvoiceItem;
window.editCustomer = editCustomer;
window.deleteCustomer = deleteCustomer;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.viewInvoice = viewInvoice;
window.downloadInvoicePDF = downloadInvoicePDF;
window.deleteInvoice = deleteInvoice;
window.editCompany = editCompany;

