const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose protected methods that allow the renderer process
 * to use the ipcRenderer without exposing the entire object
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Companies (multi-company)
  getCompanies: () => ipcRenderer.invoke('get-companies'),
  getCompaniesVersion: () => ipcRenderer.invoke('get-companies-version'),
  getCompanySettings: (companyId) => ipcRenderer.invoke('get-company-settings', companyId),
  saveCompanySettings: (settings) => ipcRenderer.invoke('save-company-settings', settings),

  // Customers (scoped by company)
  getCustomers: (companyId) => ipcRenderer.invoke('get-customers', companyId),
  saveCustomer: (customer) => ipcRenderer.invoke('save-customer', customer),
  deleteCustomer: (id) => ipcRenderer.invoke('delete-customer', id),

  // Products (scoped by company)
  getProducts: (companyId) => ipcRenderer.invoke('get-products', companyId),
  saveProduct: (product) => ipcRenderer.invoke('save-product', product),
  deleteProduct: (id) => ipcRenderer.invoke('delete-product', id),

  // Invoices (scoped by company)
  getInvoices: (companyId, options) => ipcRenderer.invoke('get-invoices', companyId, options),
  getInvoicesMeta: (companyId) => ipcRenderer.invoke('get-invoices-meta', companyId),
  getCompanyDataVersion: (companyId) => ipcRenderer.invoke('get-company-data-version', companyId),
  getInvoice: (id) => ipcRenderer.invoke('get-invoice', id),
  saveInvoice: (invoice) => ipcRenderer.invoke('save-invoice', invoice),
  deleteInvoice: (id) => ipcRenderer.invoke('delete-invoice', id),
  getNextInvoiceNumber: (companyId, invoiceDateISO) => ipcRenderer.invoke('get-next-invoice-number', companyId, invoiceDateISO),
  invoiceNumberExistsInFY: (companyId, storedInvoiceNumber, invoiceDateISO, excludeInvoiceId) =>
    ipcRenderer.invoke('invoice-number-exists-in-fy', companyId, storedInvoiceNumber, invoiceDateISO, excludeInvoiceId),
  getInvoiceCount: (companyId) => ipcRenderer.invoke('get-invoice-count', companyId),
  incrementInvoiceCount: (companyId) => ipcRenderer.invoke('increment-invoice-count', companyId),
  resetInvoiceCount: (companyId) => ipcRenderer.invoke('reset-invoice-count', companyId),
  setInvoiceCount: (companyId, count) => ipcRenderer.invoke('set-invoice-count', companyId, count),

  // Print
  printInvoice: (printHTML) => ipcRenderer.invoke('print-invoice', printHTML),
  
  // Download PDF
  downloadPDF: (printHTML) => ipcRenderer.invoke('download-pdf', printHTML),

  // Sheets (scoped by company)
  getSheets: (companyId, options) => ipcRenderer.invoke('get-sheets', companyId, options),
  getSheet: (id) => ipcRenderer.invoke('get-sheet', id),
  getSheetByInvoiceNo: (invoiceNo, excludeId, companyId) => ipcRenderer.invoke('get-sheet-by-invoice-no', invoiceNo, excludeId, companyId),
  saveSheet: (sheet) => ipcRenderer.invoke('save-sheet', sheet),
  getSheetPayments: (companyId, options) => ipcRenderer.invoke('get-sheet-payments', companyId, options),
  saveSheetPayment: (payment) => ipcRenderer.invoke('save-sheet-payment', payment),
  deleteSheetPayment: (id) => ipcRenderer.invoke('delete-sheet-payment', id),

  getCustomerPayments: (companyId, options) => ipcRenderer.invoke('get-customer-payments', companyId, options || {}),
  saveCustomerPayment: (payment) => ipcRenderer.invoke('save-customer-payment', payment),
  deleteCustomerPayment: (id) => ipcRenderer.invoke('delete-customer-payment', id),

  // Database Location
  getDatabasePath: () => ipcRenderer.invoke('get-database-path'),
  chooseDatabaseLocation: () => ipcRenderer.invoke('choose-database-location'),

  // Laravel API (Sanctum)
  apiLogin: (email, password) => ipcRenderer.invoke('api-login', email, password),
  apiChangePassword: (currentPassword, newPassword, confirmPassword) =>
    ipcRenderer.invoke('api-change-password', currentPassword, newPassword, confirmPassword),
  apiLogout: () => ipcRenderer.invoke('api-logout'),
  apiGetStatus: () => ipcRenderer.invoke('api-get-status'),

  // SQL export
  downloadLocalMysqlQuery: () => ipcRenderer.invoke('sync-download-local-mysql-query')
});

