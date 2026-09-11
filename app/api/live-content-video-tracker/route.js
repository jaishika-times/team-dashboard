import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// One live sheet, one tab per Content/Video team member. Structure verified against the real
// file: row 0 is the person's name (merged), row 1 is the real header, row 2 is a
// field-description row (not data), row 3+ is real data. Day/Date are merged across however
// many rows belong to that day — blank on every row after the first for that day, so they're
// carried forward. "Time Spent" already has a pre-computed decimal-hours column right next to
// the free-text one, so hours don't need to be parsed from text like CSE's sheet did.
const SPREADSHEET_ID = "1aInUZ19K0wd3sXn_NPXEIK0eD3gWak7PYM0QsjN-nUw";
const CONTENT_PEOPLE = ["Rosie", "Jeremiah", "Mahal", "Ian"];
const VIDEO_PEOPLE = ["Vanessa", "Nick", "Roshan", "Zul"];
const DESIGN_PEOPLE = ["Marcus", "Fatanah", "Aiem"];

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

function parseHoursFromText(raw) {
  if (!raw) return 0;
  const m = String(raw).trim().match(/([\d.]+)\s*(hour|hr|min|mint)?/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return 0;
  const unit = (m[2] || "").toLowerCase();
  return unit.startsWith("min") ? num / 60 : num;
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
  const activityCol = findCol(header, ["activity"]);
  const clientCol = findCol(header, ["client"]);
  const taskCol = findCol(header, ["task"]);
  // "Time Spent" is a merged header over two columns — the free-text one ("2h 30m") and the
  // pre-computed decimal-hours one right after it. Only the first cell carries visible header
  // text; the second is blank, so it has to be taken by position (confirmed: column G), not by
  // searching for a repeated "Time Spent" label that was never actually there.
  const timeTextCol = findCol(header, ["time spent"]);
  const timeDecimalCol = timeTextCol !== -1 ? timeTextCol + 1 : -1;
  const notesCol = findCol(header, ["notes", "description"]);

  let currentDay = "", currentDate = "";
  const entries = [];
  for (let r = headerIdx + 2; r < rows.length; r++) { // +2 skips the field-description row too
    const row = rows[r];
    if (dayCol >= 0 && (row[dayCol] || "").trim()) currentDay = row[dayCol].trim();
    if (dateCol >= 0 && (row[dateCol] || "").trim()) currentDate = row[dateCol].trim();
    const task = taskCol >= 0 ? (row[taskCol] || "").trim() : "";
    if (!task) continue; // an empty slot for that day
    const activityType = activityCol >= 0 ? (row[activityCol] || "").trim() : "";
    const client = clientCol >= 0 ? (row[clientCol] || "").trim() : "";
    const notes = notesCol >= 0 ? (row[notesCol] || "").trim() : "";
    let hours = 0;
    if (timeDecimalCol >= 0 && (row[timeDecimalCol] || "").trim()) {
      const v = parseFloat(row[timeDecimalCol].trim());
      hours = isNaN(v) ? 0 : v;
    } else if (timeTextCol >= 0) {
      hours = parseHoursFromText(row[timeTextCol]);
    }
    hours = Math.round(hours * 100) / 100;
    entries.push({ day: currentDay, date: currentDate, activityType, client, task, hours, notes });
  }
  return { person: personName, entries };
}

async function fetchTeam(sheets, people) {
  // Google Sheets range requests need the EXACT tab title, whitespace included — a tab
  // literally named "Ian " (trailing space) will fail to match a request for "Ian". Fetching
  // the real tab list first and matching by trimmed name protects every person here from this,
  // not just the one that happened to break.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: "sheets.properties.title" });
  const allTitles = (meta.data.sheets || []).map(s => s.properties.title);
  const resolvedNames = people.map(name => allTitles.find(t => t.trim().toLowerCase() === name.trim().toLowerCase()) || name);

  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    ranges: resolvedNames,
    fields: "sheets.properties.title,sheets.data.rowData.values(formattedValue)",
  });
  const sheetsData = res.data.sheets || [];
  return people.map((name, i) => {
    const sheetEntry = sheetsData.find(s => s.properties.title === resolvedNames[i]);
    const rowData = sheetEntry?.data?.[0]?.rowData || [];
    const rows = rowData.map(r => (r.values || []).map(v => v.formattedValue || ""));
    return parsePersonTab(rows, name);
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const team = searchParams.get("team"); // "Content" or "Video"
  const people = team === "Video" ? VIDEO_PEOPLE : team === "Design" ? DESIGN_PEOPLE : CONTENT_PEOPLE;
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const peopleData = await fetchTeam(sheets, people);
    return NextResponse.json({ people: peopleData }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
