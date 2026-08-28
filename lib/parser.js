import * as XLSX from "xlsx";

const LEAVE_RE =
  /^(sl|el|al|ul|rl|wfh|mc|on al|on leave|sick leave|birthday leave|half.?day|emergency leave|not updated|on mc|annual leave|-|0)$/i;

function parseTasks(raw) {
  if (!raw || raw === "NaN" || raw === "nan")
    return { tasks: [], hours: 0, leave: null };
  const s = String(raw).trim();
  if (!s || s === "-" || s === "0")
    return { tasks: [], hours: 0, leave: null };
  if (LEAVE_RE.test(s.replace(/\(.*?\)/g, "").trim()))
    return { tasks: [], hours: 0, leave: s.toUpperCase().replace(/^ON /, "") };
  if (/(leave|LEAVE TODAY)/i.test(s) && s.length < 60)
    return { tasks: [], hours: 0, leave: s };

  const lines = s
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l);
  const tasks = [];
  let total = 0;

  for (let line of lines) {
    if (LEAVE_RE.test(line.replace(/\(.*?\)/g, "").trim())) continue;
    if (/^sorry/i.test(line)) continue;
    line = line
      .replace(/^\d+[\.\)]\s*/, "")
      .replace(/^[\-\u2022\uFEFF]\s*/, "");
    if (!line || line.length < 3) continue;

    const parts = line
      .split(/[,\t]+/)
      .map((p) => p.trim())
      .filter((p) => p);
    let hrs = 0,
      project = "",
      desc = "";

    if (parts.length >= 3) {
      const n = parseFloat(parts[parts.length - 1]);
      if (!isNaN(n) && n > 0 && n < 24) {
        hrs = n;
        project = parts[0];
        desc = parts.slice(1, -1).join(", ");
      } else {
        project = parts[0];
        desc = parts.slice(1).join(", ");
      }
    } else if (parts.length === 2) {
      const n = parseFloat(parts[1]);
      if (!isNaN(n) && n > 0 && n < 24) {
        hrs = n;
        project = parts[0];
      } else {
        project = parts[0];
        desc = parts[1];
      }
    } else {
      project = parts[0] || line;
    }

    if (hrs === 0 && desc) {
      const m = desc.match(/(\d+\.?\d*)\s*$/);
      if (m) {
        hrs = parseFloat(m[1]);
        desc = desc.replace(m[0], "").replace(/,\s*$/, "").trim();
      }
    }

    tasks.push({
      project: project.substring(0, 60),
      desc: desc.substring(0, 150),
      hrs,
    });
    total += hrs;
  }
  return { tasks, hours: Math.round(total * 100) / 100, leave: null };
}

// ========== PRODUCTIVITY PARSER ==========
export function parseProductivity(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sn = wb.SheetNames.find((s) =>
    s.toLowerCase().includes("form response")
  );
  if (!sn) throw new Error('No "Form Responses" sheet found');

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
    header: 1,
    raw: false,
    dateNF: "yyyy-mm-dd",
  });
  const header = rows[0];
  const colMap = {};
  const dupCols = {};

  const teamMap = {
    marcus: "Design", aiem: "Design", fatanah: "Design",
    nich: "Video", zul: "Video", roshan: "Video",
    maha: "Content", jeremiah: "Content",
    jeng: "Knowledge", yash: "Social", divya: "Social",
    shiman: "CSE", jon: "CSE", jev: "CSE", mika: "CSE", naz: "CSE",
    luc: "Sales", dinesh: "Finance",
  };

  for (let c = 2; c < header.length; c++) {
    const h = String(header[c] || "");
    const m = h.match(/^(.+?)['\u2019]s\s+Tasks/i);
    if (m) {
      const name = m[1].trim();
      if (h.match(/\d\s*$/)) {
        const pri = Object.keys(colMap).find(
          (k) => colMap[k].name.toLowerCase() === name.toLowerCase()
        );
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
    const ts = row[0];
    if (typeof ts === "string") {
      const dm = ts.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (dm) dateStr = dm[0];
      else {
        const d = new Date(ts);
        if (!isNaN(d)) dateStr = d.toISOString().split("T")[0];
      }
    } else if (ts instanceof Date) {
      dateStr = ts.toISOString().split("T")[0];
    }
    if (!dateStr) continue;
    if (!data[dateStr]) data[dateStr] = {};

    const processCol = (col, info) => {
      const raw = row[col];
      if (!raw || raw === "NaN") return;
      const p = parseTasks(raw);
      if (p.tasks.length === 0 && !p.leave) return;
      const ex = data[dateStr][info.name];
      if (ex) {
        if (p.leave && !ex.leave) ex.leave = p.leave;
        ex.tasks = ex.tasks.concat(p.tasks);
        ex.hours += p.hours;
      } else {
        data[dateStr][info.name] = {
          tasks: p.tasks, hours: p.hours, leave: p.leave, team: info.team,
        };
      }
    };

    Object.keys(colMap).forEach((cs) => processCol(parseInt(cs), colMap[parseInt(cs)]));
    Object.keys(dupCols).forEach((ds) => {
      const pc = dupCols[parseInt(ds)];
      if (colMap[pc]) processCol(parseInt(ds), colMap[pc]);
    });
  }

  const dates = Object.keys(data).sort().reverse();
  const members = Object.values(colMap);
  return { data, dates, members };
}

// ========== ATTENDANCE PARSER ==========
export function parseAttendance(buffer, filename) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const MN = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  let detMonth = null;
  let detYear = 2026;
  MN.forEach((m, i) => {
    if (filename.toLowerCase().includes(m)) detMonth = i + 1;
  });

  const allRows = [];
  wb.SheetNames.forEach((sn) => {
    if (sn.toLowerCase().includes("summary")) return;
    const json = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
      header: 1, raw: false,
    });
    let hIdx = -1;
    for (let i = 0; i < Math.min(5, json.length); i++) {
      if (
        json[i]?.some(
          (c) =>
            String(c || "").toLowerCase().includes("names") ||
            String(c || "").toLowerCase().includes("clock in")
        )
      ) { hIdx = i; break; }
    }
    if (hIdx === -1) return;

    const h = json[hIdx].map((x) => String(x || "").toLowerCase().trim());
    const dC = h.findIndex((x) => x.includes("date"));
    const nC = h.findIndex((x) => x.includes("name"));
    const ciC = h.findIndex((x) => x.includes("clock in"));
    const coC = h.findIndex((x) => x.includes("clock out"));
    const hC = h.findIndex((x) => x.includes("productive") || x.includes("total"));
    const rC = h.findIndex((x) => x.includes("remark"));
    if (nC === -1) return;

    let lastDate = "";
    for (let i = hIdx + 1; i < json.length; i++) {
      const row = json[i];
      if (!row || row.every((c) => !c)) continue;
      const rd = dC >= 0 ? row[dC] : "";
      if (rd) lastDate = rd;
      const name = row[nC];
      if (!name || !String(name).trim()) continue;

      const ci = ciC >= 0 ? String(row[ciC] || "-") : "-";
      const co = coC >= 0 ? String(row[coC] || "-") : "-";
      const rm = rC >= 0 ? String(row[rC] || "") : "";
      let th = 0;
      if (hC >= 0 && row[hC]) {
        const v = row[hC];
        if (typeof v === "number") th = v;
        else {
          const mt = String(v).match(/(\d+):(\d+)/);
          if (mt) th = parseInt(mt[1]) + parseInt(mt[2]) / 60;
          else th = parseFloat(v) || 0;
        }
      }
      const lc = row[row.length - 1];
      if (th === 0 && lc && typeof lc === "number" && lc > 0 && lc < 24) th = lc;

      let cim = null;
      const cs = String(ci).replace(/\s/g, "");
      if (cs !== "-" && cs !== "" && !cs.includes("#")) {
        const tm = cs.match(/(\d{1,2}):(\d{2})/);
        if (tm) {
          let hr = parseInt(tm[1]), mn = parseInt(tm[2]);
          if (cs.toLowerCase().includes("pm") && hr < 12) hr += 12;
          if (cs.toLowerCase().includes("am") && hr === 12) hr = 0;
          if (!/am|pm/i.test(cs) && hr >= 1 && hr <= 6) hr += 12;
          cim = hr * 60 + mn;
        }
      }

      let pd = "", dm = null;
      const ds = String(lastDate);
      if (ds) {
        const mx = ds.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (mx) {
          const a = parseInt(mx[1]), b = parseInt(mx[2]), c = parseInt(mx[3]);
          if (a > 12) { pd = `${a}/${b}/${c}`; dm = b; }
          else if (b > 12) { pd = `${b}/${a}/${c}`; dm = a; }
          else { pd = `${a}/${b}/${c}`; dm = b; }
          if (c > 100) detYear = c;
        }
      }
      if (dm && !detMonth) detMonth = dm;
      allRows.push({ date: pd || ds, name: String(name).trim(), ci, co, th, rm: rm.replace(/\\n/g, " ").trim(), cim });
    }
  });

  if (!allRows.length) throw new Error("No attendance data found");
  if (!detMonth) detMonth = 7;

  const lT = 9 * 60 + 45;
  const latC = {}, shC = {}, slC = {}, elC = {};
  const wR = {};

  allRows.forEach((r) => {
    if (!r.name) return;
    if (r.cim && r.cim > lT) latC[r.name] = (latC[r.name] || 0) + 1;
    const isL = r.rm && /^(SL|EL|AL|UL|WFH)$/i.test(r.rm.split(" ")[0].replace(/[()]/g, ""));
    if (r.th > 0 && r.th < 7.5 && !isL) shC[r.name] = (shC[r.name] || 0) + 1;
    const ru = r.rm.toUpperCase();
    if (ru.includes("SL")) slC[r.name] = (slC[r.name] || 0) + 1;
    if (ru.includes("EL")) elC[r.name] = (elC[r.name] || 0) + 1;
    if (r.date) {
      const p = r.date.match(/(\d{1,2})/);
      if (p) {
        const day = parseInt(p[1]);
        let wn = day <= 5 ? "w1" : day <= 12 ? "w2" : day <= 19 ? "w3" : day <= 26 ? "w4" : "w5";
        if (!wR[wn]) wR[wn] = [];
        let hd = "-";
        if (r.th > 0) {
          const hh = Math.floor(r.th), mm = Math.round((r.th - hh) * 60);
          hd = `${hh}h ${mm}m`;
        }
        wR[wn].push({ date: r.date, name: r.name, ci: r.ci, co: r.co, hrs: hd, rm: r.rm });
      }
    }
  });

  const late = Object.entries(latC).map(([n, c]) => ({ name: n, count: c })).sort((a, b) => b.count - a.count);
  const short = Object.entries(shC).map(([n, c]) => ({ name: n, count: c })).sort((a, b) => b.count - a.count);
  const sleN = new Set([...Object.keys(slC), ...Object.keys(elC)]);
  const sle = Array.from(sleN).map((n) => ({ name: n, sl: slC[n] || 0, el: elC[n] || 0 })).sort((a, b) => b.sl + b.el - (a.sl + a.el));
  const mNames = ["","January","February","March","April","May","June","July","August","September","October","November","December"];

  return {
    monthKey: `${detYear}-${detMonth}`,
    monthLabel: `${mNames[detMonth]} ${detYear}`,
    data: { late, short, sle, weekly: wR },
    count: allRows.length,
  };
}
