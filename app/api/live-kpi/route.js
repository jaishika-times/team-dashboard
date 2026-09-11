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

// "2 videos in total for either platform" -> "videos" (strips the leading count and the
// generic trailing wording). Used to show "4 videos" instead of a bare "4" for how many of
// a task were actually completed — reusing the task's own description rather than guessing
// new phrasing.
function shortTaskLabel(taskText) {
  const m = (taskText || "").match(/^\d+(?:\.\d+)?\s+(.+)$/);
  if (!m) return null;
  const label = m[1].replace(/\s*(in total|for either platform|either platform|for either|static)\b.*$/i, "").trim();
  return label || null;
}
function completedWithLabel(taskText, completedRaw) {
  const completed = (completedRaw || "").trim();
  if (!completed) return "";
  const label = shortTaskLabel(taskText);
  return label ? `${completed} ${label}` : completed;
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
    const completed = completedWithLabel(taskText, cellText(grid, r, 6));
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

  // Real columns: Month(0) Week(1) Date(2) Name(3) Total Task/Target(4) Tasks(5)
  // Total Estimated Time(6) Total Time Produced(7) Efficiency(8) Weightage(9)
  // Weightage Score(10) Progress(11) Notes(12) Status(13) Link(14) — a "Tasks" column sits
  // between Total Task/Target and Total Estimated Time that wasn't previously accounted for,
  // which had shifted every column read after it by one. Verified against the real sheet
  // before fixing.
  for (let r = 2; r < grid.length; r++) {
    const monthRaw = cellText(grid, r, 0);
    const weekRaw = cellText(grid, r, 1);
    const name = cellText(grid, r, 3).trim();
    const taskTarget = cellText(grid, r, 4).trim();
    const taskCount = taskTarget; // Design reports this as a plain number of tasks
    const completedTasks = cellText(grid, r, 5).trim();
    const estTime = cellText(grid, r, 6).trim();
    const producedTime = cellText(grid, r, 7).trim();
    const efficiencyRaw = cellText(grid, r, 8);
    const weightage = cellText(grid, r, 9).trim();
    const weightageScore = cellText(grid, r, 10).trim();
    const progressRaw = cellText(grid, r, 11);
    const notes = cellText(grid, r, 12).trim();
    const status = cellText(grid, r, 13).trim();
    const links = cellLinksString(grid[r]?.[14]);

    if (monthRaw) lastMonth = normalizeMonth(monthRaw);
    if (weekRaw) lastWeek = (weekRaw.match(/\d+/) || [weekRaw])[0];

    if (!name) continue;
    if (!lastMonth || !lastWeek) continue;

    // Design doesn't really use Progress (it's consistently 0% or blank in the real sheet) —
    // Efficiency is the number that actually reflects their work, so it's the primary source
    // for kpiPct, with Progress only as a fallback if it's ever genuinely populated.
    let kpiPct = parseProgress(efficiencyRaw);
    if (kpiPct === null) kpiPct = parseProgress(progressRaw);

    // Just the rating itself (Meeting/Exceeding/Below expectation) when there is one,
    // otherwise fall back to whatever the task/target field says (covers weeks with no
    // rating yet — leave, not started, etc).
    const completed = status || taskTarget || "";

    people.push({
      month: lastMonth, week: lastWeek, team: "Design", employee: name,
      tasks: [{ task: taskTarget, platform: "", completed, weightage, weightageScore, notes, status, links, estTime, producedTime, taskCount, completedTasks }],
      kpiPct,
    });
  }
  return people;
}

// Design's real numbers now come from their actual workload tracker (a separate
// spreadsheet), not the old "Team Weekly Updates" tab — verified structure and parsing
// against real data before wiring this in. Months sit side-by-side across columns; within
// each month, every person's task list is stacked vertically as its own mini-table (name
// row, header row, task rows until a blank row or the next name). Efficiency = Produced ÷
// Estimated time, as given — under 80% is ahead of schedule ("Exceeding"), 80-100% is on
// schedule ("Meeting"), over 100% ran over ("Below") — matching the color rule already in
// use elsewhere for Design.
const DESIGN_SPREADSHEET_ID = "1X2ozmFfUiEQ_wj2FyN-KSCb8MptfJzwpClyf33Y5lRM";
const DESIGN_TAB_NAME = "MONTHLY WORKLOAD_VIEWER";
const DESIGN_PEOPLE = ["MARCUS", "AIEM", "FATANAH"];
const MONTH_BLOCK_RE = /^([A-Z]+) (\d{4})$/;

function findColByKeyword(header, keywords) {
  for (let i = 0; i < header.length; i++) {
    const h = (header[i] || "").toLowerCase();
    if (keywords.some(k => h.includes(k))) return i;
  }
  return -1;
}

function parseDesignMonthBlock(blockRows) {
  const people = {};
  let r = 0;
  while (r < blockRows.length) {
    const row = blockRows[r];
    const col0 = (row[0] || "").trim();
    const restEmpty = row.slice(1).every(c => !c || !c.trim());
    if (col0 && restEmpty && r + 1 < blockRows.length) {
      const nextRow = blockRows[r + 1];
      if ((nextRow[0] || "").trim().toLowerCase() === "task name") {
        const personName = col0.toUpperCase();
        const header = nextRow;
        const taskCol = findColByKeyword(header, ["task name"]);
        const dateCol = findColByKeyword(header, ["working date"]);
        const visualCol = findColByKeyword(header, ["visual count"]);
        const estCol = findColByKeyword(header, ["estimated time"]);
        const prodCol = findColByKeyword(header, ["produced time"]);
        const tasks = [];
        let dr = r + 2;
        while (dr < blockRows.length) {
          const drow = blockRows[dr];
          const rowAllEmpty = drow.every(c => !c || !c.trim());
          if (rowAllEmpty) break;
          const dRestEmpty = drow.slice(1).every(c => !c || !c.trim());
          const taskName = taskCol >= 0 ? (drow[taskCol] || "").trim() : "";
          if (dRestEmpty && taskName) break; // hit the next person's name row
          if (taskName && taskName.toLowerCase() !== "no task") {
            tasks.push({
              taskName,
              workingDate: dateCol >= 0 ? (drow[dateCol] || "").trim() : "",
              visualCount: visualCol >= 0 ? (drow[visualCol] || "").trim() : "",
              estimatedTime: estCol >= 0 ? (drow[estCol] || "").trim() : "",
              producedTime: prodCol >= 0 ? (drow[prodCol] || "").trim() : "",
            });
          }
          dr++;
        }
        people[personName] = (people[personName] || []).concat(tasks);
        r = dr;
        continue;
      }
    }
    r++;
  }
  return people;
}

function deriveDesignStatus(pctFraction) {
  if (pctFraction === null) return "";
  const pct = pctFraction * 100;
  if (pct < 80) return "Exceeding expectation";
  if (pct <= 100) return "Meeting expectation";
  return "Below expectation";
}

async function getDesignFromWorkloadSheet() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: DESIGN_SPREADSHEET_ID,
    ranges: [DESIGN_TAB_NAME],
    fields: "sheets.data.rowData.values(formattedValue)",
  });
  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const rows = rowData.map(r => (r.values || []).map(v => v.formattedValue || ""));
  if (!rows.length) return [];

  const headerRow = rows[0] || [];
  const blockStarts = [];
  headerRow.forEach((cell, i) => {
    if (MONTH_BLOCK_RE.test((cell || "").trim())) blockStarts.push({ col: i, label: cell.trim() });
  });

  const byPerson = {};
  blockStarts.forEach((block, i) => {
    const endCol = i + 1 < blockStarts.length ? blockStarts[i + 1].col : headerRow.length;
    const blockRows = rows.map(row => row.slice(block.col, endCol));
    const people = parseDesignMonthBlock(blockRows);
    for (const [name, tasks] of Object.entries(people)) {
      if (!DESIGN_PEOPLE.includes(name)) continue;
      if (!byPerson[name]) byPerson[name] = {};
      byPerson[name][block.label] = tasks;
    }
  });

  const result = [];
  for (const [name, months] of Object.entries(byPerson)) {
    const employee = name.charAt(0) + name.slice(1).toLowerCase();
    for (const [monthLabel, tasks] of Object.entries(months)) {
      const monthMatch = monthLabel.match(MONTH_BLOCK_RE);
      if (!monthMatch) continue;
      const month = normalizeMonth(monthMatch[1]);
      const weekGroups = {};
      tasks.forEach(t => {
        const day = parseInt((t.workingDate || "").slice(8, 10), 10);
        const week = isNaN(day) ? 1 : Math.ceil(day / 7);
        (weekGroups[week] = weekGroups[week] || []).push(t);
      });
      for (const [week, weekTasks] of Object.entries(weekGroups)) {
        const estSum = weekTasks.reduce((s, t) => s + (parseFloat(t.estimatedTime) || 0), 0);
        const prodSum = weekTasks.reduce((s, t) => s + (parseFloat(t.producedTime) || 0), 0);
        const visualSum = weekTasks.reduce((s, t) => s + (parseFloat(t.visualCount) || 0), 0);
        const kpiPct = estSum > 0 ? prodSum / estSum : null;
        const status = deriveDesignStatus(kpiPct);
        const taskNames = weekTasks.map(t => t.taskName).join("; ");
        result.push({
          month, week, team: "Design", employee,
          tasks: [{
            task: taskNames,
            completed: status,
            estTime: estSum ? String(Math.round(estSum * 100) / 100) : "",
            producedTime: prodSum ? String(Math.round(prodSum * 100) / 100) : "",
            taskCount: String(weekTasks.length),
            completedTasks: taskNames,
            visualCount: visualSum ? String(visualSum) : "",
            weightage: "", weightageScore: "", notes: "", status, links: "",
          }],
          kpiPct,
        });
      }
    }
  }
  return result;
}

export async function GET() {
  try {
    const [contentGrid, videoGrid, designPeople] = await Promise.allSettled([
      fetchSheetGrid("Content"),
      fetchSheetGrid("Video"),
      getDesignFromWorkloadSheet(),
    ]);

    let people = [];
    if (contentGrid.status === "fulfilled") people = people.concat(parseTaskSheet(contentGrid.value, "Content"));
    if (videoGrid.status === "fulfilled") people = people.concat(parseTaskSheet(videoGrid.value, "Video"));
    if (designPeople.status === "fulfilled") people = people.concat(designPeople.value);

    const entries = people.map(p => ({
      ...p,
      target: p.tasks.map(t => t.task).filter(Boolean).join("; "),
      estTime: p.tasks.map(t => t.estTime).filter(Boolean).join(", "),
      producedTime: p.tasks.map(t => t.producedTime).filter(Boolean).join(", "),
      taskCount: p.tasks.map(t => t.taskCount).filter(Boolean).join(", "),
      completedTasks: p.tasks.map(t => t.completedTasks).filter(Boolean).join(", "),
      visualCount: p.tasks.map(t => t.visualCount).filter(Boolean).join(", "),
      completed: p.tasks.map(t => t.completed).filter(Boolean).join(", "),
      notes: p.tasks.map(t => t.notes).filter(Boolean).join(" | "),
      status: p.tasks.map(t => t.status).filter(Boolean)[0] || "",
      links: p.tasks.map(t => t.links).filter(Boolean).join("\n"),
    }));

    if (!entries.length) {
      const errors = [contentGrid, videoGrid, designPeople].filter(r => r.status === "rejected").map(r => r.reason?.message);
      throw new Error(errors.length ? errors.join("; ") : "No KPI rows found in any sheet");
    }
    return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
