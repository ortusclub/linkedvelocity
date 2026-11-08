function parseCSV(csv) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      // parseCSV only splits lines; preserve quote characters verbatim so
      // splitCSVLine can use them to delimit fields. Without this, a field
      // like "url,with,commas" lost its quotes here and splitCSVLine then
      // treated every comma as a field separator.
      if (inQuotes && csv[i + 1] === '"') {
        current += '""'; // preserve the escaped-quote pair
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (ch === '\r' && !inQuotes) {
      // skip \r
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    if (values.every(v => !v.trim())) continue; // skip empty rows

    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] || '').trim();
    }
    rows.push(row);
  }

  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Like parseCSV, but tags each non-empty data row with the 1-based sheet row
 * number the operator sees in Google Sheets (header = row 1, first data row =
 * row 2). Blank sheet rows are skipped but still advance the counter, so the
 * numbers stay aligned with the actual spreadsheet — this is what lets the UI
 * offer a "scrape rows 2–10" picker that matches what's on screen.
 * @param {string} csv
 * @returns {{ rowNumber: number, row: Record<string, string> }[]}
 */
export async function sheetRows(sheetUrl){
 const url=new URL(sheetUrl);
 const id=url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
 if(url.protocol!=='https:'||url.hostname!=='docs.google.com'||!id)throw Error('Use a Google Sheets URL.');
 const gid=url.searchParams.get('gid')||new URLSearchParams(url.hash.slice(1)).get('gid')||'0';
 if(!/^\d+$/.test(gid))throw Error('Invalid sheet tab.');
 const response=await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Could not read the cold sheet. Share it as anyone with the link can view, as required by Outreach.');
 const text=await response.text();
 if(text.length>10000000||/^\s*</.test(text))throw Error('The sheet did not return a usable CSV file.');
 return parseCSV(text);
}
export async function workspaceProfiles(account){
 const token=account==='linkedvelocity'?process.env.GOLOGIN_API_TOKEN_KLABBER:process.env.GOLOGIN_API_TOKEN;
 if(!token)throw Error(`The ${account} browser workspace is not configured.`);
 const profiles=[];
 for(let page=1;page<=100;page++){
  const response=await fetch(`https://api.gologin.com/browser/v2?page=${page}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000),cache:'no-store'});
  if(!response.ok){
   // Name the refusal. The bare message hid whether GoLogin said 401 (bad token),
   // 403 (plan or workspace membership) or 429 (rate limit), so 17 accounts sat in
   // start-failed cooldown with no way to tell which (Sam, 2026-11-08).
   const body=(await response.text().catch(()=>'')).replace(/\s+/g,' ').trim().slice(0,120);
   throw Error(`Could not load the ${account} browser workspace (GoLogin HTTP ${response.status}${body?`: ${body}`:''}).`);
  }
  const data=await response.json();
  if(!Array.isArray(data.profiles))throw Error('Browser workspace returned an invalid account list.');
  profiles.push(...data.profiles.map(p=>({id:p.id,name:p.name||'',account,available:true})));
  if(data.profiles.length<30)return profiles;
 }
 throw Error('Browser workspace list is incomplete.');
}
