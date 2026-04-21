const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

class BillingDatabase {
  constructor(dbPath = null) {
    // Use provided path or default to user data path
    if (!dbPath) {
      const userDataPath = app.getPath('userData');
      dbPath = path.join(userDataPath, 'billing.db');
    }
    
    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    console.log('Database path:', dbPath);
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
  }

  /**
   * Initialize database tables and sample data
   */
  init() {
    this.createTables();
    this.migrateInvoicesFinancialYear();
    this.insertSampleData();
  }

  /**
   * Financial year: 1 March (year Y) through end of February (year Y+1).
   * Returns calendar year Y in which that FY starts (e.g. Mar 2025–Feb 2026 → 2025).
   */
  static financialYearStartYear(isoOrDate) {
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) {
      const n = new Date();
      const y = n.getFullYear();
      return n.getMonth() >= 2 ? y : y - 1;
    }
    const y = d.getFullYear();
    return d.getMonth() >= 2 ? y : y - 1;
  }

  /**
   * Rebuild invoices table if fy_start_year missing: drop per-number global uniqueness,
   * add fy_start_year and unique (company_id, invoice_number, fy_start_year).
   */
  migrateInvoicesFinancialYear() {
    let cols;
    try {
      cols = this.db.prepare(`PRAGMA table_info(invoices)`).all();
    } catch (e) {
      return;
    }
    if (!cols || cols.length === 0) return;
    if (cols.some(c => c.name === 'fy_start_year')) {
      this.ensureInvoicesFyUniqueIndex();
      return;
    }

    const colNames = cols.map(c => c.name);
    const defs = cols.map(c => {
      if (c.name === 'id') return 'id INTEGER PRIMARY KEY AUTOINCREMENT';
      let line = `${c.name} ${c.type}`;
      if (c.notnull && !c.pk) line += ' NOT NULL';
      if (c.dflt_value != null && c.dflt_value !== undefined && String(c.dflt_value).trim() !== '') {
        line += ` DEFAULT ${c.dflt_value}`;
      }
      return line;
    });

    const createBody = `${defs.join(', ')}, fy_start_year INTEGER NOT NULL, FOREIGN KEY (customer_id) REFERENCES customers(id)`;
    const insertColList = [...colNames, 'fy_start_year'].join(', ');
    const fyExpr = `CASE WHEN CAST(strftime('%m', invoice_date) AS INTEGER) >= 3 THEN CAST(strftime('%Y', invoice_date) AS INTEGER) ELSE CAST(strftime('%Y', invoice_date) AS INTEGER) - 1 END`;

    this.db.pragma('foreign_keys = OFF');
    try {
      this.db.exec(`CREATE TABLE invoices_new (${createBody})`);
      this.db.exec(`INSERT INTO invoices_new (${insertColList}) SELECT ${colNames.join(', ')}, ${fyExpr} FROM invoices`);
      this.db.exec('DROP TABLE invoices');
      this.db.exec('ALTER TABLE invoices_new RENAME TO invoices');
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
        CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
      `);
      this.ensureInvoicesFyUniqueIndex();
    } finally {
      this.db.pragma('foreign_keys = ON');
    }
  }

  ensureInvoicesFyUniqueIndex() {
    try {
      this.db.exec('DROP INDEX IF EXISTS idx_invoices_company_number');
    } catch (e) { /* ignore */ }
    try {
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_company_number_fy ON invoices(company_id, invoice_number, fy_start_year)');
    } catch (e) { /* ignore */ }
  }

  /**
   * Create all database tables
   */
  createTables() {
    // Company Settings Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        gstin TEXT,
        mobile TEXT,
        address TEXT,
        email TEXT,
        bank_name TEXT,
        account_number TEXT,
        ifsc_code TEXT,
        terms_conditions TEXT,
        invoice_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add invoice_count column if it doesn't exist (for existing databases)
    try {
      this.db.exec(`ALTER TABLE company_settings ADD COLUMN invoice_count INTEGER DEFAULT 0`);
    } catch (e) {
      // Column already exists, ignore error
    }

    // Add company & customer snapshot columns to invoices (for existing databases)
    const invoiceSnapshotColumns = [
      'company_name TEXT', 'company_gstin TEXT', 'company_mobile TEXT', 'company_address TEXT',
      'company_email TEXT', 'company_bank_name TEXT', 'company_account_number TEXT', 'company_ifsc_code TEXT',
      'customer_name TEXT', 'customer_address TEXT', 'customer_billed_address TEXT', 'customer_shipped_address TEXT', 'customer_state TEXT', 'customer_gstin TEXT', 'customer_mobile TEXT'
    ];
    invoiceSnapshotColumns.forEach(col => {
      const colName = col.split(' ')[0];
      try {
        this.db.exec(`ALTER TABLE invoices ADD COLUMN ${colName} ${col.split(' ').slice(1).join(' ')}`);
      } catch (e) {
        // Column already exists, ignore
      }
    });

    // Add company_id to customers, products, invoices (multi-company)
    try {
      this.db.exec(`ALTER TABLE customers ADD COLUMN company_id INTEGER`);
    } catch (e) {}
    try {
      this.db.exec(`ALTER TABLE products ADD COLUMN company_id INTEGER`);
    } catch (e) {}
    try {
      this.db.exec(`ALTER TABLE invoices ADD COLUMN company_id INTEGER`);
    } catch (e) {}
    try {
      this.db.exec(`ALTER TABLE customers ADD COLUMN billed_address TEXT`);
    } catch (e) {}
    try {
      this.db.exec(`ALTER TABLE customers ADD COLUMN shipped_address TEXT`);
    } catch (e) {}
    try {
      this.db.exec(`UPDATE customers SET billed_address = address WHERE billed_address IS NULL OR billed_address = ''`);
    } catch (e) {}
    try {
      this.db.exec(`UPDATE customers SET shipped_address = COALESCE(NULLIF(shipped_address, ''), NULLIF(billed_address, ''), address) WHERE shipped_address IS NULL OR shipped_address = ''`);
    } catch (e) {}

    // Migrate existing data: set company_id to first company
    var firstCompany = this.db.prepare('SELECT id FROM company_settings ORDER BY id ASC LIMIT 1').get();
    if (firstCompany) {
      try {
        this.db.prepare('UPDATE customers SET company_id = ? WHERE company_id IS NULL').run(firstCompany.id);
        this.db.prepare('UPDATE products SET company_id = ? WHERE company_id IS NULL').run(firstCompany.id);
        this.db.prepare('UPDATE invoices SET company_id = ? WHERE company_id IS NULL').run(firstCompany.id);
      } catch (e) {}
    }

    // Customers Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        gstin TEXT,
        mobile TEXT,
        address TEXT,
        billed_address TEXT,
        shipped_address TEXT,
        state TEXT,
        pincode TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Products Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        hsn_code TEXT,
        unit TEXT DEFAULT 'CBM',
        rate REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Invoices Table (invoice_number unique per company per financial year, not globally)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT NOT NULL,
        invoice_date DATETIME NOT NULL,
        tp_number TEXT,
        vehicle_number TEXT,
        customer_id INTEGER NOT NULL,
        payment_mode TEXT DEFAULT 'CASH',
        total_value REAL DEFAULT 0,
        royalty_on_weight REAL DEFAULT 0,
        dmft_on_royalty REAL DEFAULT 0,
        reverse_charge REAL DEFAULT 0,
        sgst_rate REAL DEFAULT 0,
        sgst_amount REAL DEFAULT 0,
        cgst_rate REAL DEFAULT 0,
        cgst_amount REAL DEFAULT 0,
        igst_rate REAL DEFAULT 0,
        igst_amount REAL DEFAULT 0,
        total_amount REAL DEFAULT 0,
        fy_start_year INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      )
    `);

    // Invoice Items Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        serial_number INTEGER NOT NULL,
        quantity REAL NOT NULL,
        rate REAL NOT NULL,
        amount REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    // Sheets Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sheets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE NOT NULL,
        product_id INTEGER NOT NULL,
        weight REAL DEFAULT 0,
        truck_number TEXT,
        ralti TEXT DEFAULT 'No',
        rate REAL DEFAULT 0,
        b_rate REAL DEFAULT 0,
        gst REAL DEFAULT 5,
        amount REAL DEFAULT 0,
        amount_with_gst REAL DEFAULT 0,
        date DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
    
    // Add new columns to existing tables if they don't exist
    try {
      this.db.exec(`ALTER TABLE sheets ADD COLUMN rate REAL DEFAULT 0`);
    } catch (e) {
      // Column already exists, ignore error
    }
    try {
      this.db.exec(`ALTER TABLE sheets ADD COLUMN gst REAL DEFAULT 5`);
    } catch (e) {
      // Column already exists, ignore error
    }
    try {
      this.db.exec(`ALTER TABLE sheets ADD COLUMN amount_with_gst REAL DEFAULT 0`);
    } catch (e) {
      // Column already exists, ignore error
    }
    try {
      this.db.exec(`ALTER TABLE sheets ADD COLUMN b_rate REAL DEFAULT 0`);
    } catch (e) {
      // Column already exists, ignore error
    }

    // Add company_id to sheets (multi-company RCC)
    try {
      this.db.exec(`ALTER TABLE sheets ADD COLUMN company_id INTEGER`);
    } catch (e) {}
    var firstCompany = this.db.prepare('SELECT id FROM company_settings ORDER BY id ASC LIMIT 1').get();
    if (firstCompany) {
      try {
        this.db.prepare('UPDATE sheets SET company_id = ? WHERE company_id IS NULL').run(firstCompany.id);
      } catch (e) {}
    }

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
      CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
      CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
      CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id);
      CREATE INDEX IF NOT EXISTS idx_sheets_product ON sheets(product_id);
      CREATE INDEX IF NOT EXISTS idx_sheets_date ON sheets(date);
      CREATE INDEX IF NOT EXISTS idx_sheets_company ON sheets(company_id);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        operation TEXT NOT NULL,
        local_id INTEGER NOT NULL,
        payload_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_id_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        local_id INTEGER NOT NULL,
        remote_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(entity_type, local_id)
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, id);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, local_id);
      CREATE INDEX IF NOT EXISTS idx_sync_id_map_remote ON sync_id_map(entity_type, remote_id);
    `);
    try {
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sheets_company_invoice ON sheets(company_id, invoice_no)`);
    } catch (e) {}
    // Per-company invoice number: unique (company_id, invoice_number)
    try {
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_company_number_fy ON invoices(company_id, invoice_number, fy_start_year)`);
    } catch (e) {}
  }

  /**
   * Insert sample data
   */
  insertSampleData() {
    // Check if data already exists
    const companyExists = this.db.prepare('SELECT COUNT(*) as count FROM company_settings').get();
    if (companyExists.count > 0) return;

    // Insert Company Settings (based on invoice)
    const companyResult = this.db.prepare(`
      INSERT INTO company_settings (company_name, gstin, mobile, address, email, bank_name, account_number, ifsc_code, terms_conditions, invoice_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'M/s Mahima Traders',
      '09QFA0291C3ZH',
      '9997569982',
      'Chander Vihar Colony, Gangoh Road, Saharanpur - 247001',
      'ravinderrohila073@gmail.com',
      'Shivalik Mercantile Coop. Bank',
      '101712002279',
      'SMCB0001017',
      '1. Goods once supplied will not be taken back.\n2. All disputes are subject to Saharanpur Jurisdiction only.',
      0
    );
    const companyId = companyResult.lastInsertRowid;

    // Insert Sample Customer (based on invoice)
    const customerId = this.db.prepare(`
      INSERT INTO customers (name, gstin, address, state, pincode, company_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'HABIBULLAH TRADERS',
      '09CQFPA7180L1ZJ',
      '0, Khera Mawat, Purana Kalsia Road, Khera Mawat, Saharanpur, Uttar Pradesh',
      'Uttar Pradesh',
      '247231',
      companyId
    ).lastInsertRowid;

    // Insert Sample Product (based on invoice)
    const productId = this.db.prepare(`
      INSERT INTO products (name, hsn_code, unit, rate, company_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      '40MM',
      '25171010',
      'CBM',
      820,
      companyId
    ).lastInsertRowid;

    // Insert Sample Invoice
    const invoiceDate = new Date('2025-12-23 09:34:49').toISOString();
    const sampleFy = BillingDatabase.financialYearStartYear(invoiceDate);
    const invoiceId = this.db.prepare(`
      INSERT INTO invoices (
        invoice_number, invoice_date, vehicle_number, customer_id, payment_mode,
        total_value, sgst_rate, sgst_amount, cgst_rate, cgst_amount,
        igst_rate, igst_amount, total_amount, company_id, fy_start_year
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      '25-26-2792',
      invoiceDate,
      'HR58E6003',
      customerId,
      'CASH',
      14760,
      2.5,
      369,
      2.5,
      369,
      0,
      0,
      15498,
      companyId,
      sampleFy
    ).lastInsertRowid;

    // Insert Sample Invoice Item
    this.db.prepare(`
      INSERT INTO invoice_items (invoice_id, product_id, serial_number, quantity, rate, amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      productId,
      1,
      18,
      820,
      14760
    );
  }

  /**
   * Company Settings Methods (multi-company)
   */
  getCompanies() {
    return this.db.prepare('SELECT * FROM company_settings ORDER BY company_name').all();
  }

  getCompaniesVersion() {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), '') AS m
      FROM company_settings
    `).get();
    return `${row?.c || 0}|${row?.m || ''}`;
  }

  getCompanySettings(companyId) {
    if (!companyId) return null;
    const settings = this.db.prepare('SELECT * FROM company_settings WHERE id = ?').get(companyId);
    return settings || null;
  }

  saveCompanySettings(settings) {
    if (settings.id) {
      const existing = this.getCompanySettings(settings.id);
      if (existing) {
        this.db.prepare(`
          UPDATE company_settings SET
            company_name = ?, gstin = ?, mobile = ?, address = ?, email = ?,
            bank_name = ?, account_number = ?, ifsc_code = ?, terms_conditions = ?,
            invoice_count = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          settings.company_name, settings.gstin, settings.mobile, settings.address, settings.email,
          settings.bank_name, settings.account_number, settings.ifsc_code, settings.terms_conditions,
          settings.invoice_count !== undefined ? settings.invoice_count : existing.invoice_count || 0,
          settings.id
        );
        return settings.id;
      }
    }
    const result = this.db.prepare(`
      INSERT INTO company_settings (company_name, gstin, mobile, address, email, bank_name, account_number, ifsc_code, terms_conditions, invoice_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      settings.company_name || '', settings.gstin || '', settings.mobile || '', settings.address || '', settings.email || '',
      settings.bank_name || '', settings.account_number || '', settings.ifsc_code || '', settings.terms_conditions || '',
      settings.invoice_count !== undefined ? settings.invoice_count : 0
    );
    return result.lastInsertRowid;
  }
  
  incrementInvoiceCount(companyId) {
    const existing = this.getCompanySettings(companyId);
    if (existing) {
      const newCount = (existing.invoice_count || 0) + 1;
      this.db.prepare(`
        UPDATE company_settings SET
          invoice_count = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newCount, existing.id);
      return newCount;
    }
    return 0;
  }
  
  getInvoiceCount(companyId) {
    const settings = this.getCompanySettings(companyId);
    return settings ? (settings.invoice_count || 0) : 0;
  }

  resetInvoiceCount(companyId) {
    const existing = this.getCompanySettings(companyId);
    if (existing) {
      this.db.prepare(`
        UPDATE company_settings SET
          invoice_count = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(existing.id);
      return 0;
    }
    return 0;
  }

  /**
   * Set next invoice number by setting invoice_count (next displayed = count + 1, e.g. count 5 → 06)
   */
  setInvoiceCount(companyId, count) {
    const existing = this.getCompanySettings(companyId);
    if (existing) {
      const value = Math.max(0, parseInt(count, 10) || 0);
      this.db.prepare(`
        UPDATE company_settings SET
          invoice_count = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(value, existing.id);
      return value;
    }
    return null;
  }

  /**
   * Customer Methods (scoped by company_id)
   */
  getCustomers(companyId) {
    if (!companyId) return [];
    return this.db.prepare('SELECT * FROM customers WHERE company_id = ? ORDER BY name').all(companyId);
  }

  getCompanyDataVersion(companyId) {
    if (!companyId) return '';
    const customerRow = this.db.prepare(`
      SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), '') AS m
      FROM customers
      WHERE company_id = ?
    `).get(companyId);
    const productRow = this.db.prepare(`
      SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), '') AS m
      FROM products
      WHERE company_id = ?
    `).get(companyId);
    const invMeta = this.getInvoicesMeta(companyId);
    return [
      `${customerRow?.c || 0}|${customerRow?.m || ''}`,
      `${productRow?.c || 0}|${productRow?.m || ''}`,
      `${invMeta.count || 0}|${invMeta.max_updated_at || ''}`,
    ].join('#');
  }

  saveCustomer(customer) {
    if (customer.id) {
      return this.db.prepare(`
        UPDATE customers SET
          name = ?, gstin = ?, mobile = ?, address = ?, billed_address = ?, shipped_address = ?, state = ?, pincode = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        customer.name, customer.gstin, customer.mobile, customer.address,
        customer.billed_address ?? customer.address, customer.shipped_address ?? customer.billed_address ?? customer.address,
        customer.state, customer.pincode, customer.id
      );
    } else {
      return this.db.prepare(`
        INSERT INTO customers (name, gstin, mobile, address, billed_address, shipped_address, state, pincode, company_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        customer.name, customer.gstin, customer.mobile, customer.address,
        customer.billed_address ?? customer.address, customer.shipped_address ?? customer.billed_address ?? customer.address,
        customer.state, customer.pincode, customer.company_id
      );
    }
  }

  deleteCustomer(id) {
    return this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  }

  /**
   * Product Methods (scoped by company_id)
   */
  getProducts(companyId) {
    if (!companyId) return [];
    return this.db.prepare('SELECT * FROM products WHERE company_id = ? ORDER BY name').all(companyId);
  }

  saveProduct(product) {
    if (product.id) {
      return this.db.prepare(`
        UPDATE products SET
          name = ?, hsn_code = ?, unit = ?, rate = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        product.name, product.hsn_code, product.unit, product.rate, product.id
      );
    } else {
      return this.db.prepare(`
        INSERT INTO products (name, hsn_code, unit, rate, company_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        product.name, product.hsn_code, product.unit, product.rate, product.company_id
      );
    }
  }

  deleteProduct(id) {
    return this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
  }

  /**
   * Invoice Methods (scoped by company_id)
   */
  getInvoicesMeta(companyId) {
    if (!companyId) return { count: 0, max_updated_at: null };
    const row = this.db.prepare(`
      SELECT COUNT(*) AS c, MAX(updated_at) AS m
      FROM invoices
      WHERE company_id = ?
    `).get(companyId);
    return {
      count: row?.c != null ? Number(row.c) : 0,
      max_updated_at: row?.m != null ? String(row.m) : null,
    };
  }

  getInvoices(companyId, options = {}) {
    if (!companyId) {
      return {
        data: [],
        meta: { total: 0, current_page: 1, per_page: 25, last_page: 0 },
        sums: { total_value: 0, total_amount: 0 },
      };
    }
    const opts = options || {};
    const fetchAll = !!opts.fetch_all;
    const page = Math.max(1, parseInt(String(opts.page), 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(String(opts.per_page), 10) || 25));

    const conditions = ['i.company_id = ?'];
    const params = [companyId];
    if (opts.date_from) {
      conditions.push('date(i.invoice_date) >= date(?)');
      params.push(opts.date_from);
    }
    if (opts.date_to) {
      conditions.push('date(i.invoice_date) <= date(?)');
      params.push(opts.date_to);
    }
    const whereClause = conditions.join(' AND ');

    const sumRow = this.db.prepare(`
      SELECT COALESCE(SUM(i.total_value), 0) AS total_value, COALESCE(SUM(i.total_amount), 0) AS total_amount
      FROM invoices i
      WHERE ${whereClause}
    `).get(...params);

    const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS c FROM invoices i WHERE ${whereClause}
    `).get(...params);
    const total = totalRow?.c != null ? Number(totalRow.c) : 0;

    let limitClause = '';
    if (!fetchAll) {
      const offset = (page - 1) * perPage;
      limitClause = ` LIMIT ${Number(perPage)} OFFSET ${Number(offset)}`;
    }

    const data = this.db.prepare(`
      SELECT i.*, c.name as customer_name
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE ${whereClause}
      ORDER BY CAST(
        CASE WHEN INSTR(i.invoice_number, '-') > 0
          THEN SUBSTR(i.invoice_number, INSTR(i.invoice_number, '-') + 1)
          ELSE i.invoice_number
        END AS INTEGER
      ) DESC, i.invoice_date DESC
      ${limitClause}
    `).all(...params);

    const perPageEffective = fetchAll ? Math.max(1, total || 1) : perPage;
    const lastPage = total > 0 ? (fetchAll ? 1 : Math.ceil(total / perPage)) : 0;

    return {
      data,
      meta: {
        total,
        current_page: fetchAll ? 1 : page,
        per_page: perPageEffective,
        last_page: lastPage,
      },
      sums: {
        total_value: sumRow?.total_value != null ? Number(sumRow.total_value) : 0,
        total_amount: sumRow?.total_amount != null ? Number(sumRow.total_amount) : 0,
      },
    };
  }

  getInvoice(id) {
    const invoice = this.db.prepare(`
      SELECT i.*,
             c.name as customer_name_join, c.gstin as customer_gstin_join,
             c.address as customer_address_join, c.billed_address as customer_billed_address_join,
             c.shipped_address as customer_shipped_address_join, c.state as customer_state_join,
             c.mobile as customer_mobile_join
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE i.id = ?
    `).get(id);

    if (!invoice) return null;

    // Get invoice items
    invoice.items = this.db.prepare(`
      SELECT ii.*, p.name as product_name, p.hsn_code
      FROM invoice_items ii
      LEFT JOIN products p ON ii.product_id = p.id
      WHERE ii.invoice_id = ?
      ORDER BY ii.serial_number
    `).all(id);

    return invoice;
  }

  /**
   * Max numeric suffix used for invoice numbers in a company's financial year (for suggested next #).
   */
  maxInvoiceSuffixInFinancialYear(companyId, fyStartYear) {
    if (!companyId) return 0;
    const prefix = `${companyId}-`;
    const rows = this.db.prepare(`
      SELECT invoice_number FROM invoices
      WHERE company_id = ? AND fy_start_year = ?
    `).all(companyId, fyStartYear);
    let maxN = 0;
    for (const r of rows) {
      const num = r.invoice_number || '';
      let suffix = num;
      if (num.startsWith(prefix)) suffix = num.slice(prefix.length);
      const n = parseInt(String(suffix).trim(), 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
    return maxN;
  }

  invoiceNumberExistsInFinancialYear(companyId, storedInvoiceNumber, invoiceDateISO, excludeInvoiceId) {
    if (!companyId || !storedInvoiceNumber || !invoiceDateISO) return false;
    const fy = BillingDatabase.financialYearStartYear(invoiceDateISO);
    let row;
    if (excludeInvoiceId) {
      row = this.db.prepare(`
        SELECT id FROM invoices
        WHERE company_id = ? AND invoice_number = ? AND fy_start_year = ? AND id != ?
      `).get(companyId, storedInvoiceNumber, fy, excludeInvoiceId);
    } else {
      row = this.db.prepare(`
        SELECT id FROM invoices
        WHERE company_id = ? AND invoice_number = ? AND fy_start_year = ?
      `).get(companyId, storedInvoiceNumber, fy);
    }
    return !!row;
  }

  saveInvoice(invoice) {
    const transaction = this.db.transaction((invoice) => {
      let invoiceId;

      const snap = (key) => invoice[key] ?? null;
      const fyStartYear = BillingDatabase.financialYearStartYear(invoice.invoice_date);
      if (invoice.id) {
        // Update existing invoice
        this.db.prepare(`
          UPDATE invoices SET
            invoice_number = ?, invoice_date = ?, tp_number = ?, vehicle_number = ?,
            customer_id = ?, payment_mode = ?, total_value = ?,
            royalty_on_weight = ?, dmft_on_royalty = ?, reverse_charge = ?,
            sgst_rate = ?, sgst_amount = ?, cgst_rate = ?, cgst_amount = ?,
            igst_rate = ?, igst_amount = ?, total_amount = ?,
            company_name = ?, company_gstin = ?, company_mobile = ?, company_address = ?,
            company_email = ?, company_bank_name = ?, company_account_number = ?, company_ifsc_code = ?,
            customer_name = ?, customer_address = ?, customer_billed_address = ?, customer_shipped_address = ?, customer_state = ?, customer_gstin = ?, customer_mobile = ?,
            company_id = ?, fy_start_year = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          invoice.invoice_number, invoice.invoice_date, invoice.tp_number,
          invoice.vehicle_number, invoice.customer_id, invoice.payment_mode,
          invoice.total_value, invoice.royalty_on_weight, invoice.dmft_on_royalty,
          invoice.reverse_charge, invoice.sgst_rate, invoice.sgst_amount,
          invoice.cgst_rate, invoice.cgst_amount, invoice.igst_rate,
          invoice.igst_amount, invoice.total_amount,
          snap('company_name'), snap('company_gstin'), snap('company_mobile'), snap('company_address'),
          snap('company_email'), snap('company_bank_name'), snap('company_account_number'), snap('company_ifsc_code'),
          snap('customer_name'), snap('customer_address'), snap('customer_billed_address'), snap('customer_shipped_address'),
          snap('customer_state'), snap('customer_gstin'), snap('customer_mobile'),
          invoice.company_id ?? null,
          fyStartYear,
          invoice.id
        );
        invoiceId = invoice.id;

        // Delete existing items
        this.db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
      } else {
        // Insert new invoice
        // Store invoice_number with company prefix so same number (01, 02) can exist per company
        const storedInvoiceNumber = (invoice.company_id != null)
          ? `${invoice.company_id}-${invoice.invoice_number}`
          : invoice.invoice_number;
        const result = this.db.prepare(`
          INSERT INTO invoices (
            invoice_number, invoice_date, tp_number, vehicle_number, customer_id,
            payment_mode, total_value, royalty_on_weight, dmft_on_royalty,
            reverse_charge, sgst_rate, sgst_amount, cgst_rate, cgst_amount,
            igst_rate, igst_amount, total_amount,
            company_name, company_gstin, company_mobile, company_address,
            company_email, company_bank_name, company_account_number, company_ifsc_code,
            customer_name, customer_address, customer_billed_address, customer_shipped_address, customer_state, customer_gstin, customer_mobile,
            company_id, fy_start_year
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          storedInvoiceNumber, invoice.invoice_date, invoice.tp_number,
          invoice.vehicle_number, invoice.customer_id, invoice.payment_mode,
          invoice.total_value, invoice.royalty_on_weight, invoice.dmft_on_royalty,
          invoice.reverse_charge, invoice.sgst_rate, invoice.sgst_amount,
          invoice.cgst_rate, invoice.cgst_amount, invoice.igst_rate,
          invoice.igst_amount, invoice.total_amount,
          snap('company_name'), snap('company_gstin'), snap('company_mobile'), snap('company_address'),
          snap('company_email'), snap('company_bank_name'), snap('company_account_number'), snap('company_ifsc_code'),
          snap('customer_name'), snap('customer_address'), snap('customer_billed_address'), snap('customer_shipped_address'),
          snap('customer_state'), snap('customer_gstin'), snap('customer_mobile'),
          invoice.company_id ?? null,
          fyStartYear
        );
        invoiceId = result.lastInsertRowid;
      }

      // Insert invoice items
      const insertItem = this.db.prepare(`
        INSERT INTO invoice_items (invoice_id, product_id, serial_number, quantity, rate, amount)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const item of invoice.items) {
        insertItem.run(
          invoiceId, item.product_id, item.serial_number,
          item.quantity, item.rate, item.amount
        );
      }

      return invoiceId;
    });

    return transaction(invoice);
  }

  deleteInvoice(id) {
    const transaction = this.db.transaction((id) => {
      // Delete items first (CASCADE should handle this, but being explicit)
      this.db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);
      // Delete invoice
      return this.db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    });

    return transaction(id);
  }

  getNextInvoiceNumber(companyId, invoiceDateISO) {
    if (!companyId) return '01';
    const iso = invoiceDateISO || new Date().toISOString();
    const fy = BillingDatabase.financialYearStartYear(iso);
    const maxSuffix = this.maxInvoiceSuffixInFinancialYear(companyId, fy);
    const count = this.getInvoiceCount(companyId);
    const next = Math.max(maxSuffix, count) + 1;
    return String(next).padStart(2, '0');
  }

  /**
   * Sheets Methods (scoped by company)
   */
  getSheets(companyId, options = {}) {
    if (!companyId) {
      return { data: [], meta: { total: 0, current_page: 1, per_page: 25, last_page: 0 } };
    }
    const opts = options || {};
    const fetchAll = !!opts.fetch_all;
    const page = Math.max(1, parseInt(String(opts.page), 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(String(opts.per_page), 10) || 25));

    const conditions = ['s.company_id = ?'];
    const params = [companyId];
    if (opts.product_name) {
      conditions.push('p.name = ?');
      params.push(opts.product_name);
    }
    if (opts.ralti) {
      conditions.push('s.ralti = ?');
      params.push(opts.ralti);
    }
    const searchRaw = opts.search != null ? String(opts.search).trim() : '';
    if (searchRaw) {
      const escaped = searchRaw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const like = `%${escaped}%`;
      conditions.push(
        '(s.invoice_no LIKE ? ESCAPE \'\\\' OR IFNULL(p.name, \'\') LIKE ? ESCAPE \'\\\' OR IFNULL(s.truck_number, \'\') LIKE ? ESCAPE \'\\\')'
      );
      params.push(like, like, like);
    }
    if (opts.date_from) {
      conditions.push('date(s.date) >= date(?)');
      params.push(opts.date_from);
    }
    if (opts.date_to) {
      conditions.push('date(s.date) <= date(?)');
      params.push(opts.date_to);
    }
    const whereClause = conditions.join(' AND ');

    const sortBy = opts.sort_by === 'invoice_no' ? 'invoice_no' : 'date';
    const sortOrder = String(opts.sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    let orderClause;
    if (sortBy === 'invoice_no') {
      orderClause = sortOrder === 'ASC' ? 's.invoice_no ASC, s.date ASC' : 's.invoice_no DESC, s.date DESC';
    } else {
      orderClause = sortOrder === 'ASC' ? 's.date ASC, s.invoice_no ASC' : 's.date DESC, s.invoice_no ASC';
    }

    const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS c
      FROM sheets s
      LEFT JOIN products p ON s.product_id = p.id
      WHERE ${whereClause}
    `).get(...params);
    const total = totalRow?.c != null ? Number(totalRow.c) : 0;

    let limitClause = '';
    if (!fetchAll) {
      const offset = (page - 1) * perPage;
      limitClause = ` LIMIT ${Number(perPage)} OFFSET ${Number(offset)}`;
    }

    const data = this.db.prepare(`
      SELECT s.*, p.name as product_name
      FROM sheets s
      LEFT JOIN products p ON s.product_id = p.id
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      ${limitClause}
    `).all(...params);

    const perPageEffective = fetchAll ? Math.max(1, total || 1) : perPage;
    const lastPage = total > 0 ? (fetchAll ? 1 : Math.ceil(total / perPage)) : 0;

    return {
      data,
      meta: {
        total,
        current_page: fetchAll ? 1 : page,
        per_page: perPageEffective,
        last_page: lastPage,
      },
    };
  }

  getSheet(id) {
    const sheet = this.db.prepare(`
      SELECT s.*, p.name as product_name
      FROM sheets s
      LEFT JOIN products p ON s.product_id = p.id
      WHERE s.id = ?
    `).get(id);
    return sheet || null;
  }

  getSheetByInvoiceNo(invoiceNo, excludeId = null, companyId = null) {
    if (!companyId) return null;
    if (excludeId) {
      return this.db.prepare(`
        SELECT * FROM sheets
        WHERE invoice_no = ? AND company_id = ? AND id != ?
      `).get(invoiceNo, companyId, excludeId);
    } else {
      return this.db.prepare(`
        SELECT * FROM sheets
        WHERE invoice_no = ? AND company_id = ?
      `).get(invoiceNo, companyId);
    }
  }

  saveSheet(sheet) {
    const companyId = sheet.company_id != null ? sheet.company_id : null;
    if (sheet.id) {
      return this.db.prepare(`
        UPDATE sheets SET
          invoice_no = ?, product_id = ?, weight = ?, truck_number = ?,
          ralti = ?, rate = ?, b_rate = ?, gst = ?, amount = ?, amount_with_gst = ?, date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        sheet.invoice_no, sheet.product_id, sheet.weight, sheet.truck_number,
        sheet.ralti, sheet.rate, sheet.b_rate, sheet.gst, sheet.amount, sheet.amount_with_gst, sheet.date, sheet.id
      );
    } else {
      return this.db.prepare(`
        INSERT INTO sheets (invoice_no, company_id, product_id, weight, truck_number, ralti, rate, b_rate, gst, amount, amount_with_gst, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sheet.invoice_no, companyId, sheet.product_id, sheet.weight, sheet.truck_number,
        sheet.ralti, sheet.rate, sheet.b_rate, sheet.gst, sheet.amount, sheet.amount_with_gst, sheet.date
      );
    }
  }

  deleteSheet(id) {
    return this.db.prepare('DELETE FROM sheets WHERE id = ?').run(id);
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
    }
  }

  enqueueSyncJob(entityType, operation, localId, payload = null) {
    if (!entityType || !operation || !localId) return null;
    const payloadJson = payload != null ? JSON.stringify(payload) : null;
    const existing = this.db.prepare(`
      SELECT id FROM sync_queue
      WHERE entity_type = ? AND local_id = ? AND status IN ('pending', 'failed')
      ORDER BY id DESC
      LIMIT 1
    `).get(entityType, localId);
    if (existing) {
      this.db.prepare(`
        UPDATE sync_queue
        SET operation = ?, payload_json = ?, attempts = 0, status = 'pending', last_error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(operation, payloadJson, existing.id);
      return existing.id;
    }
    const result = this.db.prepare(`
      INSERT INTO sync_queue (entity_type, operation, local_id, payload_json, attempts, status)
      VALUES (?, ?, ?, ?, 0, 'pending')
    `).run(entityType, operation, localId, payloadJson);
    return result.lastInsertRowid;
  }

  getPendingSyncJobs(limit = 20) {
    const safeLimit = Math.max(1, Number(limit) || 20);
    return this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE status IN ('pending', 'failed')
      ORDER BY id ASC
      LIMIT ?
    `).all(safeLimit);
  }

  getSyncStatus() {
    const pendingRow = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sync_queue
      WHERE status = 'pending'
    `).get();
    const failedRow = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sync_queue
      WHERE status = 'failed'
    `).get();
    const latestFailed = this.db.prepare(`
      SELECT last_error, updated_at
      FROM sync_queue
      WHERE status = 'failed'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get();
    return {
      pending: pendingRow ? pendingRow.count : 0,
      failed: failedRow ? failedRow.count : 0,
      lastError: latestFailed ? latestFailed.last_error : null,
      lastErrorAt: latestFailed ? latestFailed.updated_at : null,
    };
  }

  getFailedSyncJobs(limit = 10) {
    const safeLimit = Math.max(1, Number(limit) || 10);
    return this.db.prepare(`
      SELECT id, entity_type, operation, local_id, attempts, last_error, created_at, updated_at
      FROM sync_queue
      WHERE status = 'failed'
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit);
  }

  markSyncJobDone(jobId) {
    return this.db.prepare(`
      UPDATE sync_queue
      SET status = 'done', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(jobId);
  }

  markSyncJobFailed(jobId, errorMessage) {
    return this.db.prepare(`
      UPDATE sync_queue
      SET status = 'failed',
          attempts = attempts + 1,
          last_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(errorMessage || 'Unknown sync error', jobId);
  }

  getRemoteId(entityType, localId) {
    const row = this.db.prepare(`
      SELECT remote_id FROM sync_id_map
      WHERE entity_type = ? AND local_id = ?
      LIMIT 1
    `).get(entityType, localId);
    return row ? row.remote_id : null;
  }

  getLocalIdByRemoteId(entityType, remoteId) {
    const row = this.db.prepare(`
      SELECT local_id FROM sync_id_map
      WHERE entity_type = ? AND remote_id = ?
      LIMIT 1
    `).get(entityType, remoteId);
    return row ? row.local_id : null;
  }

  upsertRemoteId(entityType, localId, remoteId) {
    return this.db.prepare(`
      INSERT INTO sync_id_map (entity_type, local_id, remote_id, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(entity_type, local_id)
      DO UPDATE SET remote_id = excluded.remote_id, updated_at = CURRENT_TIMESTAMP
    `).run(entityType, localId, remoteId);
  }

  getMappingsByEntity(entityType) {
    return this.db.prepare(`
      SELECT local_id, remote_id
      FROM sync_id_map
      WHERE entity_type = ?
    `).all(entityType);
  }

  deleteRemoteIdMapping(entityType, localId) {
    return this.db.prepare(`
      DELETE FROM sync_id_map
      WHERE entity_type = ? AND local_id = ?
    `).run(entityType, localId);
  }
}

module.exports = BillingDatabase;
