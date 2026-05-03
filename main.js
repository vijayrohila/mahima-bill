const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('./database');
const Config = require('./config');
const apiClient = require('./api-client');

function useApi() {
  return !!(config && apiClient.useApi(config));
}
const { writeFileSync, unlinkSync } = require('fs');
const { tmpdir, homedir } = require('os');

// Keep a global reference of the window object
let mainWindow;
let db;
let config;

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false
    },
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: true
  });

  // Load the index.html file
  mainWindow.loadFile('index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development (comment out for production)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Initialize database when app is ready
 */
app.whenReady().then(async () => {
  // Initialize config
  config = new Config();
  
  // Check if database path is set
  let dbPath = config.getDatabasePath();
  
  // If no database path is set, prompt user to choose location
  if (!dbPath) {
    // Create a temporary window for the dialog if mainWindow doesn't exist yet
    let tempWindow = null;
    if (!mainWindow) {
      tempWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
    }
    
    const result = await dialog.showOpenDialog(tempWindow || mainWindow, {
      title: 'Choose Database Location',
      message: 'Please select a folder where you want to save the database file',
      properties: ['openDirectory', 'createDirectory']
    });
    
    if (tempWindow) {
      tempWindow.close();
    }
    
    if (result.canceled) {
      // User cancelled, use default location
      const userDataPath = app.getPath('userData');
      dbPath = path.join(userDataPath, 'billing.db');
      config.setDatabasePath(dbPath);
    } else {
      // User selected a directory
      dbPath = path.join(result.filePaths[0], 'billing.db');
      config.setDatabasePath(dbPath);
    }
  }
  
  // Initialize database
  try {
    db = new Database(dbPath);
    db.init();
  } catch (error) {
    console.error('Error initializing database:', error);
    // If database initialization fails, show error and use default
    const userDataPath = app.getPath('userData');
    dbPath = path.join(userDataPath, 'billing.db');
    config.setDatabasePath(dbPath);
    db = new Database(dbPath);
    db.init();
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Close database connection on app quit
app.on('before-quit', () => {
  if (db) {
    db.close();
  }
});

// IPC Handlers for secure communication with renderer process

/**
 * Get company settings
 */
ipcMain.handle('get-companies', async () => {
  if (useApi()) return apiClient.getCompanies(config);
  return db.getCompanies();
});

ipcMain.handle('get-companies-version', async () => {
  if (useApi()) {
    const companies = await apiClient.getCompanies(config);
    const count = Array.isArray(companies) ? companies.length : 0;
    let maxUpdatedAt = '';
    for (const c of (companies || [])) {
      const updated = c?.updated_at ? String(c.updated_at) : '';
      if (updated > maxUpdatedAt) maxUpdatedAt = updated;
    }
    return `${count}|${maxUpdatedAt}`;
  }
  return db.getCompaniesVersion();
});

ipcMain.handle('get-company-settings', async (event, companyId) => {
  if (useApi()) return apiClient.getCompanySettings(config, companyId);
  return db.getCompanySettings(companyId);
});

/**
 * Save company settings
 */
ipcMain.handle('save-company-settings', async (event, settings) => {
  if (useApi()) return apiClient.saveCompanySettings(config, settings);
  return db.saveCompanySettings(settings);
});

/**
 * Get all customers
 */
ipcMain.handle('get-customers', async (event, companyId) => {
  if (useApi()) return apiClient.getCustomers(config, companyId);
  return db.getCustomers(companyId);
});

/**
 * Save customer (create or update)
 */
ipcMain.handle('save-customer', async (event, customer) => {
  if (useApi()) return apiClient.saveCustomer(config, customer);
  return db.saveCustomer(customer);
});

/**
 * Delete customer
 */
ipcMain.handle('delete-customer', async (event, id) => {
  if (useApi()) return apiClient.deleteCustomer(config, id);
  return db.deleteCustomer(id);
});

/**
 * Get all products
 */
ipcMain.handle('get-products', async (event, companyId) => {
  if (useApi()) return apiClient.getProducts(config, companyId);
  return db.getProducts(companyId);
});

/**
 * Save product (create or update)
 */
ipcMain.handle('save-product', async (event, product) => {
  if (useApi()) return apiClient.saveProduct(config, product);
  return db.saveProduct(product);
});

/**
 * Delete product
 */
ipcMain.handle('delete-product', async (event, id) => {
  if (useApi()) return apiClient.deleteProduct(config, id);
  return db.deleteProduct(id);
});

/**
 * Get all invoices
 */
ipcMain.handle('get-invoices', async (event, companyId, options) => {
  if (useApi()) return apiClient.getInvoices(config, companyId, options || {});
  return db.getInvoices(companyId, options || {});
});

ipcMain.handle('get-invoices-meta', async (event, companyId) => {
  if (useApi()) return apiClient.getInvoicesMeta(config, companyId);
  return db.getInvoicesMeta(companyId);
});

ipcMain.handle('get-company-data-version', async (event, companyId) => {
  if (useApi()) {
    if (!companyId) return '';
    const [customers, products, invMeta] = await Promise.all([
      apiClient.getCustomers(config, companyId),
      apiClient.getProducts(config, companyId),
      apiClient.getInvoicesMeta(config, companyId),
    ]);
    const getVersion = (rows) => {
      const count = Array.isArray(rows) ? rows.length : 0;
      let maxUpdatedAt = '';
      for (const row of (rows || [])) {
        const updated = row?.updated_at ? String(row.updated_at) : '';
        if (updated > maxUpdatedAt) maxUpdatedAt = updated;
      }
      return `${count}|${maxUpdatedAt}`;
    };
    const invPart = `${Number(invMeta?.count) || 0}|${invMeta?.max_updated_at ? String(invMeta.max_updated_at) : ''}`;
    return [getVersion(customers), getVersion(products), invPart].join('#');
  }
  return db.getCompanyDataVersion(companyId);
});

/**
 * Get invoice by ID
 */
ipcMain.handle('get-invoice', async (event, id) => {
  if (useApi()) return apiClient.getInvoice(config, id);
  return db.getInvoice(id);
});

/**
 * Save invoice (create or update)
 */
ipcMain.handle('save-invoice', async (event, invoice) => {
  if (useApi()) return apiClient.saveInvoice(config, invoice);
  return db.saveInvoice(invoice);
});

/**
 * Delete invoice
 */
ipcMain.handle('delete-invoice', async (event, id) => {
  if (useApi()) return apiClient.deleteInvoice(config, id);
  return db.deleteInvoice(id);
});

/**
 * Get next invoice number
 */
ipcMain.handle('get-next-invoice-number', async (event, companyId, invoiceDateISO) => {
  if (useApi()) return apiClient.getNextInvoiceNumber(config, companyId, invoiceDateISO);
  return db.getNextInvoiceNumber(companyId, invoiceDateISO);
});

ipcMain.handle('invoice-number-exists-in-fy', async (event, companyId, storedInvoiceNumber, invoiceDateISO, excludeInvoiceId) => {
  if (useApi()) {
    return apiClient.invoiceNumberExistsInFY(
      config,
      companyId,
      storedInvoiceNumber,
      invoiceDateISO,
      excludeInvoiceId
    );
  }
  return db.invoiceNumberExistsInFinancialYear(companyId, storedInvoiceNumber, invoiceDateISO, excludeInvoiceId);
});

ipcMain.handle('get-invoice-count', async (event, companyId) => {
  if (useApi()) return apiClient.getInvoiceCount(config, companyId);
  return db.getInvoiceCount(companyId);
});

ipcMain.handle('increment-invoice-count', async (event, companyId) => {
  if (useApi()) return apiClient.incrementInvoiceCount(config, companyId);
  return db.incrementInvoiceCount(companyId);
});

ipcMain.handle('reset-invoice-count', async (event, companyId) => {
  if (useApi()) return apiClient.resetInvoiceCount(config, companyId);
  return db.resetInvoiceCount(companyId);
});

ipcMain.handle('set-invoice-count', async (event, companyId, count) => {
  if (useApi()) return apiClient.setInvoiceCount(config, companyId, count);
  return db.setInvoiceCount(companyId, count);
});

/**
 * Get all sheets (scoped by company)
 */
ipcMain.handle('get-sheets', async (event, companyId, options) => {
  if (useApi()) return apiClient.getSheets(config, companyId, options || {});
  return db.getSheets(companyId, options || {});
});

/**
 * Get sheet by ID
 */
ipcMain.handle('get-sheet', async (event, id) => {
  if (useApi()) return apiClient.getSheet(config, id);
  return db.getSheet(id);
});

/**
 * Get sheet by invoice number (scoped by company)
 */
ipcMain.handle('get-sheet-by-invoice-no', async (event, invoiceNo, excludeId, companyId) => {
  if (useApi()) return apiClient.getSheetByInvoiceNo(config, invoiceNo, excludeId, companyId);
  return db.getSheetByInvoiceNo(invoiceNo, excludeId, companyId);
});

/**
 * Save sheet (create or update)
 */
ipcMain.handle('save-sheet', async (event, sheet) => {
  if (useApi()) return apiClient.saveSheet(config, sheet);
  return db.saveSheet(sheet);
});

ipcMain.handle('get-sheet-payments', async (event, companyId, options) => {
  if (useApi()) return apiClient.getSheetPayments(config, companyId, options || {});
  throw new Error('RCC payments are available only in API mode.');
});

ipcMain.handle('save-sheet-payment', async (event, payment) => {
  if (useApi()) return apiClient.saveSheetPayment(config, payment);
  throw new Error('RCC payments are available only in API mode.');
});

ipcMain.handle('delete-sheet-payment', async (event, id) => {
  if (useApi()) return apiClient.deleteSheetPayment(config, id);
  throw new Error('RCC payments are available only in API mode.');
});

ipcMain.handle('get-customer-payments', async (event, companyId, options) => {
  if (useApi()) return apiClient.getCustomerPayments(config, companyId, options || {});
  return db.getCustomerPayments(companyId, options || {});
});

ipcMain.handle('save-customer-payment', async (event, payment) => {
  if (useApi()) return apiClient.saveCustomerPayment(config, payment);
  return db.saveCustomerPayment(payment);
});

ipcMain.handle('delete-customer-payment', async (event, id) => {
  if (useApi()) return apiClient.deleteCustomerPayment(config, id);
  return db.deleteCustomerPayment(id);
});

ipcMain.handle('api-login', async (event, email, password) => {
  return apiClient.apiLogin(config, email, password);
});

ipcMain.handle('api-logout', async () => {
  config.clearApiToken();
  return { ok: true };
});

ipcMain.handle('api-get-status', async () => ({
  baseUrl: config.getApiBaseUrl(),
  hasToken: !!config.getApiToken(),
}));

ipcMain.handle('api-change-password', async (event, currentPassword, newPassword, confirmPassword) => {
  return apiClient.changePassword(config, currentPassword, newPassword, confirmPassword);
});

function buildLocalMysqlScript() {
  const sqlValue = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    const s = String(v).replace(/\\/g, '\\\\').replace(/'/g, "''");
    return `'${s}'`;
  };

  const lines = [];
  lines.push('-- Local DB to MySQL preview script');
  lines.push('START TRANSACTION;');

  const companies = db.getCompanies();
  for (const c of companies) {
    lines.push(
      `INSERT INTO company_settings (id, company_name, gstin, mobile, address, email, bank_name, account_number, ifsc_code, terms_conditions, invoice_count, created_at, updated_at) VALUES (` +
      `${sqlValue(c.id)}, ${sqlValue(c.company_name)}, ${sqlValue(c.gstin)}, ${sqlValue(c.mobile)}, ${sqlValue(c.address)}, ${sqlValue(c.email)}, ${sqlValue(c.bank_name)}, ${sqlValue(c.account_number)}, ${sqlValue(c.ifsc_code)}, ${sqlValue(c.terms_conditions)}, ${sqlValue(c.invoice_count)}, ${sqlValue(c.created_at)}, ${sqlValue(c.updated_at)}` +
      `) ON DUPLICATE KEY UPDATE company_name=VALUES(company_name), gstin=VALUES(gstin), mobile=VALUES(mobile), address=VALUES(address), email=VALUES(email), bank_name=VALUES(bank_name), account_number=VALUES(account_number), ifsc_code=VALUES(ifsc_code), terms_conditions=VALUES(terms_conditions), invoice_count=VALUES(invoice_count), updated_at=VALUES(updated_at);`
    );
  }

  for (const company of companies) {
    const customers = db.getCustomers(company.id);
    for (const c of customers) {
      lines.push(
        `INSERT INTO customers (id, company_id, name, gstin, mobile, address, billed_address, shipped_address, state, pincode, created_at, updated_at) VALUES (` +
        `${sqlValue(c.id)}, ${sqlValue(c.company_id)}, ${sqlValue(c.name)}, ${sqlValue(c.gstin)}, ${sqlValue(c.mobile)}, ${sqlValue(c.address)}, ${sqlValue(c.billed_address)}, ${sqlValue(c.shipped_address)}, ${sqlValue(c.state)}, ${sqlValue(c.pincode)}, ${sqlValue(c.created_at)}, ${sqlValue(c.updated_at)}` +
        `) ON DUPLICATE KEY UPDATE company_id=VALUES(company_id), name=VALUES(name), gstin=VALUES(gstin), mobile=VALUES(mobile), address=VALUES(address), billed_address=VALUES(billed_address), shipped_address=VALUES(shipped_address), state=VALUES(state), pincode=VALUES(pincode), updated_at=VALUES(updated_at);`
      );
    }

    const products = db.getProducts(company.id);
    for (const p of products) {
      lines.push(
        `INSERT INTO products (id, company_id, name, hsn_code, unit, rate, created_at, updated_at) VALUES (` +
        `${sqlValue(p.id)}, ${sqlValue(p.company_id)}, ${sqlValue(p.name)}, ${sqlValue(p.hsn_code)}, ${sqlValue(p.unit)}, ${sqlValue(p.rate)}, ${sqlValue(p.created_at)}, ${sqlValue(p.updated_at)}` +
        `) ON DUPLICATE KEY UPDATE company_id=VALUES(company_id), name=VALUES(name), hsn_code=VALUES(hsn_code), unit=VALUES(unit), rate=VALUES(rate), updated_at=VALUES(updated_at);`
      );
    }

    const invoices = db.getInvoices(company.id, { fetch_all: true }).data;
    for (const inv of invoices) {
      const full = db.getInvoice(inv.id);
      if (!full) continue;
      lines.push(
        `INSERT INTO invoices (id, company_id, invoice_number, invoice_date, tp_number, vehicle_number, customer_id, payment_mode, total_value, royalty_on_weight, dmft_on_royalty, reverse_charge, sgst_rate, sgst_amount, cgst_rate, cgst_amount, igst_rate, igst_amount, total_amount, fy_start_year, company_name, company_gstin, company_mobile, company_address, company_email, company_bank_name, company_account_number, company_ifsc_code, customer_name, customer_address, customer_billed_address, customer_shipped_address, customer_state, customer_gstin, customer_mobile, created_at, updated_at) VALUES (` +
        `${sqlValue(full.id)}, ${sqlValue(full.company_id)}, ${sqlValue(full.invoice_number)}, ${sqlValue(full.invoice_date)}, ${sqlValue(full.tp_number)}, ${sqlValue(full.vehicle_number)}, ${sqlValue(full.customer_id)}, ${sqlValue(full.payment_mode)}, ${sqlValue(full.total_value)}, ${sqlValue(full.royalty_on_weight)}, ${sqlValue(full.dmft_on_royalty)}, ${sqlValue(full.reverse_charge)}, ${sqlValue(full.sgst_rate)}, ${sqlValue(full.sgst_amount)}, ${sqlValue(full.cgst_rate)}, ${sqlValue(full.cgst_amount)}, ${sqlValue(full.igst_rate)}, ${sqlValue(full.igst_amount)}, ${sqlValue(full.total_amount)}, ${sqlValue(full.fy_start_year)}, ${sqlValue(full.company_name)}, ${sqlValue(full.company_gstin)}, ${sqlValue(full.company_mobile)}, ${sqlValue(full.company_address)}, ${sqlValue(full.company_email)}, ${sqlValue(full.company_bank_name)}, ${sqlValue(full.company_account_number)}, ${sqlValue(full.company_ifsc_code)}, ${sqlValue(full.customer_name)}, ${sqlValue(full.customer_address)}, ${sqlValue(full.customer_billed_address)}, ${sqlValue(full.customer_shipped_address)}, ${sqlValue(full.customer_state)}, ${sqlValue(full.customer_gstin)}, ${sqlValue(full.customer_mobile)}, ${sqlValue(full.created_at)}, ${sqlValue(full.updated_at)}` +
        `) ON DUPLICATE KEY UPDATE company_id=VALUES(company_id), invoice_number=VALUES(invoice_number), invoice_date=VALUES(invoice_date), customer_id=VALUES(customer_id), total_amount=VALUES(total_amount), updated_at=VALUES(updated_at);`
      );
      for (const item of (full.items || [])) {
        lines.push(
          `INSERT INTO invoice_items (id, invoice_id, product_id, serial_number, quantity, rate, amount, created_at, updated_at) VALUES (` +
          `${sqlValue(item.id)}, ${sqlValue(full.id)}, ${sqlValue(item.product_id)}, ${sqlValue(item.serial_number)}, ${sqlValue(item.quantity)}, ${sqlValue(item.rate)}, ${sqlValue(item.amount)}, ${sqlValue(item.created_at)}, ${sqlValue(item.updated_at)}` +
          `) ON DUPLICATE KEY UPDATE invoice_id=VALUES(invoice_id), product_id=VALUES(product_id), serial_number=VALUES(serial_number), quantity=VALUES(quantity), rate=VALUES(rate), amount=VALUES(amount), updated_at=VALUES(updated_at);`
        );
      }
    }

    const sheets = db.getSheets(company.id, { fetch_all: true }).data;
    for (const s of sheets) {
      lines.push(
        `INSERT INTO sheets (id, company_id, invoice_no, product_id, weight, truck_number, ralti, rate, b_rate, gst, amount, amount_with_gst, date, created_at, updated_at) VALUES (` +
        `${sqlValue(s.id)}, ${sqlValue(s.company_id)}, ${sqlValue(s.invoice_no)}, ${sqlValue(s.product_id)}, ${sqlValue(s.weight)}, ${sqlValue(s.truck_number)}, ${sqlValue(s.ralti)}, ${sqlValue(s.rate)}, ${sqlValue(s.b_rate)}, ${sqlValue(s.gst)}, ${sqlValue(s.amount)}, ${sqlValue(s.amount_with_gst)}, ${sqlValue(s.date)}, ${sqlValue(s.created_at)}, ${sqlValue(s.updated_at)}` +
        `) ON DUPLICATE KEY UPDATE company_id=VALUES(company_id), invoice_no=VALUES(invoice_no), product_id=VALUES(product_id), weight=VALUES(weight), truck_number=VALUES(truck_number), ralti=VALUES(ralti), rate=VALUES(rate), b_rate=VALUES(b_rate), gst=VALUES(gst), amount=VALUES(amount), amount_with_gst=VALUES(amount_with_gst), date=VALUES(date), updated_at=VALUES(updated_at);`
      );
    }
  }

  lines.push('COMMIT;');
  return lines.join('\n');
}

ipcMain.handle('sync-preview-local-mysql-query', async () => {
  return buildLocalMysqlScript();
});

ipcMain.handle('sync-download-local-mysql-query', async () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save SQL File',
    defaultPath: `local-to-mysql-${y}${m}${d}.sql`,
    filters: [{ name: 'SQL Files', extensions: ['sql'] }],
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }
  writeFileSync(result.filePath, buildLocalMysqlScript(), 'utf8');
  return { ok: true, path: result.filePath };
});

/**
 * Print invoice
 */
ipcMain.handle('print-invoice', async (event, printHTML) => {
  return new Promise(async (resolve, reject) => {

    const tempFilePath = path.join(tmpdir(), `invoice-${Date.now()}.html`);
    
    try {
      writeFileSync(tempFilePath, printHTML, 'utf8');

      const printWindow = new BrowserWindow({
        show: true,
        width: 1400,
        height: 900,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false
        }
      });

      let data = fs.readFileSync(tempFilePath, 'utf8')

      await printWindow.loadFile(tempFilePath);

      await printWindow.webContents.executeJavaScript(`
        document.fonts && document.fonts.ready
      `);

      printWindow.webContents.print(
        {
          silent: false,
          printBackground: true
        },
        (success, errorType) => {
          printWindow.close();
          try { unlinkSync(tempFilePath); } catch {}

          if (success) resolve(true);
          else reject(new Error(errorType || 'Print failed'));
        }
      );
    } catch (err) {
      reject(err);
    }
  });
});

/**
 * Get database path
 */
ipcMain.handle('get-database-path', async () => {
  return config.getDatabasePath();
});

/**
 * Choose database location
 */
ipcMain.handle('choose-database-location', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Database Location',
    message: 'Please select a folder where you want to save the database file',
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (result.canceled) {
    return { canceled: true };
  }
  
  const newDbPath = path.join(result.filePaths[0], 'billing.db');
  const oldDbPath = config.getDatabasePath();
  
  // If database exists at old location, ask if user wants to move it
  if (oldDbPath && fs.existsSync(oldDbPath)) {
    const moveResult = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Move Database', 'Keep Old Database', 'Cancel'],
      defaultId: 0,
      title: 'Database Location Change',
      message: 'A database already exists at the current location.',
      detail: `Current: ${oldDbPath}\nNew: ${newDbPath}\n\nWould you like to move the existing database to the new location?`
    });
    
    if (moveResult.response === 2) {
      // Cancel
      return { canceled: true };
    } else if (moveResult.response === 0) {
      // Move database
      try {
        // Close current database
        if (db) {
          db.close();
        }
        
        // Copy database file
        fs.copyFileSync(oldDbPath, newDbPath);
        
        // Update config
        config.setDatabasePath(newDbPath);
        
        // Reinitialize database with new path
        db = new Database(newDbPath);
        
        return { 
          success: true, 
          path: newDbPath,
          moved: true 
        };
      } catch (error) {
        console.error('Error moving database:', error);
        return { 
          success: false, 
          error: error.message 
        };
      }
    } else {
      // Keep old database - don't change anything
      return { canceled: true, message: 'Database location unchanged' };
    }
  }
  
  // Just update the path (for new database or keeping old one)
  config.setDatabasePath(newDbPath);
  
  // If database doesn't exist at new location, create it
  if (!fs.existsSync(newDbPath)) {
    try {
      // Close current database if exists
      if (db) {
        db.close();
      }
      
      // Create new database
      db = new Database(newDbPath);
      db.init();
      
      return { 
        success: true, 
        path: newDbPath,
        created: true 
      };
    } catch (error) {
      console.error('Error creating database:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  } else {
    // Database exists at new location, just switch to it
    try {
      if (db) {
        db.close();
      }
      db = new Database(newDbPath);
      return { 
        success: true, 
        path: newDbPath,
        switched: true 
      };
    } catch (error) {
      console.error('Error switching database:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
});

/**
 * Download invoice as PDF
 */
ipcMain.handle('download-pdf', async (event, printHTML) => {
  const tempFilePath = path.join(tmpdir(), `invoice-${Date.now()}.html`);
  
  try {
    writeFileSync(tempFilePath, printHTML, 'utf8');

    // Create a visible window to show the invoice
    const printWindow = new BrowserWindow({
      show: true,
      width: 1400,
      height: 900,
      title: 'Invoice Preview - PDF Download',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });

    await printWindow.loadFile(tempFilePath);

    // Wait for fonts and content to load
    await printWindow.webContents.executeJavaScript(`
      new Promise((promiseResolve) => {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => {
            setTimeout(promiseResolve, 500);
          });
        } else {
          setTimeout(promiseResolve, 500);
        }
      });
    `);

    // Generate PDF (landscape for wide customer payment table)
    const printToPdfOptions = {
      printBackground: true,
      pageSize: 'A4',
      margins: {
        top: 0.4,
        bottom: 0.4,
        left: 0.4,
        right: 0.4
      }
    };
    if (printHTML.includes('CUSTOMER PAYMENTS REPORT')) {
      printToPdfOptions.landscape = true;
    }
    const pdfData = await printWindow.webContents.printToPDF(printToPdfOptions);

    // Get filename from HTML content
    let pdfFileName;
    if (printHTML.includes('RECORDS REPORT')) {
      // Records PDF
      const dateMatch = printHTML.match(/Date:\s*(\d+\/\d+\/\d+)/);
      const dateStr = dateMatch ? dateMatch[1].replace(/\//g, '-') : new Date().toISOString().slice(0, 10);
      pdfFileName = `Records-${dateStr}.pdf`;
    } else if (printHTML.includes('CLIENT PAYMENTS REPORT')) {
      const dateStr = new Date().toISOString().slice(0, 10);
      pdfFileName = `Client-Payments-${dateStr}.pdf`;
    } else if (printHTML.includes('CUSTOMER PAYMENTS REPORT')) {
      const dateStr = new Date().toISOString().slice(0, 10);
      pdfFileName = `Customer-Payment-Report-${dateStr}.pdf`;
    } else if (printHTML.includes('ALL_INVOICES_PDF')) {
      // All invoices in single PDF
      const dateStr = new Date().toISOString().slice(0, 10);
      pdfFileName = `All-Invoices-${dateStr}.pdf`;
    } else {
      // Invoice PDF (invoice number is sequential: 01, 02, ...)
      const invoiceMatch = printHTML.match(/Invoice No\.:\s*(\d+)/);
      const invoiceNumber = invoiceMatch ? invoiceMatch[1] : `invoice-${Date.now()}`;
      pdfFileName = `Invoice-${invoiceNumber}.pdf`;
    }
    
    // Save PDF to Downloads folder
    const downloadsPath = path.join(homedir(), 'Downloads');
    const pdfFilePath = path.join(downloadsPath, pdfFileName);
    
    // Save PDF file
    writeFileSync(pdfFilePath, pdfData);

    // Close the window
    printWindow.close();

    // Clean up temp file
    try {
      unlinkSync(tempFilePath);
    } catch (err) {
      console.error('Error deleting temp file:', err);
    }

    // Open the PDF file
    shell.openPath(pdfFilePath);

    return pdfFilePath;
  } catch (err) {
    console.error('Error downloading PDF:', err);
    throw err;
  }
});

