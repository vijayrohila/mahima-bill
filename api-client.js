'use strict';

/**
 * HTTP client for the Laravel API (Bearer Sanctum token).
 * Base URL is the API root (no trailing slash), e.g. http://127.0.0.1:8000/api
 * if routes are under /api. Paths below are appended as /login, /companies, etc.
 */

function formatFetchError(url, err) {
  const cause = err && err.cause;
  const code = cause && cause.code ? String(cause.code) : '';
  const causeMsg = cause && cause.message ? String(cause.message) : '';
  const detail = [code, causeMsg].filter(Boolean).join(' ');
  const suffix = detail ? ` (${detail})` : '';
  return new Error(
    `Could not reach API at ${url}${suffix}. Check that the Laravel server is running and the API base URL in settings matches it (try http://127.0.0.1:8000 instead of localhost if unsure).`
  );
}

async function fetchWithContext(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    throw formatFetchError(url, err);
  }
}

async function request(config, method, path, body) {
  const baseUrl = (config.getApiBaseUrl() || '').replace(/\/$/, '');
  const token = config.getApiToken();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    opts.body = JSON.stringify(body);
  }
  const res = await fetchWithContext(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (typeof data === 'string' ? data : null) ||
      res.statusText;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(data));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function useApi(config) {
  return !!(config.getApiBaseUrl() && config.getApiToken());
}

async function apiLogin(config, email, password) {
  const baseUrl = (config.getApiBaseUrl() || '').replace(/\/$/, '');
  const url = `${baseUrl}/login`;
  const res = await fetchWithContext(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && data.message) || text || res.statusText;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(data));
  }
  if (data && data.token) {
    config.setApiToken(data.token);
  }
  return data;
}

async function changePassword(config, currentPassword, newPassword, newPasswordConfirmation) {
  return request(config, 'POST', '/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
    new_password_confirmation: newPasswordConfirmation,
  });
}

async function getCompanies(config) {
  return request(config, 'GET', '/companies');
}

async function getCompanySettings(config, companyId) {
  if (!companyId) return null;
  try {
    return await request(config, 'GET', `/companies/${companyId}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function saveCompanySettings(config, settings) {
  if (settings.id) {
    return request(config, 'PUT', `/companies/${settings.id}`, settings);
  }
  return request(config, 'POST', '/companies', settings);
}

async function getInvoiceCount(config, companyId) {
  return request(config, 'GET', `/companies/${companyId}/invoice-count`);
}

async function incrementInvoiceCount(config, companyId) {
  return request(config, 'POST', `/companies/${companyId}/invoice-count/increment`);
}

async function resetInvoiceCount(config, companyId) {
  return request(config, 'POST', `/companies/${companyId}/invoice-count/reset`);
}

async function setInvoiceCount(config, companyId, count) {
  return request(config, 'PUT', `/companies/${companyId}/invoice-count`, { count });
}

async function getCustomers(config, companyId) {
  if (!companyId) return [];
  const q = new URLSearchParams({ company_id: String(companyId) });
  return request(config, 'GET', `/customers?${q.toString()}`);
}

async function saveCustomer(config, customer) {
  if (customer.id) {
    return request(config, 'PUT', `/customers/${customer.id}`, customer);
  }
  return request(config, 'POST', '/customers', customer);
}

async function deleteCustomer(config, id) {
  return request(config, 'DELETE', `/customers/${id}`);
}

async function getProducts(config, companyId) {
  if (!companyId) return [];
  const q = new URLSearchParams({ company_id: String(companyId) });
  return request(config, 'GET', `/products?${q.toString()}`);
}

async function saveProduct(config, product) {
  if (product.id) {
    return request(config, 'PUT', `/products/${product.id}`, product);
  }
  return request(config, 'POST', '/products', product);
}

async function deleteProduct(config, id) {
  return request(config, 'DELETE', `/products/${id}`);
}

async function getInvoicesMeta(config, companyId) {
  if (!companyId) return { count: 0, max_updated_at: null };
  const q = new URLSearchParams({ company_id: String(companyId) });
  return request(config, 'GET', `/invoices/meta?${q.toString()}`);
}

async function getInvoices(config, companyId, options = {}) {
  if (!companyId) {
    return {
      data: [],
      meta: { total: 0, current_page: 1, per_page: 25, last_page: 0 },
      sums: { total_value: 0, total_amount: 0 },
    };
  }
  const q = new URLSearchParams({ company_id: String(companyId) });
  if (options.fetch_all) {
    q.set('fetch_all', '1');
  } else {
    q.set('page', String(options.page || 1));
    q.set('per_page', String(options.per_page || 25));
  }
  if (options.date_from) q.set('date_from', options.date_from);
  if (options.date_to) q.set('date_to', options.date_to);
  return request(config, 'GET', `/invoices?${q.toString()}`);
}

async function getInvoice(config, id) {
  try {
    return await request(config, 'GET', `/invoices/${id}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function saveInvoice(config, invoice) {
  if (invoice.id) {
    return request(config, 'PUT', `/invoices/${invoice.id}`, invoice);
  }
  return request(config, 'POST', '/invoices', invoice);
}

async function deleteInvoice(config, id) {
  return request(config, 'DELETE', `/invoices/${id}`);
}

async function getNextInvoiceNumber(config, companyId, invoiceDateISO) {
  const q = new URLSearchParams({ company_id: String(companyId) });
  if (invoiceDateISO) q.set('invoice_date', invoiceDateISO);
  return request(config, 'GET', `/invoices/next-number?${q.toString()}`);
}

async function invoiceNumberExistsInFY(
  config,
  companyId,
  storedInvoiceNumber,
  invoiceDateISO,
  excludeInvoiceId
) {
  const body = {
    company_id: companyId,
    stored_invoice_number: storedInvoiceNumber,
    invoice_date: invoiceDateISO,
  };
  if (excludeInvoiceId != null) {
    body.exclude_invoice_id = excludeInvoiceId;
  }
  return request(config, 'POST', '/invoices/check-number', body);
}

async function getSheets(config, companyId, options = {}) {
  if (!companyId) {
    return { data: [], meta: { total: 0, current_page: 1, per_page: 25, last_page: 0 } };
  }
  const q = new URLSearchParams({ company_id: String(companyId) });
  if (options.fetch_all) {
    q.set('fetch_all', '1');
  } else {
    q.set('page', String(options.page || 1));
    q.set('per_page', String(options.per_page || 25));
  }
  if (options.search) q.set('search', options.search);
  if (options.date_from) q.set('date_from', options.date_from);
  if (options.date_to) q.set('date_to', options.date_to);
  if (options.product_name) q.set('product_name', options.product_name);
  if (options.ralti) q.set('ralti', options.ralti);
  if (options.sort_by) q.set('sort_by', options.sort_by);
  if (options.sort_order) q.set('sort_order', options.sort_order);
  return request(config, 'GET', `/sheets?${q.toString()}`);
}

async function getSheet(config, id) {
  try {
    return await request(config, 'GET', `/sheets/${id}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function getSheetByInvoiceNo(config, invoiceNo, excludeId, companyId) {
  const q = new URLSearchParams({
    invoice_no: String(invoiceNo),
    company_id: String(companyId),
  });
  if (excludeId != null) q.set('exclude_id', String(excludeId));
  return request(config, 'GET', `/sheets/by-invoice-no?${q.toString()}`);
}

async function saveSheet(config, sheet) {
  if (sheet.id) {
    return request(config, 'PUT', `/sheets/${sheet.id}`, sheet);
  }
  return request(config, 'POST', '/sheets', sheet);
}

async function getSyncChanges(config, companyId, since) {
  const q = new URLSearchParams();
  if (companyId != null) q.set('company_id', String(companyId));
  if (since) q.set('since', since);
  return request(config, 'GET', `/sync/changes?${q.toString()}`);
}

module.exports = {
  useApi,
  request,
  apiLogin,
  changePassword,
  getCompanies,
  getCompanySettings,
  saveCompanySettings,
  getInvoiceCount,
  incrementInvoiceCount,
  resetInvoiceCount,
  setInvoiceCount,
  getCustomers,
  saveCustomer,
  deleteCustomer,
  getProducts,
  saveProduct,
  deleteProduct,
  getInvoicesMeta,
  getInvoices,
  getInvoice,
  saveInvoice,
  deleteInvoice,
  getNextInvoiceNumber,
  invoiceNumberExistsInFY,
  getSheets,
  getSheet,
  getSheetByInvoiceNo,
  saveSheet,
  getSyncChanges,
};
