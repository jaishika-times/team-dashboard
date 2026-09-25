import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// One live sheet, one tab per Knowledge team member — Jon, Divya, Nic (a "template" tab also
// exists for new joiners to copy, and is deliberately left out of PEOPLE below). Same shape
// as CSE's tracker: Day / Date / Task / Description / Hours (or "Mins") / Remarks, but column
// order and date formatting still vary per person, so columns are found by header keyword and
// dates are parsed rather than trusted to be in a fixed format or sheet order.
const SPREADSHEET_ID = "1em2UkWUSMLYI05H6zDcWAjMv87HxtALf3sSHSg7jF78";
const PEOPLE = ["Jon", "Divya", "Nic"];

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const creds = JSON.parse(raw);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

const MONTH_NAMES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Each person's tab formats its Date column differently (a real Date cell renders as
// "4/9/2026" or similar, a plain-text cell might just say "4 Sept" with no year) — so the
// dropdown can't rely on sheet row order (people re-enter rows non-chronologically, newest
// on top for some, oldest on top for others). This parses whatever shows up into a real,
// sortable date, so the "which day am I looking at" dropdown lists them in true order.
function parseAnyDate(text, refDate) {
  if (!text) return null;
  const t = String(text).trim();

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    a = parseInt(a, 10); b = parseInt(b, 10);
    y = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    // Org locale is day-first (D/M/YYYY); fall back to month-first only when day-first is impossible.
    let day = a, month = b;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    return new Date(Date.UTC(y, month - 1, day));
  }

  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?\s*,?\s*(\d{4})?$/);
  if (m) {
    const mon = MONTH_NAMES[m[2].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    const day = parseInt(m[1], 10);
    let year = m[3] ? parseInt(m[3], 10) : null;
    if (year === null) {
      year = refDate.getUTCFullYear();
      const candidate = new Date(Date.UTC(year, mon, day));
      if (candidate.getTime() - refDate.getTime() > 60 * 24 * 3600 * 1000) year -= 1;
    }
    return new Date(Date.UTC(year, mon, day));
  }

  m = t.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\,?\s*(\d{4})?$/);
  if (m) {
    const mon = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    const day = parseInt(m[2], 10);
    let year = m[3] ? parseInt(m[3], 10) : null;
    if (year === null) {
      year = refDate.getUTCFullYear();
      const candidate = new Date(Date.UTC(year, mon, day));
      if (candidate.getTime() - refDate.getTime() > 60 * 24 * 3600 * 1000) year -= 1;
    }
    return new Date(Date.UTC(year, mon, day));
  }

  return null;
}

function findCol(header, keywords) {
  for (let i = 0; i < header.length; i++) {
    const h = (header[i] || "").toLowerCase();
    if (keywords.some(k => h.includes(k))) return i;
  }
  return -1;
}

// A plain number ("0.5") is already hours. Text like "30 mins" / "1 hours" / "30 mints"
// (typo) is parsed by unit; a cell with several lines has each line's number summed.
function parseHours(raw) {
  if (raw === null || raw === undefined || raw === "") return 0;
  const lines = String(raw).trim().split("\n").filter(l => l.trim());
  let total = 0;
  for (const line of lines) {
    const m = line.match(/([\d.]+)\s*(hour|hr|min|mint)?/i);
    if (!m) continue;
    const num = parseFloat(m[1]);
    if (isNaN(num)) continue;
    const unit = (m[2] || "").toLowerCase();
    total += unit.startsWith("min") ? num / 60 : num;
  }
  return Math.round(total * 100) / 100;
}

function parsePersonTab(rows, personName) {
  // Header is whichever of the first 3 rows actually contains "task".
  let headerIdx = -1;
  for (let r = 0; r < Math.min(rows.length, 3); r++) {
    if (rows[r].some(c => (c || "").toLowerCase().includes("task"))) { headerIdx = r; break; }
  }
  if (headerIdx === -1) return { person: personName, entries: [], debug: { issue: "no header row with 'task' found in first 3 rows", first3Rows: rows.slice(0, 3) } };

  const header = rows[headerIdx];
  const dayCol = findCol(header, ["day"]);
  const dateCol = findCol(header, ["date"]);
  const taskCol = findCol(header, ["task"]);
  const descCol = findCol(header, ["description"]);
  const hoursCol = findCol(header, ["hour", "min"]);
  // A dedicated "Remarks" column is preferred; "Status" (Done/Progress/etc) is the fallback
  // for tabs that don't have a separate remarks field.
  let remarksCol = findCol(header, ["remark"]);
  if (remarksCol === -1) remarksCol = findCol(header, ["status"]);

  // Some tabs repeat the header row again further down (e.g. a new month's block). If it
  // isn't skipped, "Day"/"Date"/"Task" land in the data as a garbage entry with an
  // unparseable date. Detected generically: the row's Day/Date/Task cells match their own
  // column headers verbatim.
  const isHeaderRepeat = row => {
    const checks = [dayCol, dateCol, taskCol].filter(c => c >= 0);
    if (!checks.length) return false;
    return checks.every(c => {
      const v = (row[c] || "").trim().toLowerCase();
      return v !== "" && v === (header[c] || "").trim().toLowerCase();
    });
  };

  let currentDay = "", currentDate = "";
  const entries = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isHeaderRepeat(row)) continue;
    if (dayCol >= 0 && (row[dayCol] || "").trim()) currentDay = row[dayCol].trim();
    if (dateCol >= 0 && (row[dateCol] || "").trim()) currentDate = row[dateCol].trim();
    const task = taskCol >= 0 ? (row[taskCol] || "").trim() : "";
    const description = descCol >= 0 ? (row[descCol] || "").trim() : "";
    if (!task && !description) continue; // fully blank row (an empty time slot)
    const hours = hoursCol >= 0 ? parseHours(row[hoursCol]) : 0;
    const remarks = remarksCol >= 0 ? (row[remarksCol] || "").trim() : "";
    const parsedDate = parseAnyDate(currentDate, new Date());
    entries.push({
      day: currentDay,
      date: currentDate,
      dateKey: parsedDate ? parsedDate.toISOString().slice(0, 10) : null,
      task, description, hours, remarks,
    });
  }
  return { person: personName, entries };
}

export async function GET() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      ranges: PEOPLE,
      fields: "sheets.properties.title,sheets.data.rowData.values(formattedValue)",
    });
    const sheetsData = res.data.sheets || [];

    const people = PEOPLE.map(name => {
      const sheetEntry = sheetsData.find(s => s.properties.title === name);
      const rowData = sheetEntry?.data?.[0]?.rowData || [];
      const rows = rowData.map(r => (r.values || []).map(v => v.formattedValue || ""));
      return parsePersonTab(rows, name);
    });

    return NextResponse.json({ people }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
