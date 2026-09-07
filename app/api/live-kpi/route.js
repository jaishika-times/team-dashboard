import { NextResponse } from "next/server";

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTeS9rrzeJzv7GY_7PbAgWJn3QwBOA6LG3rJxD7uvZWLjrUlRWBbrQrw3cCOCrbuJwodiAmGhGfaUJI/pub?output=csv";

// Same name -> team roster used by /api/live-prod, kept in sync here so KPI and
// Productivity always agree on who's on which team.
const teamMap = {
  marcus: "Design", aiem: "Design", fatanah: "Design",
  nich: "Video", nicholas: "Video", zul: "Video", roshan: "Video", vanessa: "Video",
  maha: "Content", mahal: "Content", jeremiah: "Content", rosie: "Content", jeng: "Knowledge",
  yash: "Social", divya: "Social",
  shiman: "CSE", jon: "CSE", jev: "CSE", mika: "CSE", naz: "CSE",
  luc: "Sales", dinesh: "Finance",
};

function teamForName(name) {
  const key = String(name || "").trim().toLowerCase();
  if (teamMap[key]) return teamMap[key];
  const found = Object.keys(teamMap).find(k => key.startsWith(k) || k.startsWith(key));
  return found ? teamMap[found] : "Other";
}

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

// Sheet columns: Month, Week, Date, Name, Task/Target, (spacer), Completed,
// Weightage, Weightage Score, Progress, Notes, Status, Links
export async function GET() {
  try {
    const res = await fetch(CSV_URL, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error("Failed to fetch sheet");
    const text = await res.text();
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("No data");

    const entries = [];
    let lastMonth = "", lastWeek = "";
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c && c !== 0)) continue;

      const month = row[0] ? String(row[0]).trim() : "";
      const weekRaw = row[1] ? String(row[1]).trim() : "";
      const name = row[3] ? String(row[3]).trim() : "";
      const target = row[4] ? String(row[4]).trim() : "";
      const completed = row[6] !== undefined && row[6] !== null ? String(row[6]).trim() : "";
      const weightage = row[7] ? String(row[7]).trim() : "";
      const weightageScore = row[8] ? String(row[8]).trim() : "";
      const notes = row[10] ? String(row[10]).trim() : "";
      const status = row[11] ? String(row[11]).trim() : "";
      const links = row[12] ? String(row[12]).trim() : "";

      if (month) lastMonth = normalizeMonth(month);
      if (weekRaw) lastWeek = (weekRaw.match(/\d+/) || [weekRaw])[0];

      if (!name) continue;
      if (!lastMonth || !lastWeek) continue;

      entries.push({
        month: lastMonth, week: lastWeek,
        team: teamForName(name),
        employee: name,
        target, completed,
        kpiPct: parseProgress(row[9]),
        notes, status, links,
        weightage, weightageScore,
      });
    }

    if (!entries.length) throw new Error("No KPI rows found in sheet");
    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
