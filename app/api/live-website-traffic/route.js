import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Weekly Website Traffic Report — one sheet, three tabs with two different layouts:
//  - "AfterSchool" and "School Advisor": repeating blocks, each starting with a "Date : D Mon -
//    D Mon YYYY" row (current period in columns B-D, the same week a year earlier in columns
//    H-J), a header row, four Channel Group rows (Direct / Organic Search / AI Assistant /
//    Organic Social), then a "Total" row. Blocks are separated by a blank row.
//  - "FB Group": repeating blocks, each starting with a "Facebook Group Weekly Report" title,
//    a "D/M - D/M" date-range row, a "New Members" row and an "Email Database" row (engagement
//    screenshots and top-post sections after that aren't numeric, so they're left out of the
//    sync — the sheet itself is the source for those).
const SPREADSHEET_ID = "1llBrZCmoqrYN3zMKJO4kM8BTX2Q53K_y4tJW75CUaco";
const CHANNEL_TABS = [
  { tabName: "AfterSchool", portal: "AfterSchool" },
  { tabName: "School Advisor", portal: "School Advisor" },
];
const FB_TAB = { tabName: "FB Group", portal: "FB Group" };

const MONTH_INDEX = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

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

function cell(row, i) {
  return (row[i] || "").toString().trim();
}

// The live sheet formats big numbers with thousands separators ("4,127"), and
// parseFloat("4,127") stops at the comma and returns 4 — strip separators first.
function num(text) {
  const cleaned = String(text || "").replace(/,/g, "").trim();
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : v;
}

// "Date : 6 Sep - 12 Sep 2026" -> { startLabel, endLabel, year, endDate }
function parseDateHeader(text) {
  const m = text.match(/Date\s*:\s*(\d{1,2})\s+(\w{3})\w*\s*-\s*(\d{1,2})\s+(\w{3})\w*\s+(\d{4})/i);
  if (!m) return null;
  const [, d1, mon1, d2, mon2, year] = m;
  const monIdx = MONTH_INDEX[mon2.slice(0, 1).toUpperCase() + mon2.slice(1, 3).toLowerCase()];
  const endDate = monIdx !== undefined ? new Date(Date.UTC(parseInt(year, 10), monIdx, parseInt(d2, 10))) : null;
  return { label: `${d1} ${mon1} - ${d2} ${mon2} ${year}`, year: parseInt(year, 10), endDate };
}

function parseChannelTab(rows, portal) {
  const weeks = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const dateText = cell(row, 2); // current-period date header lives in column C
    if (!dateText.toLowerCase().startsWith("date")) continue;
    const current = parseDateHeader(dateText);
    if (!current) continue;
    const priorText = cell(row, 8); // same week, prior year, column I
    const prior = priorText ? parseDateHeader(priorText) : null;

    // Header row is r+1, four channel rows follow, then a "Total" row.
    const channels = [];
    let total = null, priorTotal = null;
    let scan = r + 2;
    while (scan < rows.length) {
      const label = cell(rows[scan], 1);
      if (!label) break;
      const users = num(cell(rows[scan], 2));
      const sessions = num(cell(rows[scan], 3));
      const priorUsers = num(cell(rows[scan], 8));
      const priorSessions = num(cell(rows[scan], 9));
      if (label.toLowerCase() === "total") {
        total = { users, sessions };
        priorTotal = { users: priorUsers, sessions: priorSessions };
        scan++;
        break;
      }
      channels.push({ name: label, users, sessions, priorUsers, priorSessions });
      scan++;
    }
    weeks.push({
      portal,
      weekLabel: current.label,
      endDate: current.endDate ? current.endDate.toISOString().slice(0, 10) : null,
      totalUsers: total?.users ?? 0,
      totalSessions: total?.sessions ?? 0,
      priorYearLabel: prior?.label || null,
      priorYearTotalUsers: priorTotal?.users ?? 0,
      priorYearTotalSessions: priorTotal?.sessions ?? 0,
      channels,
    });
    r = scan - 1;
  }
  return weeks;
}

function guessYear(day, month, refDate) {
  let year = refDate.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  // If that date lands more than ~60 days in the future, it's almost certainly last year's week.
  if (candidate.getTime() - refDate.getTime() > 60 * 24 * 3600 * 1000) {
    year -= 1;
    candidate = new Date(Date.UTC(year, month - 1, day));
  }
  return { year, date: candidate };
}

function parseFbTab(rows) {
  const weeks = [];
  const now = new Date();
  for (let r = 0; r < rows.length; r++) {
    if (cell(rows[r], 0).toLowerCase() !== "facebook group weekly report") continue;
    const rangeText = cell(rows[r + 1], 1);
    const m = rangeText.match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/);
    if (!m) continue;
    const [, d1, mo1, d2, mo2] = m.map(Number);
    const { year, date: endDate } = guessYear(d2, mo2, now);
    const newMembers = num(cell(rows[r + 2], 1));
    const emailDatabase = num(cell(rows[r + 3], 1));
    weeks.push({
      portal: "FB Group",
      weekLabel: `${d1}/${mo1} - ${d2}/${mo2}/${year}`,
      endDate: endDate.toISOString().slice(0, 10),
      newMembers,
      emailDatabase,
    });
    r += 3;
  }
  return weeks;
}

export async function GET() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: "sheets.properties.title" });
    const allTitles = (meta.data.sheets || []).map(s => s.properties.title);
    const resolve = name => allTitles.find(t => t.trim().toLowerCase() === name.trim().toLowerCase()) || name;

    const wantedTabs = [...CHANNEL_TABS.map(t => t.tabName), FB_TAB.tabName].map(resolve);
    const res = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      ranges: wantedTabs,
      fields: "sheets.properties.title,sheets.data.rowData.values(formattedValue)",
    });
    const sheetsData = res.data.sheets || [];
    const rowsFor = title => {
      const entry = sheetsData.find(s => s.properties.title === resolve(title));
      const rowData = entry?.data?.[0]?.rowData || [];
      return rowData.map(r => (r.values || []).map(v => v.formattedValue || ""));
    };

    let weeks = [];
    for (const { tabName, portal } of CHANNEL_TABS) {
      weeks = weeks.concat(parseChannelTab(rowsFor(tabName), portal));
    }
    weeks = weeks.concat(parseFbTab(rowsFor(FB_TAB.tabName)));

    weeks.sort((a, b) => {
      if (a.endDate && b.endDate && a.endDate !== b.endDate) return b.endDate.localeCompare(a.endDate);
      return a.portal.localeCompare(b.portal);
    });

    return NextResponse.json({ weeks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
