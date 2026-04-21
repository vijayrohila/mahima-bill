class SyncService {
  constructor(db, config, apiClient) {
    this.db = db;
    this.config = config;
    this.apiClient = apiClient;
    this.isSyncing = false;
  }

  canSync() {
    return !!(this.config && this.apiClient && this.config.getApiBaseUrl() && this.config.getApiToken());
  }

  trigger() {
    if (this.isSyncing) return;
    if (!this.canSync()) return;
    this.run().catch((error) => {
      console.error('Sync run failed:', error);
    });
  }

  async run() {
    if (this.isSyncing || !this.canSync()) return;
    this.isSyncing = true;
    try {
      while (true) {
        const jobs = this.db.getPendingSyncJobs(25);
        if (!jobs.length) break;
        for (const job of jobs) {
          try {
            await this.processJob(job);
            this.db.markSyncJobDone(job.id);
          } catch (error) {
            this.db.markSyncJobFailed(job.id, error.message);
          }
        }
      }
      await this.reconcileCounts();
      await this.pullRemoteChanges();
    } finally {
      this.isSyncing = false;
    }
  }

  async pullRemoteChanges() {
    const companySince = this.config.getSyncCursor('companies');
    const companiesPayload = await this.apiClient.getSyncChanges(this.config, null, companySince);
    if (companiesPayload) {
      await this.applyRemoteEntityChanges(
        'company',
        null,
        companiesPayload.companies?.changed || [],
        companiesPayload.companies?.remote_ids || []
      );
      if (companiesPayload.cursor) {
        this.config.setSyncCursor('companies', companiesPayload.cursor);
      }
    }

    const companies = this.db.getCompanies();
    for (const company of companies) {
      const companyId = company.id;
      const since = this.config.getSyncCursor(companyId);
      const payload = await this.apiClient.getSyncChanges(this.config, companyId, since);
      if (!payload) continue;

      await this.applyRemoteEntityChanges(
        'customer',
        companyId,
        payload.customers?.changed || [],
        payload.customers?.remote_ids || []
      );
      await this.applyRemoteEntityChanges(
        'product',
        companyId,
        payload.products?.changed || [],
        payload.products?.remote_ids || []
      );
      await this.applyRemoteEntityChanges(
        'invoice',
        companyId,
        payload.invoices?.changed || [],
        payload.invoices?.remote_ids || []
      );
      await this.applyRemoteEntityChanges(
        'sheet',
        companyId,
        payload.sheets?.changed || [],
        payload.sheets?.remote_ids || []
      );

      if (payload.cursor) {
        this.config.setSyncCursor(companyId, payload.cursor);
      }
    }
  }

  async reconcileCounts() {
    const companies = this.db.getCompanies();
    for (const company of companies) {
      const companyId = company.id;
      await this.reconcileEntityForCompany({
        entityType: 'customer',
        companyId,
        getLocalRows: () => this.db.getCustomers(companyId),
        getRemoteRows: () => this.apiClient.getCustomers(this.config, companyId),
        saveLocal: (payload) => this.db.saveCustomer(payload),
        saveRemote: (payload) => this.apiClient.saveCustomer(this.config, payload),
      });
      await this.reconcileEntityForCompany({
        entityType: 'product',
        companyId,
        getLocalRows: () => this.db.getProducts(companyId),
        getRemoteRows: () => this.apiClient.getProducts(this.config, companyId),
        saveLocal: (payload) => this.db.saveProduct(payload),
        saveRemote: (payload) => this.apiClient.saveProduct(this.config, payload),
      });
    }
  }

  async reconcileEntityForCompany({
    entityType,
    companyId,
    getLocalRows,
    getRemoteRows,
    saveLocal,
    saveRemote,
  }) {
    const localRows = (await getLocalRows()) || [];
    const remoteRows = (await getRemoteRows()) || [];

    // If one side has fewer rows, backfill that side from the other side.
    // We still use ID mapping to avoid duplicate copies.
    if (localRows.length > remoteRows.length) {
      for (const localRow of localRows) {
        const mappedRemoteId = this.db.getRemoteId(entityType, localRow.id);
        if (mappedRemoteId) continue;
        const payload = this.sanitizeEntityPayload(entityType, localRow, companyId);
        const createdRemoteId = await saveRemote(payload);
        if (createdRemoteId) {
          this.db.upsertRemoteId(entityType, localRow.id, Number(createdRemoteId));
        }
      }
    } else if (remoteRows.length > localRows.length) {
      for (const remoteRow of remoteRows) {
        const mappedLocalId = this.db.getLocalIdByRemoteId(entityType, remoteRow.id);
        if (mappedLocalId) continue;
        const payload = this.sanitizeEntityPayload(entityType, remoteRow, companyId);
        const localResult = await saveLocal(payload);
        const createdLocalId = localResult?.lastInsertRowid;
        if (createdLocalId) {
          this.db.upsertRemoteId(entityType, Number(createdLocalId), Number(remoteRow.id));
        }
      }
    } else {
      // Counts are equal. Ensure missing mappings are created where obvious.
      for (const remoteRow of remoteRows) {
        const mappedLocalId = this.db.getLocalIdByRemoteId(entityType, remoteRow.id);
        if (mappedLocalId) continue;
        const payload = this.sanitizeEntityPayload(entityType, remoteRow, companyId);
        const localResult = await saveLocal(payload);
        const createdLocalId = localResult?.lastInsertRowid;
        if (createdLocalId) {
          this.db.upsertRemoteId(entityType, Number(createdLocalId), Number(remoteRow.id));
        }
      }
    }
  }

  sanitizeEntityPayload(entityType, row, companyId) {
    if (entityType === 'company') {
      return {
        company_name: row.company_name || '',
        gstin: row.gstin || '',
        mobile: row.mobile || '',
        address: row.address || '',
        email: row.email || '',
        bank_name: row.bank_name || '',
        account_number: row.account_number || '',
        ifsc_code: row.ifsc_code || '',
        terms_conditions: row.terms_conditions || '',
        invoice_count: row.invoice_count ?? 0,
      };
    }
    if (entityType === 'customer') {
      return {
        company_id: row.company_id ?? companyId,
        name: row.name ?? '',
        gstin: row.gstin ?? '',
        mobile: row.mobile ?? '',
        address: row.address ?? '',
        billed_address: row.billed_address ?? row.address ?? '',
        shipped_address: row.shipped_address ?? row.billed_address ?? row.address ?? '',
        state: row.state ?? '',
        pincode: row.pincode ?? '',
      };
    }
    if (entityType === 'product') {
      return {
        company_id: row.company_id ?? companyId,
        name: row.name ?? '',
        hsn_code: row.hsn_code ?? '',
        unit: row.unit ?? 'CBM',
        rate: row.rate ?? 0,
      };
    }
    if (entityType === 'sheet') {
      return {
        company_id: row.company_id ?? companyId ?? null,
        invoice_no: row.invoice_no ?? '',
        product_id: row.product_id ?? null,
        weight: row.weight ?? 0,
        truck_number: row.truck_number ?? '',
        ralti: row.ralti ?? 'No',
        rate: row.rate ?? 0,
        b_rate: row.b_rate ?? 0,
        gst: row.gst ?? 5,
        amount: row.amount ?? 0,
        amount_with_gst: row.amount_with_gst ?? 0,
        date: row.date ?? new Date().toISOString(),
      };
    }
    return {};
  }

  async processJob(job) {
    const payload = job.payload_json ? JSON.parse(job.payload_json) : null;
    if (job.entity_type === 'customer') {
      await this.processCustomer(job.operation, job.local_id, payload);
      return;
    }
    if (job.entity_type === 'product') {
      await this.processProduct(job.operation, job.local_id, payload);
      return;
    }
    if (job.entity_type === 'invoice') {
      await this.processInvoice(job.operation, job.local_id, payload);
      return;
    }
    if (job.entity_type === 'sheet') {
      await this.processSheet(job.operation, job.local_id, payload);
      return;
    }
    throw new Error(`Unsupported entity type: ${job.entity_type}`);
  }

  async processCustomer(operation, localId, payload) {
    const remoteId = this.db.getRemoteId('customer', localId);
    if (operation === 'delete') {
      if (remoteId) await this.apiClient.deleteCustomer(this.config, remoteId);
      return;
    }

    if (!payload) throw new Error('Missing customer payload');
    if (remoteId) {
      await this.apiClient.saveCustomer(this.config, { ...payload, id: remoteId });
      return;
    }

    const createdRemoteId = await this.apiClient.saveCustomer(this.config, payload);
    if (createdRemoteId) this.db.upsertRemoteId('customer', localId, Number(createdRemoteId));
  }

  async processProduct(operation, localId, payload) {
    const remoteId = this.db.getRemoteId('product', localId);
    if (operation === 'delete') {
      if (remoteId) await this.apiClient.deleteProduct(this.config, remoteId);
      return;
    }

    if (!payload) throw new Error('Missing product payload');
    if (remoteId) {
      await this.apiClient.saveProduct(this.config, { ...payload, id: remoteId });
      return;
    }

    const createdRemoteId = await this.apiClient.saveProduct(this.config, payload);
    if (createdRemoteId) this.db.upsertRemoteId('product', localId, Number(createdRemoteId));
  }

  async processInvoice(operation, localId, payload) {
    const remoteId = this.db.getRemoteId('invoice', localId);
    if (operation === 'delete') {
      if (remoteId) await this.apiClient.deleteInvoice(this.config, remoteId);
      return;
    }
    if (!payload) throw new Error('Missing invoice payload');

    const customerRemoteId = this.db.getRemoteId('customer', payload.customer_id);
    if (!customerRemoteId) {
      throw new Error('Invoice customer is not synced to server yet');
    }
    const remoteItems = [];
    for (const item of payload.items || []) {
      const productRemoteId = this.db.getRemoteId('product', item.product_id);
      if (!productRemoteId) throw new Error('Invoice item product is not synced to server yet');
      remoteItems.push({ ...item, product_id: productRemoteId });
    }
    const remotePayload = {
      ...payload,
      customer_id: customerRemoteId,
      items: remoteItems,
    };
    delete remotePayload.id;

    if (remoteId) {
      await this.apiClient.saveInvoice(this.config, { ...remotePayload, id: remoteId });
      return;
    }
    const createdRemoteId = await this.apiClient.saveInvoice(this.config, remotePayload);
    if (createdRemoteId) this.db.upsertRemoteId('invoice', localId, Number(createdRemoteId));
  }

  async processSheet(operation, localId, payload) {
    const remoteId = this.db.getRemoteId('sheet', localId);
    if (operation === 'delete') {
      if (remoteId) await this.apiClient.request(this.config, 'DELETE', `/sheets/${remoteId}`);
      return;
    }
    if (!payload) throw new Error('Missing sheet payload');

    const productRemoteId = this.db.getRemoteId('product', payload.product_id);
    if (!productRemoteId) {
      throw new Error('Sheet product is not synced to server yet');
    }
    const remotePayload = { ...payload, product_id: productRemoteId };
    delete remotePayload.id;
    if (remoteId) {
      await this.apiClient.saveSheet(this.config, { ...remotePayload, id: remoteId });
      return;
    }
    const createdRemoteId = await this.apiClient.saveSheet(this.config, remotePayload);
    if (createdRemoteId) this.db.upsertRemoteId('sheet', localId, Number(createdRemoteId));
  }

  async applyRemoteEntityChanges(entityType, companyId, changedRows, remoteIds) {
    for (const remoteRow of changedRows) {
      const mappedLocalId = this.db.getLocalIdByRemoteId(entityType, remoteRow.id);
      let payload = this.sanitizeEntityPayload(entityType, remoteRow, companyId);
      if (entityType === 'invoice') {
        const fullInvoice = await this.apiClient.getInvoice(this.config, remoteRow.id);
        if (!fullInvoice) continue;
        const localCustomerId = this.db.getLocalIdByRemoteId('customer', fullInvoice.customer_id);
        if (!localCustomerId) continue;
        const localItems = [];
        for (const item of fullInvoice.items || []) {
          const localProductId = this.db.getLocalIdByRemoteId('product', item.product_id);
          if (!localProductId) continue;
          localItems.push({ ...item, product_id: localProductId });
        }
        payload = { ...fullInvoice, customer_id: localCustomerId, items: localItems, company_id: companyId };
      } else if (entityType === 'sheet') {
        const localProductId = this.db.getLocalIdByRemoteId('product', remoteRow.product_id);
        if (!localProductId) continue;
        payload = { ...payload, product_id: localProductId };
      }
      if (mappedLocalId) {
        if (entityType === 'company') {
          this.db.saveCompanySettings({ id: mappedLocalId, ...payload });
        } else if (entityType === 'customer') {
          this.db.saveCustomer({ id: mappedLocalId, ...payload });
        } else if (entityType === 'product') {
          this.db.saveProduct({ id: mappedLocalId, ...payload });
        } else if (entityType === 'invoice') {
          this.db.saveInvoice({ ...payload, id: mappedLocalId });
        } else if (entityType === 'sheet') {
          this.db.saveSheet({ ...payload, id: mappedLocalId });
        }
      } else {
        let localResult = null;
        if (entityType === 'company') {
          const id = this.db.saveCompanySettings(payload);
          localResult = { lastInsertRowid: id };
        } else if (entityType === 'customer') {
          localResult = this.db.saveCustomer(payload);
        } else if (entityType === 'product') {
          localResult = this.db.saveProduct(payload);
        } else if (entityType === 'invoice') {
          const insertPayload = { ...payload };
          delete insertPayload.id;
          const id = this.db.saveInvoice(insertPayload);
          localResult = { lastInsertRowid: id };
        } else if (entityType === 'sheet') {
          localResult = this.db.saveSheet(payload);
        }
        const localId = localResult?.lastInsertRowid;
        if (localId) {
          this.db.upsertRemoteId(entityType, Number(localId), Number(remoteRow.id));
        }
      }
    }

    const remoteIdSet = new Set((remoteIds || []).map((id) => Number(id)));
    const localRows = entityType === 'company'
      ? this.db.getCompanies()
      : entityType === 'customer'
        ? this.db.getCustomers(companyId)
        : entityType === 'product'
          ? this.db.getProducts(companyId)
          : entityType === 'invoice'
            ? this.db.getInvoices(companyId, { fetch_all: true }).data
            : this.db.getSheets(companyId, { fetch_all: true }).data;
    for (const localRow of localRows) {
      const localId = Number(localRow.id);
      const mappedRemoteId = this.db.getRemoteId(entityType, localId);
      if (!mappedRemoteId) continue;
      if (remoteIdSet.has(Number(mappedRemoteId))) continue;
      if (entityType === 'company') {
        continue; // do not auto-delete companies locally
      } else if (entityType === 'customer') {
        this.db.deleteCustomer(localId);
      } else if (entityType === 'product') {
        this.db.deleteProduct(localId);
      } else if (entityType === 'invoice') {
        this.db.deleteInvoice(localId);
      } else if (entityType === 'sheet') {
        this.db.deleteSheet(localId);
      }
      if (entityType !== 'company') {
        this.db.deleteRemoteIdMapping(entityType, localId);
      }
    }
  }
}

module.exports = SyncService;
