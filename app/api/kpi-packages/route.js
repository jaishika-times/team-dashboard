import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Each team's KPI files live in a genuinely different arrangement — some flat, some nested,
// some one tab per month, some one tab labeled with whatever the current month is. This route
// is built team-by-team (not one generic parser) so each team's real layout gets verified
// before being trusted. Currently implemented: Edunexa. Others return "not_built_yet" and the
// dashboard falls back to a plain Drive folder link for those.
const TEAM_CONFIG = {
  Edunexa: {
    type: "folder_scan",
    rootFolderId: "1-w4pfSZVErco_3xbI21eL5utU94GaLOw",
    // one known subfolder that also holds people directly (Knowledge Engineers)
    subfolderIds: ["1XqxjEJdAb6m-blLGslBHakCNcIrmaaIY"],
  },
  "Video Team": {
    type: "folder_scan",
    rootFolderId: "1HRCjmkjr2DESfQEOanf5tfWF4Ij-PiMJ",
    subfolderIds: [],
  },
  // Account Managers has an actual maintained master summary sheet — Staff x Month, one
  // row per person — instead of relying on each person's own scattered, differently-shaped
  // KPI file. Far more reliable than folder-scanning their nested per-person subfolders.
  "Account Managers": {
    type: "summary_sheet",
    spreadsheetId: "1p5l3mlM7ajzn0BXajSctdpodGLopK_4b4SMHZ1srgRo",
    tabName: "2026",
    folderUrl: "https://drive.google.com/drive/folders/1_f9cPXG3KujNtXP3LvzUg84CwQscm-T_",
  },
};

const MONTH_ABBR_MAP = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
  june: "June", jul: "July", july: "July", aug: "August", sep: "September", sept: "September",
  oct: "October", nov: "November", dec: "December",
};
function normalizeMonthHeader(h) {
  const key = (h || "").trim().toLowerCase().replace(/\.$/, "");
  return MONTH_ABBR_MAP[key] || null;
}

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const creds = JSON.parse(raw);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
}

async function listSpreadsheetsIn(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return res.data.files || [];
}

// "(KPI Jon) ..." / "KPI 2026 (JON) - Edunexa Product Manager" -> "Jon"
function nameFromTitle(title) {
  let m = title.match(/\(KPI\s+([^)]+)\)/i);
  if (m) return m[1].trim();
  m = title.match(/\(([A-Z]{2,})\)/); // e.g. "(JON)"
  if (m) return m[1].charAt(0) + m[1].slice(1).toLowerCase();
  return title;
}

const MONTH_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i;

function cellText(row, c) {
  return row?.[c]?.formattedValue || "";
}

async function getPersonScore(sheets, fileId, fileName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: fileId, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets || []).map(s => s.properties.title);
  // Prefer a tab literally called "KPI Scores"; otherwise first tab matching that prefix.
  const tabToUse = titles.find(t => /^KPI Scores$/i.test(t)) || titles.find(t => /^KPI Scores/i.test(t)) || titles[0];
  if (!tabToUse) return null;

  const res = await sheets.spreadsheets.get({
    spreadsheetId: fileId,
    ranges: [tabToUse],
    fields: "sheets.data.rowData.values(formattedValue)",
  });
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const rows = rowData.map(r => r.values || []);

  // Detect every distinct month mentioned across the header rows, left to right, in the
  // order they appear as columns — some teams' sheets add a new month's columns each month
  // (so there can be several), others currently only have one.
  const months = [];
  for (let r = 0; r < Math.min(rows.length, 3); r++) {
    for (const cell of rows[r]) {
      const m = (cell.formattedValue || "").match(MONTH_RE);
      if (m && !months.includes(m[1])) months.push(m[1]);
    }
  }

  // Find the "KPI SCORE FOR THE MONTH" row and take up to months.length values after the
  // label, left to right — capped at that count so an unrelated table sharing the same row
  // (some sheets have a little rating-legend table butted up against it) never gets scooped in.
  const scoreByMonth = {};
  for (const row of rows) {
    const label = cellText(row, 0).trim().toLowerCase();
    if (label.includes("kpi score for the month") || label.includes("total kpi score")) {
      const vals = [];
      for (let i = 1; i < row.length && vals.length < months.length; i++) {
        const v = row[i]?.formattedValue;
        if (v && v.trim()) vals.push(v.trim());
      }
      months.forEach((m, idx) => { if (vals[idx]) scoreByMonth[m] = vals[idx]; });
      break;
    }
  }

  return {
    name: nameFromTitle(fileName),
    months: months.map(m => {
      const score = scoreByMonth[m] || null;
      // A KPI score reasonably sits in the 0-100ish range (a bit over 100 for "exceeds
      // target" categories is normal). Anything wildly outside that is almost certainly a
      // broken formula in the source sheet, not a real score — flag it instead of hiding it.
      const numeric = score ? parseFloat(score.replace(/[^0-9.-]/g, "")) : null;
      const flagged = numeric !== null && !isNaN(numeric) && (numeric > 150 || numeric < 0);
      return { month: m, score, flagged };
    }), // null score = genuinely not scored yet
    sheetUrl: `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
  };
}

// The master summary sheet has one row per person and one column per month, already
// aggregated — no digging through individual files needed. Some cells hold a real numeric
// score; others hold a status note instead (resigned, on leave, not updated yet) — those
// are surfaced as a note rather than forced into a fake score.
async function getSummarySheetPeople(sheets, spreadsheetId, tabName) {
  // Fetch the real tab names first — if "tabName" doesn't match exactly (trailing space,
  // different casing, sheet got renamed), this tells us that immediately instead of just
  // silently returning nothing.
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const availableTabs = (meta.data.sheets || []).map(s => s.properties.title);
  const actualTab = availableTabs.find(t => t === tabName) || availableTabs.find(t => t.trim().toLowerCase() === tabName.trim().toLowerCase());
  if (!actualTab) {
    return { people: [], debug: { availableTabs, requestedTab: tabName, issue: "requested tab not found among the sheet's actual tabs" } };
  }

  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [actualTab],
    fields: "sheets.data.rowData.values(formattedValue)",
  });
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const rows = rowData.map(r => (r.values || []).map(v => v.formattedValue || ""));
  if (!rows.length) {
    return { people: [], debug: { availableTabs, requestedTab: tabName, matchedTab: actualTab, issue: "tab matched but returned zero rows" } };
  }

  // Find the real header row — some sheets have a blank row (or other leading rows) before
  // the actual "Staff, Jan, Feb, ..." header, so scan for it rather than assuming row 0.
  let headerRowIdx = -1;
  let monthCols = [];
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const cols = [];
    rows[r].forEach((h, idx) => {
      const month = normalizeMonthHeader(h);
      if (month && !cols.some(m => m.month === month)) cols.push({ month, col: idx });
    });
    if (cols.length > 0) { headerRowIdx = r; monthCols = cols; break; }
  }
  if (headerRowIdx === -1) {
    return { people: [], debug: { availableTabs, requestedTab: tabName, matchedTab: actualTab, rowCount: rows.length, first5Rows: rows.slice(0, 5), issue: "scanned the first 5 rows but found no row with recognizable month headers" } };
  }

  const people = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[0] || "").trim();
    if (!name) continue;
    const months = monthCols.map(({ month, col }) => {
      const raw = (row[col] || "").trim();
      if (!raw) return { month, score: null, flagged: false };
      const isPureNumber = /^-?[\d.]+%?$/.test(raw);
      if (isPureNumber) {
        const numeric = parseFloat(raw.replace(/[^0-9.-]/g, ""));
        return { month, score: raw, flagged: !isNaN(numeric) && (numeric > 150 || numeric < 0) };
      }
      // Not a plain number — a status note (resigned, on leave, not updated yet, etc).
      return { month, score: null, note: raw, flagged: false };
    });
    people.push({
      name,
      months,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });
  }
  const debug = people.length === 0
    ? { availableTabs, requestedTab: tabName, matchedTab: actualTab, rowCount: rows.length, headerRowIdx, monthColsFound: monthCols.map(m => m.month), issue: "found header row but no data row had a name in column A" }
    : null;
  return { people, debug };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const team = searchParams.get("team");
  const config = TEAM_CONFIG[team];
  if (!config) {
    return NextResponse.json({ status: "not_built_yet" });
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    if (config.type === "summary_sheet") {
      const { people, debug } = await getSummarySheetPeople(sheets, config.spreadsheetId, config.tabName);
      const payload = { status: "ok", team, people };
      if (debug) payload.debug = [{ folderId: `spreadsheet ${config.spreadsheetId}`, filesFound: 0, names: [], error: JSON.stringify(debug) }];
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    }

    // folder_scan (default): each person has their own file, possibly nested in a subfolder.
    const drive = google.drive({ version: "v3", auth });
    const folderIds = [config.rootFolderId, ...(config.subfolderIds || [])];
    const files = [];
    const debugPerFolder = [];
    for (const id of folderIds) {
      let found = [];
      let folderError = null;
      try { found = await listSpreadsheetsIn(drive, id); }
      catch (e) { folderError = e.message; }
      debugPerFolder.push({ folderId: id, filesFound: found.length, names: found.map(f => f.name), error: folderError });
      files.push(...found);
    }

    const people = [];
    for (const f of files) {
      try {
        const p = await getPersonScore(sheets, f.id, f.name);
        if (p) people.push(p);
      } catch (e) {
        people.push({ name: nameFromTitle(f.name), months: [], sheetUrl: `https://docs.google.com/spreadsheets/d/${f.id}/edit`, error: e.message });
      }
    }

    // If nothing was found, include what each folder query actually returned — this is the
    // fastest way to tell "wrong folder shared" apart from "sharing hasn't propagated yet"
    // apart from "genuinely empty" without more back-and-forth guessing.
    const payload = { status: "ok", team, people };
    if (people.length === 0) payload.debug = debugPerFolder;
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ status: "error", error: e.message }, { status: 500 });
  }
}
