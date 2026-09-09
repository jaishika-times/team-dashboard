import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Design's real workload sheet — "MONTHLY WORKLOAD_VIEWER" tab. Months are laid out
// side-by-side (a header like "JULY 2026" marks where each month's block starts), and within
// each month's block, every person's own mini-table is stacked vertically: a row with just
// their name, then a header row ("TASK NAME, WORKING DATE, ..."), then their task rows, until
// a blank row or the next person's name. Column set varies slightly month to month (some
// months don't have a Produced Time or Status column yet) — verified against real April,
// July, and September data before writing this.
const SPREADSHEET_ID = "1X2ozmFfUiEQ_wj2FyN-KSCb8MptfJzwpClyf33Y5lRM";
const TAB_NAME = "MONTHLY WORKLOAD_VIEWER";
const DESIGN_PEOPLE = ["MARCUS", "AIEM", "FATANAH"];
const MONTH_HEADER_RE = /^[A-Z]+ \d{4}$/;

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

// Parses one month's block (already sliced to just that block's columns) into
// { PERSONNAME: [{taskName, workingDate, type, visualCount, estimatedTime, producedTime, status}] }
function parseMonthBlock(rows) {
  const people = {};
  let r = 0;
  while (r < rows.length) {
    const row = rows[r];
    const col0 = (row[0] || "").trim();
    const restEmpty = row.slice(1).every(c => !c || !c.trim());
    if (col0 && restEmpty && r + 1 < rows.length) {
      const nextRow = rows[r + 1];
      if ((nextRow[0] || "").trim().toLowerCase() === "task name") {
        const personName = col0.toUpperCase();
        const header = nextRow;
        const taskCol = findCol(header, ["task name"]);
        const dateCol = findCol(header, ["working date"]);
        const typeCol = findCol(header, ["type"]);
        const visualCol = findCol(header, ["visual count"]);
        const estCol = findCol(header, ["estimated time"]);
        const prodCol = findCol(header, ["produced time"]);
        const statusCol = findCol(header, ["status"]);
        const tasks = [];
        let dr = r + 2;
        while (dr < rows.length) {
          const drow = rows[dr];
          const rowAllEmpty = drow.every(c => !c || !c.trim());
          if (rowAllEmpty) break;
          const dRestEmpty = drow.slice(1).every(c => !c || !c.trim());
          const taskName = taskCol >= 0 ? (drow[taskCol] || "").trim() : "";
          if (dRestEmpty && taskName) break; // hit the next person's name row
          if (taskName && taskName.toLowerCase() !== "no task") {
            tasks.push({
              taskName,
              workingDate: dateCol >= 0 ? (drow[dateCol] || "").trim() : "",
              type: typeCol >= 0 ? (drow[typeCol] || "").trim() : "",
              visualCount: visualCol >= 0 ? (drow[visualCol] || "").trim() : "",
              estimatedTime: estCol >= 0 ? (drow[estCol] || "").trim() : "",
              producedTime: prodCol >= 0 ? (drow[prodCol] || "").trim() : "",
              status: statusCol >= 0 ? (drow[statusCol] || "").trim() : "",
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

export async function GET() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      ranges: [TAB_NAME],
      fields: "sheets.data.rowData.values(formattedValue)",
    });
    const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
    const rows = rowData.map(r => (r.values || []).map(v => v.formattedValue || ""));
    if (!rows.length) return NextResponse.json({ error: "No data found in the tab" }, { status: 500 });

    // Find every month block's starting column from row 1 (index 0).
    const headerRow = rows[0] || [];
    const blockStarts = [];
    headerRow.forEach((cell, i) => {
      if (MONTH_HEADER_RE.test((cell || "").trim())) blockStarts.push({ col: i, label: cell.trim() });
    });

    const byPerson = {}; // PERSONNAME -> { month: [tasks] }
    blockStarts.forEach((block, i) => {
      const endCol = i + 1 < blockStarts.length ? blockStarts[i + 1].col : headerRow.length;
      const blockRows = rows.map(row => row.slice(block.col, endCol));
      const people = parseMonthBlock(blockRows);
      for (const [name, tasks] of Object.entries(people)) {
        if (!DESIGN_PEOPLE.includes(name)) continue;
        if (!byPerson[name]) byPerson[name] = {};
        byPerson[name][block.label] = tasks;
      }
    });

    const people = DESIGN_PEOPLE.map(name => ({
      person: name.charAt(0) + name.slice(1).toLowerCase(),
      months: byPerson[name] || {},
    }));

    return NextResponse.json({ people }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
