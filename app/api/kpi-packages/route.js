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
  "Content Curation Team": {
    type: "folder_scan",
    rootFolderId: "1EUFh1vrkQaaPxeCmO3et51PJInAI16We",
    subfolderIds: [],
  },
  "Design Team": {
    type: "folder_scan",
    rootFolderId: "1I6X5X31LmJuRXULDAqNhJdnMr9nJtWuO",
    subfolderIds: [],
  },
  // Account Managers: each person really does have their own file (nested one level under
  // "2026"), and each one carries the true category-by-category weighted-score breakdown —
  // not just a final total. Verified against the real files before wiring this up.
  "Account Managers": {
    type: "am_individual",
    folderUrl: "https://drive.google.com/drive/folders/1_f9cPXG3KujNtXP3LvzUg84CwQscm-T_",
    people: [
      { name: "Jev", fileId: "1AvVKb4pM7V_buSBfL6UMsagTNKz0oPM8-5okzA4H-AA" },
      { name: "Jon", fileId: "1Gcdqcs5iSrWGk0aQJX7MMlagEGmB_GOEl7t4QSTMEvI" },
      { name: "Nazreen", fileId: "1tsNFRbXP6MBo6UpUcNVpKcz_0y1PKzuLUeyRZ5z0imI" },
      { name: "Mika", fileId: "1yo1D0HoVK5MZXXTfel89OWDb2gM6gq2uTtLHhHT3ric" },
      { name: "Shiman", fileId: "1IpADlylx9iqRLTZFor6vM8J0ZOsyr2_PzocF0QN_zjE" },
    ],
  },
};

// Each person's file spells months differently ("Jan", "JAN", "March", "Mac" — the Malay
// spelling, seen in one real file) — so tabs are matched by alias, not assumed consistent.
const AM_MONTH_ALIASES = {
  jan: "January", january: "January", feb: "February", february: "February",
  mar: "March", march: "March", mac: "March", apr: "April", april: "April",
  may: "May", jun: "June", june: "June", jul: "July", july: "July",
  aug: "August", august: "August", sep: "September", sept: "September", september: "September",
  oct: "October", october: "October", nov: "November", november: "November",
  dec: "December", december: "December",
};
function normalizeAMMonth(tabName) {
  return AM_MONTH_ALIASES[(tabName || "").trim().toLowerCase()] || null;
}

// Pulls the real category-by-category breakdown (KPI name, weightage %, score achieved,
// weighted score) out of one person's file for every month tab that exists — not just the
// final total. Column positions are found by matching header text (some files have a
// leading "Staff Name" column, some don't), and a row only counts as a real KPI category if
// its weightage cell is an actual percentage — this is what keeps "Achievement Criteria"
// rubric rows and merged/legend cells from being mistaken for real data.
async function getAMPersonMonths(sheets, fileId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: fileId, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets || []).map(s => s.properties.title);
  const monthTabs = titles.map(t => ({ tab: t, month: normalizeAMMonth(t) })).filter(m => m.month);
  if (!monthTabs.length) return [];

  const res = await sheets.spreadsheets.get({
    spreadsheetId: fileId,
    ranges: monthTabs.map(m => m.tab),
    fields: "sheets.properties.title,sheets.data.rowData.values(formattedValue)",
  });
  const sheetsData = res.data.sheets || [];

  return monthTabs.map(({ tab, month }) => {
    const sheetEntry = sheetsData.find(s => s.properties.title === tab);
    const rowData = sheetEntry?.data?.[0]?.rowData || [];
    const rows = rowData.map(r => (r.values || []).map(v => v.formattedValue || ""));
    if (!rows.length) return { month, score: null, breakdown: [], flagged: false };

    const headerIdx = rows.findIndex(row => row.some(c => /weightage/i.test(c)));
    if (headerIdx === -1) return { month, score: null, breakdown: [], flagged: false };
    const header = rows[headerIdx];
    const categoryCol = header.findIndex(c => /^kpi$/i.test(c.trim()));
    const weightageCol = header.findIndex(c => /weightage/i.test(c));
    const scoreAchievedCol = header.findIndex(c => /score\s*achieved/i.test(c));
    const kpiScoreCol = header.findIndex(c => /^kpi\s*score$/i.test(c.trim()));

    const breakdown = [];
    let totalScore = null;
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const label0 = (row[0] || "").trim().toLowerCase();
      if (label0.includes("kpi score for the month")) {
        // Read the total from the exact same "KPI Score" column used for every category row
        // below, rather than scanning the row for "the last non-empty cell" — that scan was
        // unreliable against this row's merged cells and any stray trailing content.
        const v = kpiScoreCol >= 0 ? (row[kpiScoreCol] || "").trim() : "";
        if (v) totalScore = v;
        else {
          for (let i = row.length - 1; i >= 1; i--) {
            if (row[i] && row[i].trim()) { totalScore = row[i].trim(); break; }
          }
        }
        continue;
      }
      const wVal = weightageCol >= 0 ? (row[weightageCol] || "").trim() : "";
      if (/^\d+(\.\d+)?%$/.test(wVal)) {
        const category = ((categoryCol >= 0 ? row[categoryCol] : row[0]) || "").split("\n")[0].trim();
        if (!category) continue;
        breakdown.push({
          category,
          weightage: wVal,
          scoreAchieved: scoreAchievedCol >= 0 ? (row[scoreAchievedCol] || "").trim() : "",
          weightedScore: kpiScoreCol >= 0 ? (row[kpiScoreCol] || "").trim() : "",
        });
      }
    }
    // Some months' summary row is missing outright — fall back to summing the category
    // weighted scores so a total is still shown, rather than leaving it blank.
    if (totalScore === null && breakdown.length) {
      const sum = breakdown.reduce((s, b) => s + (parseFloat(b.weightedScore) || 0), 0);
      totalScore = String(Math.round(sum * 100) / 100);
    }
    const numeric = totalScore ? parseFloat(totalScore.replace(/[^0-9.-]/g, "")) : null;
    // Cross-check against the breakdown's own sum — if the sheet's stated total and what the
    // categories actually add up to disagree by more than rounding error, that's worth
    // surfacing rather than silently trusting either number.
    const breakdownSum = breakdown.length ? breakdown.reduce((s, b) => s + (parseFloat(b.weightedScore) || 0), 0) : null;
    const mismatch = numeric !== null && breakdownSum !== null && Math.abs(numeric - breakdownSum) > 1;
    const flagged = numeric !== null && !isNaN(numeric) && (numeric > 150 || numeric < 0 || mismatch);
    return { month, score: totalScore, breakdown, flagged };
  });
}

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

const MONTH_ALIAS_MAP = {
  jan: "January", january: "January", feb: "February", february: "February",
  mar: "March", march: "March", apr: "April", april: "April", may: "May",
  jun: "June", june: "June", jul: "July", july: "July", aug: "August", august: "August",
  sep: "September", sept: "September", september: "September", oct: "October", october: "October",
  nov: "November", november: "November", dec: "December", december: "December",
};
// Matches both full month names ("August") and common abbreviations ("Aug") — some teams'
// tabs are literally named "KPI Scores Aug", which a full-name-only match would silently skip.
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
function matchMonth(text) {
  const m = (text || "").match(MONTH_RE);
  return m ? MONTH_ALIAS_MAP[m[1].toLowerCase()] || null : null;
}
const MONTH_ORDER_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function cellText(row, c) {
  return row?.[c]?.formattedValue || "";
}

// Two real shapes exist here: Video/Edunexa/Design keep one "KPI Scores" tab (sometimes with
// several months' columns side by side); Content Curation instead has a separate "KPI Scores
// June", "KPI Scores July" tab per month. Both share the same underlying row layout — but the
// header's "KPI" label is a MERGED cell spanning both the category-name and description
// columns, while the data rows have those as two separate columns. That single-column
// mismatch is exactly why a header-position-based column anchor gave wrong values earlier —
// this version finds the Weightage cell fresh on every row instead of assuming a fixed
// column index, which is what actually holds up against the real files (verified against
// Marcus, Aiem, Zul, and Nich's real rows, including Nich's genuinely-blank weighted scores).
// A tab counts as a KPI-scores tab either the old way ("KPI Scores June") or the new
// template's way — the tab is just the bare month name itself ("June", "August"), which is
// what happens when someone duplicates the standard template tab and renames it, exactly as
// instructed. Checking that nothing but the month word remains keeps this from accidentally
// matching an unrelated tab that merely mentions a month in passing.
function isKpiScoreTab(tabTitle) {
  if (/^KPI Scores/i.test(tabTitle)) return true;
  const trimmed = tabTitle.trim();
  const m = trimmed.match(MONTH_RE);
  if (!m) return false;
  const stripped = trimmed.replace(MONTH_RE, "").trim();
  return stripped === "" || /^\(.*\)$/.test(stripped); // tolerate a trailing "(Amended)"-style suffix
}

async function getPersonScore(sheets, fileId, fileName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: fileId, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets || []).map(s => s.properties.title);
  const kpiTabs = titles.filter(isKpiScoreTab);
  if (!kpiTabs.length) return { name: nameFromTitle(fileName), months: [], sheetUrl: `https://docs.google.com/spreadsheets/d/${fileId}/edit`, debug: { allTabs: titles, matchedTabs: [], issue: "no tab matched isKpiScoreTab" } };

  const res = await sheets.spreadsheets.get({
    spreadsheetId: fileId,
    ranges: kpiTabs,
    fields: "sheets.properties.title,sheets.data.rowData.values(formattedValue)",
  });
  const sheetsData = res.data.sheets || [];
  const isNum = v => /^-?\d+(\.\d+)?$/.test((v || "").trim());
  const monthResults = [];
  const perTabDebug = [];

  for (const tabTitle of kpiTabs) {
    const sheetEntry = sheetsData.find(s => s.properties.title === tabTitle);
    const rowData = sheetEntry?.data?.[0]?.rowData || [];
    const rows = rowData.map(r => (r.values || []).map(v => v.formattedValue || ""));
    if (!rows.length) { perTabDebug.push({ tabTitle, issue: "zero rows returned by the API for this tab" }); continue; }

    // The month is either right there in the tab's own name ("KPI Scores June"), or baked
    // into a header column instead ("JULY SCORE") when the team keeps one tab total. When a
    // tab lists several months' columns side by side, sort them chronologically (not by
    // left-to-right column order) so "score" always lines up with the right position below.
    let monthsInTab = [];
    const titleMonth = matchMonth(tabTitle);
    if (titleMonth) monthsInTab.push(titleMonth);
    else {
      for (let r = 0; r < Math.min(rows.length, 3); r++) {
        for (const cellVal of rows[r]) {
          const m = matchMonth(cellVal);
          if (m && !monthsInTab.includes(m)) monthsInTab.push(m);
        }
      }
    }
    if (!monthsInTab.length) { perTabDebug.push({ tabTitle, rowCount: rows.length, first3Rows: rows.slice(0, 3), issue: "no month could be detected from the tab title or its first 3 rows" }); continue; }
    monthsInTab.sort((a, b) => MONTH_ORDER_FULL.indexOf(a) - MONTH_ORDER_FULL.indexOf(b));
    const monthCount = monthsInTab.length;

    // Category rows: find the Weightage cell fresh on each row (first 4 cells), then take
    // exactly 2 columns per month (score, weighted score) immediately after it, in
    // chronological order. Legend/rubric rows never have a %-shaped value there, so they're
    // skipped automatically.
    const breakdown = [];
    let totalRow = null;
    for (const row of rows) {
      const label0 = row[0].trim().toLowerCase();
      if (label0.includes("kpi score for the month") || label0.includes("total kpi score")) {
        totalRow = row;
        continue;
      }
      let wIdx = -1;
      for (let i = 0; i < Math.min(row.length, 4); i++) {
        if (/^\d+(\.\d+)?%$/.test(row[i].trim())) { wIdx = i; break; }
      }
      if (wIdx === -1) continue;
      const category = row[0].split("\n")[0].trim();
      if (!category) continue;
      const weightage = row[wIdx].trim();
      const perMonth = [];
      for (let m = 0; m < monthCount; m++) {
        const s = row[wIdx + 1 + m * 2] || "";
        const ws = row[wIdx + 2 + m * 2] || "";
        // A row genuinely missing its weighted-score (a broken formula upstream, seen in real
        // data) must show blank rather than grab whatever non-numeric rubric text sits there.
        perMonth.push({ scoreAchieved: isNum(s) ? s.trim() : "", weightedScore: isNum(ws) ? ws.trim() : "" });
      }
      breakdown.push({ category, weightage, perMonth });
    }

    if (!breakdown.length) perTabDebug.push({ tabTitle, monthsFound: monthsInTab, rowCount: rows.length, first5Rows: rows.slice(0, 5), issue: "months detected but no row had a %-shaped Weightage cell in its first 4 columns" });

    // The total row lists one value per month, in the same chronological column order —
    // position 1 = oldest month, position N = newest — not "whatever's last in the row"
    // (a rating-legend table often shares this row just past the real values).
    const totals = monthsInTab.map((_, i) => {
      const v = totalRow?.[i + 1];
      return v && v.trim() ? v.trim() : null;
    });

    monthsInTab.forEach((month, i) => {
      const score = totals[i];
      const numeric = score ? parseFloat(score.replace(/[^0-9.-]/g, "")) : null;
      const flagged = numeric !== null && !isNaN(numeric) && (numeric > 150 || numeric < 0);
      monthResults.push({
        month, score, flagged,
        breakdown: breakdown.map(b => ({ category: b.category, weightage: b.weightage, scoreAchieved: b.perMonth[i].scoreAchieved, weightedScore: b.perMonth[i].weightedScore })),
      });
    });
  }

  // De-duplicate by month in case of a stray "(Amended)"-style duplicate tab — last one wins.
  const byMonth = {};
  monthResults.forEach(m => { byMonth[m.month] = m; });

  return {
    name: nameFromTitle(fileName),
    months: Object.values(byMonth),
    sheetUrl: `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
    debug: monthResults.length === 0 ? { allTabs: titles, matchedTabs: kpiTabs, perTab: perTabDebug } : undefined,
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

  // The name column isn't necessarily column 0 either — look for a header cell literally
  // saying "Staff"/"Name"; failing that, fall back to whatever sits just left of the first
  // detected month column (the normal layout), and only default to 0 as a last resort.
  const headerRow = rows[headerRowIdx];
  let nameCol = headerRow.findIndex(h => /^(staff|name)$/i.test((h || "").trim()));
  if (nameCol === -1) nameCol = Math.max(0, monthCols[0].col - 1);

  const people = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[nameCol] || "").trim();
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
    // Someone who's resigned shouldn't still show up as an active team member on a
    // current-KPI view — skip them rather than hardcoding a name that'll go stale.
    if (row.some(cell => (cell || "").toLowerCase().includes("resign"))) continue;
    people.push({
      name,
      months,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });
  }
  const debug = people.length === 0
    ? { availableTabs, requestedTab: tabName, matchedTab: actualTab, rowCount: rows.length, headerRowIdx, nameCol, headerRow, monthColsFound: monthCols.map(m => m.month), sampleDataRows: rows.slice(headerRowIdx + 1, headerRowIdx + 4), issue: "found header row and name column but no data row had a name there" }
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

    if (config.type === "am_individual") {
      const people = [];
      for (const p of config.people) {
        try {
          const months = await getAMPersonMonths(sheets, p.fileId);
          people.push({ name: p.name, months, sheetUrl: `https://docs.google.com/spreadsheets/d/${p.fileId}/edit` });
        } catch (e) {
          people.push({ name: p.name, months: [], sheetUrl: `https://docs.google.com/spreadsheets/d/${p.fileId}/edit`, error: e.message });
        }
      }
      return NextResponse.json({ status: "ok", team, people }, { headers: { "Cache-Control": "no-store" } });
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
