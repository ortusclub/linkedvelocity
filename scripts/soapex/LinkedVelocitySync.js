/** SoAPEX: refresh only Linked Velocity Rented Accounts. */
const SOAPEX_LV = Object.freeze({
  spreadsheetId: '1afz74O3UHJvv_VA_b6NE-Gi6RYc0M13Ee1h_KtvCMzg',
  sheetId: 323579749, sheetName: 'LinkedIn Accounts',
  endpoint: 'https://linkedvelocity.com/api/integrations/soapex-rentals',
  marker: 'Linked Velocity Rented Accounts',
  hours: 4, buttonTitle: 'SoAPEX LinkedVelocity refresh',
});

function soapexLvEmail_(v) { return String(v || '').trim().toLowerCase(); }
function soapexLvUrl_(v) {
  return String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[?#]/)[0].replace(/\/$/, '');
}
function soapexLvCurrent_(r) { return ['active', 'pending_access', 'payment_failed'].indexOf(r.status) >= 0; }

// Pure planner: never rewrites whole rows, sorts accounts, removes history,
// touches credentials or writes any campaign/credit/operator field.
function soapexLvPlan_(rows, feed) {
  if (feed.schemaVersion !== 1 || feed.renter !== 'info@apexstrategy.io' || !Array.isArray(feed.rentals)) throw Error('Unexpected Apex rental feed');
  const marker = rows.findIndex(r => r[0] === SOAPEX_LV.marker);
  if (marker < 1 || rows[0][0] !== 'Email' || rows[0][1] !== 'Status') throw Error('Sheet layout changed; no rental changes made');
  // This section is currently last. Stop at any new non-email section header.
  let end = rows.length;
  for (let i = marker + 1; i < rows.length; i++) {
    if (rows[i][0] && !String(rows[i][0]).includes('@')) { end = i; break; }
  }
  const byEmail = {}, byUrl = {}, allEmails = {};
  rows.forEach((r, i) => { if (String(r[0] || '').includes('@')) (allEmails[soapexLvEmail_(r[0])] || (allEmails[soapexLvEmail_(r[0])] = [])).push(i); });
  for (let i = marker + 1; i < end; i++) {
    const e = soapexLvEmail_(rows[i][0]), u = soapexLvUrl_(rows[i][7]);
    if (e) (byEmail[e] || (byEmail[e] = [])).push(i);
    if (u) (byUrl[u] || (byUrl[u] = [])).push(i);
  }
  // The feed is newest-first. A still-open rental wins over a historical
  // replacement for the same account, including an older still-open rental.
  const identities = {};
  feed.rentals.forEach(r => {
    if (!r.accountId || !r.rentalId) throw Error('Incomplete rental identity');
    const old = identities[r.accountId];
    if (!old || (!soapexLvCurrent_(old) && soapexLvCurrent_(r))) identities[r.accountId] = r;
  });
  const edits = [], additions = [], warnings = [], claimed = {};
  const sourceEmails = {}, sourceUrls = {};
  Object.values(identities).filter(soapexLvCurrent_).forEach(r => {
    const e = soapexLvEmail_(r.email), u = soapexLvUrl_(r.url);
    if (e && sourceEmails[e] && sourceEmails[e] !== r.accountId) warnings.push('Duplicate current source email: ' + e);
    if (u && sourceUrls[u] && sourceUrls[u] !== r.accountId) warnings.push('Duplicate current source LinkedIn identity: ' + u);
    if (e) sourceEmails[e] = r.accountId;
    if (u) sourceUrls[u] = r.accountId;
  });
  const put = (row, col, value, note) => edits.push({ row, col, value, note });
  Object.keys(identities).forEach(id => {
    const r = identities[id], current = soapexLvCurrent_(r), email = soapexLvEmail_(r.email), url = soapexLvUrl_(r.url);
    const emailHits = email ? byEmail[email] || [] : [], urlHits = url ? byUrl[url] || [] : [];
    const hits = [...new Set(emailHits.concat(urlHits))];
    if (hits.length > 1) { warnings.push('Ambiguous existing identity: ' + (email || r.name)); return; }
    const outside = email ? (allEmails[email] || []).filter(i => i <= marker || i >= end) : [];
    if (!hits.length && outside.length) { if (current) warnings.push('Identity also belongs to another section: ' + email); return; }
    const note = 'LinkedVelocity rental ' + r.rentalId + '; status: ' + r.status + (r.paused ? '; paused' : '') + (r.beingPrepared ? '; being prepared' : '') + '; checked ' + feed.fetchedAt;
    if (!hits.length) {
      if (!current) return; // Do not import historic rentals absent from this sheet.
      if (!email || !email.includes('@')) { warnings.push('Current rental has no login email: ' + r.name); return; }
      additions.push({ email, name: r.name || '', url: r.url || '', status: r.restricted ? 'Identity Restricted' : 'Rented', hasSalesNav: r.hasSalesNav, verified: r.verified, note });
      return;
    }
    const i = hits[0], row = rows[i];
    if (claimed[i]) { warnings.push('Two source accounts match one row: ' + email); return; }
    claimed[i] = true;
    // Leave human restriction/inaccessible labels intact. Only ordinary rental
    // lifecycle labels are managed here; restriction history is never cleared.
    let status = row[1] || '';
    if (current) {
      if (r.restricted && ['Rented', 'Past Rental', ''].includes(status)) status = 'Identity Restricted';
      else if (['Past Rental', 'Rented', ''].includes(status)) status = 'Rented';
    } else if (status === 'Rented') status = 'Past Rental';
    put(i, 1, status, note);
    // Only fill missing identity values, preserving manually corrected names,
    // employer data, source/provenance, login flags and all columns I onward.
    if (!row[6] && r.name) put(i, 6, r.name);
    if (!row[7] && r.url) put(i, 7, r.url);
  });
  return { marker, end, edits, additions, warnings,
    current: Object.values(identities).filter(soapexLvCurrent_).length };
}

function soapexLvApi_(method, suffix, payload) {
  const response = UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + SOAPEX_LV.spreadsheetId + suffix, {
    method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    contentType: 'application/json', muteHttpExceptions: true,
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
  if (response.getResponseCode() >= 300) throw Error('SoAPEX Sheets API failed (' + response.getResponseCode() + ')');
  return JSON.parse(response.getContentText());
}
function soapexLvCellRequest_(row, col, value, note) {
  const cell = { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value) } };
  if (note !== undefined) cell.note = note;
  return { updateCells: {
    range: { sheetId: SOAPEX_LV.sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: col, endColumnIndex: col + 1 },
    rows: [{ values: [cell] }], fields: 'userEnteredValue' + (note !== undefined ? ',note' : ''),
  } };
}
function soapexLvRead_() {
  const meta = soapexLvApi_('get', '?fields=sheets(properties,merges)');
  const tab = meta.sheets.find(s => s.properties.sheetId === SOAPEX_LV.sheetId);
  if (!tab || tab.properties.title !== SOAPEX_LV.sheetName) throw Error('Target tab identity changed');
  const count = tab.properties.gridProperties.rowCount;
  if (count > 10000) throw Error('Rental tab unexpectedly large; review required');
  const data = soapexLvApi_('get', '/values/' + encodeURIComponent("'" + SOAPEX_LV.sheetName + "'!A1:AG" + count) + '?valueRenderOption=UNFORMATTED_VALUE');
  const rows = data.values || [];
  while (rows.length < count) rows.push([]);
  return { rows, count, tab };
}

function soapexRefreshLinkedVelocity() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw Error('A rental refresh is already running');
  try {
    const key = PropertiesService.getScriptProperties().getProperty('SOAPEX_RENTALS_SYNC_KEY');
    if (!key) throw Error('Apex rental sync connection is not configured');
    const response = UrlFetchApp.fetch(SOAPEX_LV.endpoint, { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw Error('LinkedVelocity rental lookup failed (' + response.getResponseCode() + '); existing accounts retained');
    const feed = JSON.parse(response.getContentText());
    if (!feed.fetchedAt || !Number.isFinite(Date.parse(feed.fetchedAt)) || Math.abs(Date.now() - Date.parse(feed.fetchedAt)) > 300000) throw Error('Rental feed is stale');
    const snapshot = soapexLvRead_(), plan = soapexLvPlan_(snapshot.rows, feed);
    if (plan.warnings.length) throw Error('Rental sync held for identity review: ' + plan.warnings.join('; '));
    const requests = plan.edits.map(e => soapexLvCellRequest_(e.row, e.col, e.value, e.note));
    // Append new rentals at the end of the section. Inserting cells/rows in
    // existing accounts would race the live campaign outcome writers.
    let appendAt = plan.end;
    while (appendAt > plan.marker + 1 && !snapshot.rows[appendAt - 1].some(v => v !== '' && v != null)) appendAt--;
    if (plan.additions.length && plan.end < snapshot.count) throw Error('A following section exists; manual layout review required');
    if (appendAt + plan.additions.length > snapshot.count) requests.unshift({ appendDimension: { sheetId: SOAPEX_LV.sheetId, dimension: 'ROWS', length: appendAt + plan.additions.length - snapshot.count } });
    plan.additions.forEach((r, n) => {
      const i = appendAt + n;
      requests.push({ copyPaste: {
        source: { sheetId: SOAPEX_LV.sheetId, startRowIndex: plan.marker + 1, endRowIndex: plan.marker + 2, startColumnIndex: 0, endColumnIndex: 33 },
        destination: { sheetId: SOAPEX_LV.sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 33 },
        pasteType: 'PASTE_FORMAT',
      } });
      requests.push({ copyPaste: {
        source: { sheetId: SOAPEX_LV.sheetId, startRowIndex: plan.marker + 1, endRowIndex: plan.marker + 2, startColumnIndex: 0, endColumnIndex: 33 },
        destination: { sheetId: SOAPEX_LV.sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 33 },
        pasteType: 'PASTE_DATA_VALIDATION',
      } });
      [[0, r.email], [1, r.status], [6, r.name], [7, r.url], [10, r.hasSalesNav ? 'Yes' : 'No'], [11, r.verified ? 'Yes' : 'No'], [15, 'LinkedVelocity']].forEach(([col, value]) => requests.push(soapexLvCellRequest_(i, col, value, col === 1 ? r.note : undefined)));
    });
    if (requests.length) soapexLvApi_('post', ':batchUpdate', { requests });
    const checked = soapexLvRead_(), remaining = soapexLvPlan_(checked.rows, feed);
    if (remaining.additions.length || remaining.warnings.length) throw Error('Rental sync readback incomplete; success time not advanced');
    plan.edits.forEach(e => { if ((checked.rows[e.row][e.col] || '') !== (e.value || '')) throw Error('Rental sync readback mismatch'); });
    const now = new Date(), next = soapexLvNext_(now), serial = d => d.getTime() / 86400000 + 25569;
    soapexLvApi_('post', ':batchUpdate', { requests: [
      soapexLvCellRequest_(1, 1, 'LV updated (UTC)'), soapexLvCellRequest_(1, 3, serial(now)),
      soapexLvCellRequest_(1, 6, 'Next due (UTC)'), soapexLvCellRequest_(1, 8, serial(next)),
      soapexLvCellRequest_(1, 13, plan.current + ' open Apex rentals · every 4h'),
      ...[3, 8].map(col => ({ repeatCell: { range: { sheetId: SOAPEX_LV.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: col, endColumnIndex: col + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd-mmm-yyyy hh:mm "UTC"' } } }, fields: 'userEnteredFormat.numberFormat' } })),
    ] });
    PropertiesService.getScriptProperties().setProperty('SOAPEX_LV_LAST_SUCCESS', now.toISOString());
    return { current: plan.current, added: plan.additions.length, lastSuccess: now.toISOString(), nextDue: next.toISOString() };
  } catch (e) {
    try { soapexLvApi_('post', ':batchUpdate', { requests: [soapexLvCellRequest_(1, 13, 'LV refresh failed — ' + String(e.message || e).slice(0, 250))] }); } catch (_) {}
    throw e;
  } finally { lock.releaseLock(); }
}

// Only the installed four-hour trigger advances the due time. The manual
// button always refreshes immediately and never delays the scheduled run.
function soapexLvNext_(now) {
  const saved = PropertiesService.getScriptProperties().getProperty('SOAPEX_LV_NEXT_DUE');
  return saved ? new Date(saved) : new Date(now.getTime() + 14400000);
}
function soapexLvScheduledRefresh() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SOAPEX_LV_NEXT_DUE', new Date(Date.now() + 14400000).toISOString());
  soapexRefreshLinkedVelocity();
}

function soapexInstallLinkedVelocitySync() {
  if (!PropertiesService.getScriptProperties().getProperty('SOAPEX_RENTALS_SYNC_KEY')) throw Error('Set the Apex-only SOAPEX_RENTALS_SYNC_KEY script property first');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getId() !== SOAPEX_LV.spreadsheetId) throw Error('Wrong workbook');
  const sheet = ss.getSheets().find(s => s.getSheetId() === SOAPEX_LV.sheetId);
  const snapshot = soapexLvRead_();
  const own = snapshot.rows[1][1] === 'LV updated (UTC)';
  if (!own && snapshot.rows[1].slice(1, 16).some(v => v !== '' && v != null)) throw Error('Top control area is occupied; existing values preserved');
  const groups = [[1, 3], [3, 6], [6, 8], [8, 11], [11, 13], [13, 16]];
  if (!own) {
    const overlap = (snapshot.tab.merges || []).some(r => r.startRowIndex <= 1 && r.endRowIndex > 1 && r.startColumnIndex < 16 && r.endColumnIndex > 1);
    if (overlap) throw Error('Top control area has existing merged cells; review required');
    soapexLvApi_('post', ':batchUpdate', { requests: groups.map(([start, end]) => ({ mergeCells: { range: { sheetId: SOAPEX_LV.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: start, endColumnIndex: end }, mergeType: 'MERGE_ALL' } })) });
  }
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'soapexLvScheduledRefresh');
  if (!existing.length) ScriptApp.newTrigger('soapexLvScheduledRefresh').timeBased().everyHours(4).create();
  existing.slice(1).forEach(t => ScriptApp.deleteTrigger(t));
  // The over-cell image is a real Sheets button with an assigned function.
  let button = sheet.getImages().find(i => i.getAltTextTitle() === SOAPEX_LV.buttonTitle);
  if (!button) button = sheet.insertImage(Utilities.newBlob(Utilities.base64Decode(SOAPEX_LV_BUTTON_PNG), 'image/png', 'refresh.png'), 12, 2);
  button.setAltTextTitle(SOAPEX_LV.buttonTitle).setAltTextDescription('Refresh Apex LinkedVelocity rentals now, regardless of schedule').assignScript('soapexRefreshLinkedVelocity').setWidth(144).setHeight(28);
  soapexLvApi_('post', ':batchUpdate', { requests: [{ updateDimensionProperties: { range: { sheetId: SOAPEX_LV.sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }] });
  if (!existing.length || !PropertiesService.getScriptProperties().getProperty('SOAPEX_LV_NEXT_DUE')) PropertiesService.getScriptProperties().setProperty('SOAPEX_LV_NEXT_DUE', new Date(Date.now() + 14400000).toISOString());
  const result = soapexRefreshLinkedVelocity();
  console.log(JSON.stringify(result));
}

const SOAPEX_LV_BUTTON_PNG = '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';
