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
  const source = normalizeSource(payload.source || payload.origem || payload.utm_source || 'direct');
  const device = detectDevice(payload.user_agent || payload.userAgent || '');
  const event = {
    id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: payload.timestamp || now,
    cliente: payload.cliente || payload.slug || 'amaro',
    event_type: normalizeEventType(payload.event_type || payload.tipo || 'page_view'),
    source,
    source_detail: payload.source_detail || payload.sourceDetail || payload.referrer || '',
    url: payload.url || '',
    path: payload.path || '',
    referrer: payload.referrer || '',
    user_agent: payload.user_agent || payload.userAgent || '',
    language: payload.language || payload.idioma || '',
    session_id: payload.session_id || payload.sessionId || '',
    visitor_id: payload.visitor_id || payload.visitorId || '',
    dish_name: payload.dish_name || payload.item_name || payload.prato || '',
    dish_key: payload.dish_key || normalizeHeader(payload.dish_name || payload.item_name || payload.prato || ''),
    dish_category: payload.dish_category || payload.item_category || payload.categoria || '',
    duration_ms: payload.duration_ms || payload.durationMs || '',
    observe_seconds: payload.observe_seconds || payload.observeSeconds || '',
    device_type: payload.device_type || payload.deviceType || device.type,
    browser: payload.browser || device.browser,
    os: payload.os || device.os,
    screen: payload.screen || '',
    viewport: payload.viewport || '',
    timezone_offset: payload.timezone_offset || payload.timezoneOffset || '',
  };
  const headers = getHeaders(sheet);
  sheet.appendRow(headers.map((header) => event[header] || ''));

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
    'source_detail',
    'url',
    'path',
    'referrer',
    'user_agent',
    'language',
    'session_id',
    'visitor_id',
    'dish_name',
    'dish_key',
    'dish_category',
    'duration_ms',
    'observe_seconds',
    'device_type',
    'browser',
    'os',
    'screen',
    'viewport',
    'timezone_offset',
  ];

  const firstRow = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn() || headers.length)).getValues()[0];
  const hasHeaders = firstRow.some((value) => String(value || '').trim());
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const existing = firstRow.map((header) => String(header || '').trim()).filter(Boolean);
    const missing = headers.filter((header) => !existing.includes(header));
    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
  }
  return sheet;
}

function getInsights(filters) {
  const sheet = ensureEventsSheet();
  const rows = readObjects(sheet).map(normalizeStoredEvent);
  const realRows = rows.filter((event) => !isTestEvent(event));
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const periodRows = filterEventsByPeriod(realRows, filters || {});
  const periodPageViews = periodRows.filter((event) => event.event_type === 'page_view');
  const periodDishViews = periodRows.filter((event) => event.event_type === 'dish_view');
  const periodDishTouches = periodRows.filter((event) => event.event_type === 'dish_touch');
  const periodDishObserves = periodRows.filter((event) => event.event_type === 'dish_observe');
  const allPageViews = realRows.filter((event) => event.event_type === 'page_view');
  const dishObserveSeconds = sumBy(periodDishObserves, 'dish_name', 'observe_seconds');
  const dishViewCounts = countBy(periodDishViews, 'dish_name');
  const dishTouchCounts = countBy(periodDishTouches, 'dish_name');

  const last7 = realRows.filter((event) => {
    const created = new Date(event.created_at);
    return !Number.isNaN(created.getTime()) && created >= startOfDay(sevenDaysAgo);
  });

  return {
    total_accesses: allPageViews.length,
    unique_sessions_total: uniqueCount(allPageViews, 'session_id'),
    accesses_today: realRows.filter((event) => String(event.created_at || '').slice(0, 10) === today && event.event_type === 'page_view').length,
    accesses_7_days: last7.filter((event) => event.event_type === 'page_view').length,
    total_events: realRows.length,
    test_events: rows.length - realRows.length,
    period_events: periodRows.length,
    period_accesses: periodPageViews.length,
    unique_sessions_period: uniqueCount(periodPageViews, 'session_id'),
    period_start: (filters && filters.startDate) || '',
    period_end: (filters && filters.endDate) || '',
    period_label: periodLabel((filters && filters.startDate) || '', (filters && filters.endDate) || ''),
    source_counts: countBy(periodPageViews, 'source'),
    event_type_counts: countBy(periodRows, 'event_type'),
    event_type_counts_all: countBy(realRows, 'event_type'),
    dish_view_counts: dishViewCounts,
    dish_touch_counts: dishTouchCounts,
    dish_observe_seconds: dishObserveSeconds,
    dish_attention_scores: dishAttentionScores(dishViewCounts, dishTouchCounts, dishObserveSeconds),
    dish_view_category_counts: countBy(periodDishViews, 'dish_category'),
    dish_touch_category_counts: countBy(periodDishTouches, 'dish_category'),
    dish_observe_category_seconds: sumBy(periodDishObserves, 'dish_category', 'observe_seconds'),
    total_dish_views: periodDishViews.length,
    total_dish_touches: periodDishTouches.length,
    total_dish_observe_seconds: sumNumeric(periodDishObserves, 'observe_seconds'),
    device_counts: countBy(periodPageViews, 'device_type'),
    browser_counts: countBy(periodPageViews, 'browser'),
    os_counts: countBy(periodPageViews, 'os'),
    daily_accesses: dailyCounts(periodPageViews),
    hour_counts: hourCounts(periodPageViews),
    recent_events: recentEvents(periodRows, 12),
    peak_hour: peakHour(periodPageViews),
    collected_at: new Date().toISOString(),
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

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((header) => String(header || '').trim());
}

function normalizeStoredEvent(event) {
  return {
    ...event,
    event_type: normalizeEventType(event.event_type || event.tipo || 'page_view'),
    source: normalizeSource(event.source || event.origem || 'direct'),
    device_type: normalizeDeviceType(event.device_type || detectDevice(event.user_agent || '').type),
    browser: event.browser || detectDevice(event.user_agent || '').browser,
    os: event.os || detectDevice(event.user_agent || '').os,
  };
}

function normalizeSource(value) {
  const text = normalizeHeader(value);
  if (!text || text === 'direto' || text === 'direct') return 'direct';
  if (/\b(qr|qrcode|qr code|mesa|table)\b/.test(text)) return 'qr';
  if (text.indexOf('whatsapp') >= 0 || text === 'wa' || text.indexOf('wpp') >= 0 || text.indexOf('wa me') >= 0) return 'whatsapp';
  if (text.indexOf('instagram') >= 0 || text.indexOf('instagr') >= 0 || text === 'ig' || text.indexOf('stories') >= 0) return 'instagram';
  if (text.indexOf('google') >= 0 || text.indexOf('pesquisa') >= 0 || text.indexOf('search') >= 0 || text.indexOf('organic') >= 0) return 'google';
  if (text.indexOf('bing') >= 0 || text.indexOf('yahoo') >= 0 || text.indexOf('duckduckgo') >= 0) return 'search';
  if (text.indexOf('facebook') >= 0 || text === 'fb') return 'facebook';
  if (text.indexOf('tiktok') >= 0) return 'tiktok';
  if (text.indexOf('codex') >= 0 || text.indexOf('teste') >= 0 || text.indexOf('test') >= 0) return text.replace(/\s+/g, '_');
  return 'internet';
}

function normalizeDeviceType(value) {
  const text = normalizeHeader(value);
  if (text.indexOf('mobile') >= 0 || text.indexOf('celular') >= 0) return 'mobile';
  if (text.indexOf('tablet') >= 0) return 'tablet';
  if (text.indexOf('desktop') >= 0 || text.indexOf('computador') >= 0) return 'desktop';
  return text || 'desconhecido';
}

function detectDevice(userAgent) {
  const ua = String(userAgent || '');
  const type = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobile|Android|iPhone|iPod/i.test(ua) ? 'mobile' : 'desktop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Outro';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Outro';
  return { type, browser, os };
}

function isTestEvent(event) {
  const source = normalizeHeader(event.source);
  const url = normalizeHeader(event.url);
  return source.indexOf('codex') >= 0 || source.indexOf('test') >= 0 || source.indexOf('teste') >= 0 || url.indexOf('codex') >= 0;
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = String(row[key] || 'direct').trim() || 'direct';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function sumBy(rows, groupKey, valueKey) {
  return rows.reduce((acc, row) => {
    const group = String(row[groupKey] || '').trim();
    if (!group) return acc;
    acc[group] = (acc[group] || 0) + parseNumeric(row[valueKey]);
    return acc;
  }, {});
}

function sumNumeric(rows, key) {
  return rows.reduce((sum, row) => sum + parseNumeric(row[key]), 0);
}

function parseNumeric(value) {
  const number = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function dishAttentionScores(viewCounts, touchCounts, observeSeconds) {
  const names = {};
  [viewCounts, touchCounts, observeSeconds].forEach((group) => {
    Object.keys(group || {}).forEach((key) => {
      if (key) names[key] = true;
    });
  });
  return Object.keys(names).reduce((acc, name) => {
    const views = Number(viewCounts[name] || 0);
    const touches = Number(touchCounts[name] || 0);
    const seconds = Number(observeSeconds[name] || 0);
    acc[name] = Math.round((views + touches * 3 + seconds / 8) * 10) / 10;
    return acc;
  }, {});
}

function uniqueCount(rows, key) {
  const values = rows
    .map((row) => String(row[key] || '').trim())
    .filter(Boolean);
  return new Set(values).size;
}

function dailyCounts(rows) {
  return rows.reduce((acc, row) => {
    const date = eventDateOnly(row.created_at);
    if (!date) return acc;
    acc[date] = (acc[date] || 0) + 1;
    return acc;
  }, {});
}

function hourCounts(rows) {
  return rows.reduce((acc, row) => {
    const date = new Date(row.created_at);
    if (Number.isNaN(date.getTime())) return acc;
    const hour = Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH');
    acc[hour] = (acc[hour] || 0) + 1;
    return acc;
  }, {});
}

function peakHour(rows) {
  const counts = hourCounts(rows);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  const [hour, count] = entries[0];
  return `${hour}h com ${count} acesso${count === 1 ? '' : 's'}`;
}

function recentEvents(rows, limit) {
  return rows
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, limit || 10)
    .map((event) => ({
      created_at: event.created_at || '',
      event_type: event.event_type || '',
      source: event.source || '',
      source_detail: event.source_detail || '',
      dish_name: event.dish_name || '',
      dish_category: event.dish_category || '',
      observe_seconds: event.observe_seconds || '',
      device_type: event.device_type || '',
    }));
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
