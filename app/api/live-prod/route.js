import { NextResponse } from "next/server";

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRKzI6WQ7U5alPB6y-jkqXulGF7CiszpwlvQKPVhPsEHuQ4NGkiTkS7SMjFQOkeC8gPZLOfLFM8vF5d/pub?gid=1899061287&single=true&output=csv";

const LEAVE_RE = /^(sl|el|al|ul|rl|wfh|mc|on al|on leave|sick leave|birthday leave|half.?day|emergency leave|not updated|on mc|annual leave|-|0)$/i;

const teamMap = {
  marcus:"Design",aiem:"Design",fatanah:"Design",
  nich:"Video",zul:"Video",roshan:"Video",vanessa:"Video",
  maha:"Content",jeremiah:"Content",rosie:"Content",jeng:"Knowledge",
  yash:"Social",divya:"Social",
  shiman:"CSE",jon:"CSE",jev:"CSE",mika:"CSE",naz:"CSE",
  luc:"Sales",dinesh:"Finance"
};

function parseTasks(raw) {
  if (!raw || raw === "NaN") return { tasks: [], hours: 0, leave: null };
  const s = String(raw).trim();
  if (!s || s === "-" || s === "0") return { tasks: [], hours: 0, leave: null };
  if (LEAVE_RE.test(s.replace(/\(.*?\)/g, "").trim())) return { tasks: [], hours: 0, leave: s.toUpperCase().replace(/^ON /, "") };
  if (/(leave|LEAVE TODAY)/i.test(s) && s.length < 60) return { tasks: [], hours: 0, leave: s };

  const lines = s.split(/\n/).map(l => l.trim()).filter(l => l);
  const tasks = []; let total = 0;
  for (let line of lines) {
    if (LEAVE_RE.test(line.replace(/\(.*?\)/g, "").trim())) continue;
    line = line.replace(/^\d+[\.\)]\s*/, "").replace(/^[\-\u2022\uFEFF]\s*/, "");
    if (!line || line.length < 3) continue;
    const parts = line.split(/[,\t]+/).map(p => p.trim()).filter(p => p);
    let hrs = 0, project = "", desc = "";
    if (parts.length >= 3) {
      const n = parseFloat(parts[parts.length - 1]);
      if (!isNaN(n) && n > 0 && n < 24) { hrs = n; project = parts[0]; desc = parts.slice(1, -1).join(", "); }
      else { project = parts[0]; desc = parts.slice(1).join(", "); }
    } else if (parts.length === 2) {
      const n = parseFloat(parts[1]);
      if (!isNaN(n) && n > 0 && n < 24) { hrs = n; project = parts[0]; }
      else { project = parts[0]; desc = parts[1]; }
    } else { project = parts[0] || line; }
    tasks.push({ project: project.substring(0, 80), desc: desc.substring(0, 200), hrs });
    total += hrs;
  }
  return { tasks, hours: Math.round(total * 100) / 100, leave: null };
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

export async function GET() {
  try {
    const res = await fetch(CSV_URL, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error("Failed to fetch sheet");
    const text = await res.text();
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("No data");

    const header = rows[0];
    const colMap = {};
    const dupCols = {};

    for (let c = 1; c < header.length; c++) {
      const h = String(header[c] || "");
      const m = h.match(/^(.+?)['\u2019]s\s+Tasks/i);
      if (m) {
        const name = m[1].trim();
        if (h.match(/\d\s*$/)) {
          const pri = Object.keys(colMap).find(k => colMap[k].name.toLowerCase() === name.toLowerCase());
          if (pri) dupCols[c] = parseInt(pri);
        } else {
          colMap[c] = { name, team: teamMap[name.toLowerCase()] || "Other" };
        }
      }
    }

    const data = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      let dateStr;
      const ts = String(row[0]);
      const dm = ts.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (dm) dateStr = dm[0];
      else { const dAlt = ts.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (dAlt) dateStr = `${dAlt[3]}-${dAlt[1].padStart(2,"0")}-${dAlt[2].padStart(2,"0")}`; }
      if (!dateStr) { const d = new Date(ts); if (!isNaN(d)) dateStr = d.toISOString().split("T")[0]; }
      if (!dateStr) continue;
      if (!data[dateStr]) data[dateStr] = {};

      const processCol = (col, info) => {
        const raw = row[col]; if (!raw) return;
        const p = parseTasks(raw); if (p.tasks.length === 0 && !p.leave) return;
        const ex = data[dateStr][info.name];
        if (ex) { if (p.leave && !ex.leave) ex.leave = p.leave; ex.tasks = ex.tasks.concat(p.tasks); ex.hours += p.hours; }
        else data[dateStr][info.name] = { tasks: p.tasks, hours: p.hours, leave: p.leave, team: info.team };
      };

      Object.keys(colMap).forEach(cs => processCol(parseInt(cs), colMap[parseInt(cs)]));
      Object.keys(dupCols).forEach(ds => { const pc = dupCols[parseInt(ds)]; if (colMap[pc]) processCol(parseInt(ds), colMap[pc]); });
    }

    const dates = Object.keys(data).sort().reverse();
    const members = Object.values(colMap);

    return NextResponse.json({ data, dates, members });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
