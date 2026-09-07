import { NextResponse } from "next/server";

const BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTeS9rrzeJzv7GY_7PbAgWJn3QwBOA6LG3rJxD7uvZWLjrUlRWBbrQrw3cCOCrbuJwodiAmGhGfaUJI/pub?output=csv";
const CONTENT_CSV_URL = `${BASE}&gid=1006821855&single=true`;
const VIDEO_CSV_URL = `${BASE}&gid=1050988634&single=true`;
const DESIGN_CSV_URL = `${BASE}&gid=1107694641&single=true`;

function normalizeMonth(m) {
  const s = String(m || "").trim().toLowerCase();
  const map = { january: "Jan", february: "Feb", march: "Mar", april: "Apr", may: "May", june: "Jun", july: "Jul", august: "Aug", september: "Sep", sept: "Sep", october: "Oct", november: "Nov", december: "Dec", jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", jun: "Jun", jul: "Jul", aug: "Aug", sep: "Sep", oct: "Oct", nov: "Nov", dec: "Dec" };
  return map[s] || m;
}

// Sheet stores progress either as a fraction (0.85) or a whole percent (85) — normalize to a fraction.
function parseProgress(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseFloat(String(raw).trim().replace("%", ""));
  if (isNaN(n)) return null;
  return n > 1 ? n / 100 : n;
}

function parseCSV(text) {
  const rows = [];
  let current = [];
  let inQuotes = false;
  let field = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      current.push(field); field = "";
    } else if (ch === '\n' && !inQuotes) {
      current.push(field); field = "";
      rows.push(current); current = [];
    } else if (ch === '\r' && !inQuotes) {
      // skip
    } else {
      field += ch;
    }
  }
  if (field || current.length) { current.push(field); rows.push(current); }
  return rows;
}

async function fetchCSV(url) {
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error("Failed to fetch sheet");
  return parseCSV(await res.text());
}

// Content / Video sheet columns: Month, Week, Date, Name, Task/Target, Platform,
// Completed, Weightage, Weightage Score, Progress, Notes, Status, Links.
//
// A person can span MULTIPLE rows: their first row has Name filled in, along with
// their overall Progress % for the week. Any rows directly below with a BLANK Name
// (but a Task/Target filled in) are additional tasks for that SAME person, grouped
// into one entry with a `tasks` array.
//
// Status/Notes/Links are recorded PER TASK ROW, not once per person — different
// weeks fill these in differently (some give every task its own status/links,
// others only fill the first task), so each task keeps whatever its own row has.
function parseTaskSheet(rows, team) {
  const people = [];
  let lastMonth = "", lastWeek = "";
  let current = null;

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c && c !== 0)) continue;

    const monthRaw = row[0] ? String(row[0]).trim() : "";
    const weekRaw = row[1] ? String(row[1]).trim() : "";
    const name = row[3] ? String(row[3]).trim() : "";
    const taskText = row[4] ? String(row[4]).trim() : "";
    const platform = row[5] ? String(row[5]).trim() : "";
    const completed = row[6] !== undefined && row[6] !== null ? String(row[6]).trim() : "";
    const weightage = row[7] ? String(row[7]).trim() : "";
    const weightageScore = row[8] ? String(row[8]).trim() : "";
    const progressRaw = row[9];
    const notes = row[10] ? String(row[10]).trim() : "";
    const status = row[11] ? String(row[11]).trim() : "";
    const links = row[12] ? String(row[12]).trim() : "";

    if (monthRaw) lastMonth = normalizeMonth(monthRaw);
    if (weekRaw) lastWeek = (weekRaw.match(/\d+/) || [weekRaw])[0];

    if (!name && !taskText) continue;

    if (name) {
      if (lastMonth && lastWeek) {
        current = {
          month: lastMonth, week: lastWeek,
          team, employee: name,
          tasks: [],
          kpiPct: parseProgress(progressRaw),
        };
        people.push(current);
      } else {
        current = null;
      }
    }

    if (taskText && current) {
      current.tasks.push({ task: taskText, platform, completed, weightage, weightageScore, notes, status, links });
    }
  }
  return people;
}

// Design sheet columns: Month, Week, Date, Name, Total Task/Target, Total Estimated
// Time, Total Time Produced, Efficiency, Weightage, Weightage Score, Progress,
// Notes, Status, Link. One row per person per week (no task grouping needed).
// Weightage/Progress are mostly unused for this team — Efficiency is their real KPI.
function parseDesignSheet(rows) {
  const people = [];
  let lastMonth = "", lastWeek = "";

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c && c !== 0)) continue;

    const monthRaw = row[0] ? String(row[0]).trim() : "";
    const weekRaw = row[1] ? String(row[1]).trim() : "";
    const name = row[3] ? String(row[3]).trim() : "";
    const taskTarget = row[4] ? String(row[4]).trim() : "";
    const estTime = row[5] ? String(row[5]).trim() : "";
    const producedTime = row[6] ? String(row[6]).trim() : "";
    const efficiencyRaw = row[7];
    const weightage = row[8] ? String(row[8]).trim() : "";
    const weightageScore = row[9] ? String(row[9]).trim() : "";
    const progressRaw = row[10];
    const notes = row[11] ? String(row[11]).trim() : "";
    const status = row[12] ? String(row[12]).trim() : "";
    const links = row[13] ? String(row[13]).trim() : "";

    if (monthRaw) lastMonth = normalizeMonth(monthRaw);
    if (weekRaw) lastWeek = (weekRaw.match(/\d+/) || [weekRaw])[0];

    if (!name) continue;
    if (!lastMonth || !lastWeek) continue;

    let kpiPct = parseProgress(progressRaw);
    if ((kpiPct === null || kpiPct === 0) && !weightage) kpiPct = parseProgress(efficiencyRaw);

    const completed = producedTime || estTime
      ? `${producedTime || "—"}h produced / ${estTime || "—"}h est.`
      : "";

    people.push({
      month: lastMonth, week: lastWeek,
      team: "Design", employee: name,
      tasks: [{ task: taskTarget, platform: "", completed, weightage, weightageScore, notes, status, links }],
      kpiPct,
    });
  }
  return people;
}

export async function GET() {
  try {
    const [contentRows, videoRows, designRows] = await Promise.allSettled([
      fetchCSV(CONTENT_CSV_URL),
      fetchCSV(VIDEO_CSV_URL),
      fetchCSV(DESIGN_CSV_URL),
    ]);

    let people = [];
    if (contentRows.status === "fulfilled") people = people.concat(parseTaskSheet(contentRows.value, "Content"));
    if (videoRows.status === "fulfilled") people = people.concat(parseTaskSheet(videoRows.value, "Video"));
    if (designRows.status === "fulfilled") people = people.concat(parseDesignSheet(designRows.value));

    // Backward-compatible flat summary fields, used by the Progress Report table
    // (which shows one row per person, not per task).
    const entries = people.map(p => ({
      ...p,
      target: p.tasks.map(t => t.task).filter(Boolean).join("; "),
      completed: p.tasks.map(t => t.completed).filter(Boolean).join(", "),
      notes: p.tasks.map(t => t.notes).filter(Boolean).join(" | "),
      status: p.tasks.map(t => t.status).filter(Boolean)[0] || "",
      links: p.tasks.map(t => t.links).filter(Boolean).join("\n"),
    }));

    if (!entries.length) throw new Error("No KPI rows found in any sheet");
    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
