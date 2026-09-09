import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// One live sheet, one tab per CSE team member — Jev, Jon, Shiman, Mika, Naz. Each person's
// tab has genuinely different column order and header wording (verified against the real
// file): some have a TIME column, some don't; the hours column is called "Mins" for one
// person (but the values are actually hours — a known mislabel, per instruction) and
// "Total Hours/Min Taken" for others (values as free text like "30 mins", "1 hours", with
// typos like "mints"). Columns are found by header keyword, not fixed position, so this
// holds up across all five without needing a special case per person.
const SPREADSHEET_ID = "1ZjlZyHqJT4_XNdyvTLPR7EQiB8y850i2egVGR961UOA";
const PEOPLE = ["Jev", "Shiman", "Mika", "Naz"];

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

function findCol(header, keywords) {
  for (let i = 0; i < header.length; i++) {
    const h = (header[i] || "").toLowerCase();
    if (keywords.some(k => h.includes(k))) return i;
  }
  return -1;
}

// A plain number ("0.5") is already hours — one person's sheet literally mislabels this
// column "Mins" even though the values are hours, per instruction to ignore that label.
// Text like "30 mins" / "1 hours" / "30 mints" (typo) is parsed by unit; a cell with several
// lines (seen in real data) has each line's number summed.
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

  let currentDay = "", currentDate = "";
  const entries = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (dayCol >= 0 && (row[dayCol] || "").trim()) currentDay = row[dayCol].trim();
    if (dateCol >= 0 && (row[dateCol] || "").trim()) currentDate = row[dateCol].trim();
    const task = taskCol >= 0 ? (row[taskCol] || "").trim() : "";
    const description = descCol >= 0 ? (row[descCol] || "").trim() : "";
    if (!task && !description) continue; // fully blank row (an empty time slot)
    const hours = hoursCol >= 0 ? parseHours(row[hoursCol]) : 0;
    const remarks = remarksCol >= 0 ? (row[remarksCol] || "").trim() : "";
    entries.push({ day: currentDay, date: currentDate, task, description, hours, remarks });
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
