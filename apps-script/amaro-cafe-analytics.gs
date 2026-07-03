const OWNER_ACCESS_TOKEN = 'qrstack-berna-2026';
const EVENTS_SHEET_NAME = 'qrstack_events';

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || '';

  if (action === 'health') {
    return json({ ok: true, restaurant: 'amaro', version: 'amaro-analytics-v1' });
  }

  if (action === 'getInsights') {
    assertOwner(params.key || params.owner_key);
    return json({
      ok: true,
      restaurant: {
        id: 'rest_amaro',
        slug: 'amaro',
        name: 'Amaro Cafe',
      },
      insights: getInsights({
        startDate: params.startDate || params.start_date || params.start,
        endDate: params.endDate || params.end_date || params.end,
      }),
    }, params.callback);
  }

  return json(getLunchRows());
}

function doPost(e) {
  try {
    const payload = parsePayload(e);
    const event = appendEvent(payload);
    return json({ ok: true, event });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function getLunchRows() {
  const sheet = findLunchSheet();
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(normalizeHeader);
  const dateIndex = firstHeaderIndex(headers, ['data', 'date', 'dia']);
  const dishIndex = firstHeaderIndex(headers, ['prato', 'prato do dia', 'item', 'nome']);
  const priceIndex = firstHeaderIndex(headers, ['preco', 'preco r', 'valor', 'price']);

  if (dateIndex < 0 || dishIndex < 0 || priceIndex < 0) return [];

  return values
    .slice(1)
    .map((row) => ({
      data: row[dateIndex],
      prato: row[dishIndex],
      preco: parsePrice(row[priceIndex]),
    }))
    .filter((item) => item.prato && item.preco !== '');
}

function findLunchSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets().filter((sheet) => sheet.getName() !== EVENTS_SHEET_NAME);
  for (const sheet of sheets) {
    const values = sheet.getDataRange().getValues();
    if (!values.length) continue;
    const headers = values[0].map(normalizeHeader);
    const hasDate = firstHeaderIndex(headers, ['data', 'date', 'dia']) >= 0;
    const hasDish = firstHeaderIndex(headers, ['prato', 'prato do dia', 'item', 'nome']) >= 0;
    const hasPrice = firstHeaderIndex(headers, ['preco', 'preco r', 'valor', 'price']) >= 0;
    if (hasDate && hasDish && hasPrice) return sheet;
  }
  return sheets[0] || null;
}

function appendEvent(payload) {
  const sheet = ensureEventsSheet();
  const now = new Date().toISOString();
  const event = {
    id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: payload.timestamp || now,
    cliente: payload.cliente || payload.slug || 'amaro',
    event_type: normalizeEventType(payload.event_type || payload.tipo || 'page_view'),
    source: payload.source || payload.origem || 'Direto',
    url: payload.url || '',
    path: payload.path || '',
    referrer: payload.referrer || '',
    user_agent: payload.user_agent || payload.userAgent || '',
    language: payload.language || payload.idioma || '',
    session_id: payload.session_id || payload.sessionId || '',
  };

  sheet.appendRow([
    event.id,
    event.created_at,
    event.cliente,
    event.event_type,
    event.source,
    event.url,
    event.path,
    event.referrer,
    event.user_agent,
    event.language,
    event.session_id,
  ]);

  return event;
}

function ensureEventsSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(EVENTS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(EVENTS_SHEET_NAME);

  const headers = [
    'id',
    'created_at',
    'cliente',
    'event_type',
    'source',
    'url',
    'path',
    'referrer',
    'user_agent',
    'language',
    'session_id',
  ];

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = firstRow.some((value) => String(value || '').trim());
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getInsights(filters) {
  const sheet = ensureEventsSheet();
  const rows = readObjects(sheet);
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const periodRows = filterEventsByPeriod(rows, filters || {});

  const last7 = rows.filter((event) => {
    const created = new Date(event.created_at);
    return !Number.isNaN(created.getTime()) && created >= startOfDay(sevenDaysAgo);
  });

  return {
    total_accesses: rows.filter((event) => event.event_type === 'page_view').length,
    accesses_today: rows.filter((event) => String(event.created_at || '').slice(0, 10) === today && event.event_type === 'page_view').length,
    accesses_7_days: last7.filter((event) => event.event_type === 'page_view').length,
    total_events: rows.length,
    period_events: periodRows.length,
    period_accesses: periodRows.filter((event) => event.event_type === 'page_view').length,
    period_start: (filters && filters.startDate) || '',
    period_end: (filters && filters.endDate) || '',
    period_label: periodLabel((filters && filters.startDate) || '', (filters && filters.endDate) || ''),
    source_counts: countBy(periodRows, 'source'),
    event_type_counts: countBy(periodRows, 'event_type'),
    event_type_counts_all: countBy(rows, 'event_type'),
  };
}

function filterEventsByPeriod(rows, filters) {
  const startDate = filters.startDate || '';
  const endDate = filters.endDate || '';
  if (!startDate && !endDate) return rows;
  return rows.filter((event) => {
    const eventDate = eventDateOnly(event.created_at);
    if (!eventDate) return false;
    if (startDate && eventDate < startDate) return false;
    if (endDate && eventDate > endDate) return false;
    return true;
  });
}

function eventDateOnly(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function periodLabel(startDate, endDate) {
  if (!startDate && !endDate) return 'Todos os tempos';
  if (startDate && endDate && startDate === endDate) return startDate;
  return `${startDate || 'inicio'} ate ${endDate || todayIso()}`;
}

function readObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map((header) => String(header || '').trim());
  return values.slice(1).filter((row) => row.some(Boolean)).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index];
    });
    return object;
  });
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = String(row[key] || 'Direto').trim() || 'Direto';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function todayIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function parsePayload(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch {
    return {};
  }
}

function parsePrice(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? number : '';
}

function normalizeEventType(value) {
  const text = normalizeHeader(value);
  if (text === 'pageview' || text === 'page view' || text === 'access' || text === 'acesso') return 'page_view';
  return text.replace(/\s+/g, '_') || 'page_view';
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function firstHeaderIndex(headers, candidates) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.findIndex((header) => normalizedCandidates.includes(header));
}

function assertOwner(key) {
  if (key !== OWNER_ACCESS_TOKEN) throw new Error('owner_access_denied');
}

function json(payload, callback) {
  const body = callback ? `${callback}(${JSON.stringify(payload)});` : JSON.stringify(payload);
  return ContentService
    .createTextOutput(body)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
