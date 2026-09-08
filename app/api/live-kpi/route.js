import { NextResponse } from "next/server";
import { google } from "googleapis";

// Without this, Next.js can treat this route as fully static (no dynamic params, no
// request-derived data) and cache its output at build time — meaning updates to the actual
// Google Sheet would never show up no matter how often the sheet changes, only reflecting
// whatever it looked like at the last deploy. Forcing dynamic + no-store guarantees this
// route actually re-fetches from Google on every request.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The actual Google Sheet behind Content/Video/Design — found via Drive, same file for all
// three tabs. Using the Sheets API (not CSV) is what lets this preserve real hyperlinks,
// including cells where several different links sit inside one multi-line cell.
const SPREADSHEET_ID = "1eUXBgpVgrkEEyo7UXzdArRRvZPsvYdlGQk1S8XAAnAI";

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

// Fetches one tab as a grid of cell objects (not plain strings) — each cell carries its
// formatted display text plus real hyperlink data, which a CSV export would have stripped.
async function fetchSheetGrid(sheetTitle) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [sheetTitle],
    fields: "sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns)",
  });
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  return rowData.map(r => (r.values || []).map(v => v || {}));
}

function cellText(grid, r, c) {
  return grid[r]?.[c]?.formattedValue || "";
}

// Turns a cell's real hyperlink data into the same "[Label](url)" / plain-URL text format
// the rest of the app already knows how to render — so nothing downstream needs to change.
// Handles three cases: (1) the whole cell is one hyperlink, (2) the cell has several
// different links on different lines/phrases (Sheets "rich text" runs), (3) no links at all.
function cellLinksString(cell) {
  if (!cell) return "";
  const text = cell.formattedValue || "";
  if (!text) return "";

  if (cell.hyperlink) {
    const t = text.trim();
    if (t === cell.hyperlink.trim()) return t; // the visible text already IS the URL
    return `[${text.replace(/\n/g, " ").trim()}](${cell.hyperlink})`;
  }

  if (cell.textFormatRuns && cell.textFormatRuns.length) {
    const runs = cell.textFormatRuns;
    const parts = [];
    if ((runs[0].startIndex || 0) > 0) {
      const pre = text.slice(0, runs[0].startIndex).trim();
      if (pre) parts.push(pre);
    }
    for (let i = 0; i < runs.length; i++) {
      const start = runs[i].startIndex || 0;
      const end = i + 1 < runs.length ? runs[i + 1].startIndex : text.length;
      const uri = runs[i].format?.link?.uri;
      const label = text.slice(start, end).trim();
      if (!label) continue;
      parts.push(uri ? `[${label}](${uri})` : label);
    }
    return parts.join("\n");
  }

  return text;
}

function normalizeMonth(m) {
  const s = String(m || "").trim().toLowerCase();
  const map = { january: "Jan", february: "Feb", march: "Mar", april: "Apr", may: "May", june: "Jun", july: "Jul", august: "Aug", september: "Sep", sept: "Sep", october: "Oct", november: "Nov", december: "Dec", jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", jun: "Jun", jul: "Jul", aug: "Aug", sep: "Sep", oct: "Oct", nov: "Nov", dec: "Dec" };
  return map[s] || m;
}

function parseProgress(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseFloat(String(raw).trim().replace("%", ""));
  if (isNaN(n)) return null;
  return n > 1 ? n / 100 : n;
}

// Content / Video sheet columns: Month(0), Week(1), Date(2), Name(3), Task/Target(4),
// Platform(5), Completed(6), Weightage(7), Weightage Score(8), Progress(9), Notes(10),
// Status(11), Links(12). Same row-grouping rules as before: a person can span multiple
// rows (blank Name = another task for the same person); Status/Notes/Links are per task row.
function parseTaskSheet(grid, team) {
  const people = [];
  let lastMonth = "", lastWeek = "";
  let current = null;

  for (let r = 2; r < grid.length; r++) {
    const monthRaw = cellText(grid, r, 0);
    const weekRaw = cellText(grid, r, 1);
    const name = cellText(grid, r, 3).trim();
    const taskText = cellText(grid, r, 4).trim();
    const platform = cellText(grid, r, 5).trim();
    const completed = cellText(grid, r, 6).trim();
    const weightage = cellText(grid, r, 7).trim();
    const weightageScore = cellText(grid, r, 8).trim();
    const progressRaw = cellText(grid, r, 9);
    const notes = cellText(grid, r, 10).trim();
    const status = cellText(grid, r, 11).trim();
    const links = cellLinksString(grid[r]?.[12]);

    if (monthRaw) lastMonth = normalizeMonth(monthRaw);
    if (weekRaw) lastWeek = (weekRaw.match(/\d+/) || [weekRaw])[0];

    if (!name && !taskText) continue;

    if (name) {
      if (lastMonth && lastWeek) {
        current = { month: lastMonth, week: lastWeek, team, employee: name, tasks: [], kpiPct: parseProgress(progressRaw) };
        people.push(current);
      } else {
        current = null;
      }
    }

    if (taskText && current) {
      current.tasks.push({ task: taskText, platform, completed, weightage, weightageScore, notes, status, links, estTime: "", producedTime: "" });
    }
  }
  return people;
}

// Design sheet columns: Month(0), Week(1), Date(2), Name(3), Total Task/Target(4),
// Total Estimated Time(5), Total Time Produced(6), Efficiency(7), Weightage(8),
// Weightage Score(9), Progress(10), Notes(11), Status(12), Link(13).
function parseDesignSheet(grid) {
  const people = [];
  let lastMonth = "", lastWeek = "";

  for (let r = 2; r < grid.length; r++) {
    const monthRaw = cellText(grid, r, 0);
    const weekRaw = cellText(grid, r, 1);
    const name = cellText(grid, r, 3).trim();
    const taskTarget = cellText(grid, r, 4).trim();
    const estTime = cellText(grid, r, 5).trim();
    const producedTime = cellText(grid, r, 6).trim();
    const efficiencyRaw = cellText(grid, r, 7);
    const weightage = cellText(grid, r, 8).trim();
    const weightageScore = cellText(grid, r, 9).trim();
    const progressRaw = cellText(grid, r, 10);
    const notes = cellText(grid, r, 11).trim();
    const status = cellText(grid, r, 12).trim();
    const links = cellLinksString(grid[r]?.[13]);

    if (monthRaw) lastMonth = normalizeMonth(monthRaw);
    if (weekRaw) lastWeek = (weekRaw.match(/\d+/) || [weekRaw])[0];

    if (!name) continue;
    if (!lastMonth || !lastWeek) continue;

    let kpiPct = parseProgress(progressRaw);
    if ((kpiPct === null || kpiPct === 0) && !weightage) kpiPct = parseProgress(efficiencyRaw);

    // "Completed" mirrors what the sheet's own Progress Report shows: the rating (e.g.
    // "Completed - Meeting Expectation") when a status exists, otherwise fall back to
    // whatever the task/target field says (covers weeks with no work done yet, leave, etc).
    const completed = status ? `Completed - ${status}` : (taskTarget || "");

    people.push({
      month: lastMonth, week: lastWeek, team: "Design", employee: name,
      tasks: [{ task: taskTarget, platform: "", completed, weightage, weightageScore, notes, status, links, estTime, producedTime }],
      kpiPct,
    });
  }
  return people;
}

export async function GET() {
  try {
    const [contentGrid, videoGrid, designGrid] = await Promise.allSettled([
      fetchSheetGrid("Content"),
      fetchSheetGrid("Video"),
      fetchSheetGrid("Design"),
    ]);

    let people = [];
    if (contentGrid.status === "fulfilled") people = people.concat(parseTaskSheet(contentGrid.value, "Content"));
    if (videoGrid.status === "fulfilled") people = people.concat(parseTaskSheet(videoGrid.value, "Video"));
    if (designGrid.status === "fulfilled") people = people.concat(parseDesignSheet(designGrid.value));

    const entries = people.map(p => ({
      ...p,
      target: p.tasks.map(t => t.task).filter(Boolean).join("; "),
      estTime: p.tasks.map(t => t.estTime).filter(Boolean).join(", "),
      producedTime: p.tasks.map(t => t.producedTime).filter(Boolean).join(", "),
      completed: p.tasks.map(t => t.completed).filter(Boolean).join(", "),
      notes: p.tasks.map(t => t.notes).filter(Boolean).join(" | "),
      status: p.tasks.map(t => t.status).filter(Boolean)[0] || "",
      links: p.tasks.map(t => t.links).filter(Boolean).join("\n"),
    }));

    if (!entries.length) {
      const errors = [contentGrid, videoGrid, designGrid].filter(r => r.status === "rejected").map(r => r.reason?.message);
      throw new Error(errors.length ? errors.join("; ") : "No KPI rows found in any sheet");
    }
    return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
