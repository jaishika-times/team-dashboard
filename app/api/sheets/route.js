import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function verifyAdmin(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const admin = getAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user : null;
}

function getGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) return null;
  return new google.auth.JWT(email, null, key, ["https://www.googleapis.com/auth/spreadsheets.readonly"]);
}

const LEAVE_RE = /^(sl|el|al|ul|rl|wfh|mc|on al|on leave|sick leave|birthday leave|half.?day|emergency leave|not updated|on mc|annual leave|-|0)$/i;

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
    line = line.replace(/^\d+[\.\)]\s*/, "");
    if (!line || line.length < 3) continue;
    const parts = line.split(/[,\t]+/).map(p => p.trim()).filter(p => p);
    let hrs = 0, project = "", desc = "";
    if (parts.length >= 3) { const n = parseFloat(parts[parts.length - 1]); if (!isNaN(n) && n > 0 && n < 24) { hrs = n; project = parts[0]; desc = parts.slice(1, -1).join(", "); } else { project = parts[0]; desc = parts.slice(1).join(", "); } }
    else if (parts.length === 2) { const n = parseFloat(parts[1]); if (!isNaN(n) && n > 0 && n < 24) { hrs = n; project = parts[0]; } else { project = parts[0]; desc = parts[1]; } }
    else project = parts[0] || line;
    tasks.push({ project: project.substring(0, 60), desc: desc.substring(0, 150), hrs }); total += hrs;
  }
  return { tasks, hours: Math.round(total * 100) / 100, leave: null };
}

function parseProductivityRows(rows) {
  const header = rows[0]; const colMap = {}; const dupCols = {};
  const teamMap = { marcus:"Design",aiem:"Design",fatanah:"Design",nich:"Video",zul:"Video",roshan:"Video",maha:"Content",jeremiah:"Content",jeng:"Knowledge",yash:"Social",divya:"Social",shiman:"CSE",jon:"CSE",jev:"CSE",mika:"CSE",naz:"CSE",luc:"Sales",dinesh:"Finance" };
  for (let c = 1; c < header.length; c++) {
    const h = String(header[c] || ""); const m = h.match(/^(.+?)['\u2019]s\s+Tasks/i);
    if (m) { const name = m[1].trim(); if (h.match(/\d\s*$/)) { const pri = Object.keys(colMap).find(k => colMap[k].name.toLowerCase() === name.toLowerCase()); if (pri) dupCols[c] = parseInt(pri); } else colMap[c] = { name, team: teamMap[name.toLowerCase()] || "Other" }; }
  }
  const data = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row || !row[0]) continue;
    let dateStr; const ts = String(row[0]);
    const dm = ts.match(/(\d{4})-(\d{2})-(\d{2})/); if (dm) dateStr = dm[0];
    else { const dA = ts.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (dA) dateStr = `${dA[3]}-${dA[1].padStart(2,"0")}-${dA[2].padStart(2,"0")}`; }
    if (!dateStr) { const d = new Date(ts); if (!isNaN(d)) dateStr = d.toISOString().split("T")[0]; }
    if (!dateStr) continue;
    if (!data[dateStr]) data[dateStr] = {};
    const proc = (col, info) => { const raw = row[col]; if (!raw) return; const p = parseTasks(raw); if (!p.tasks.length && !p.leave) return; const ex = data[dateStr][info.name]; if (ex) { if (p.leave && !ex.leave) ex.leave = p.leave; ex.tasks = ex.tasks.concat(p.tasks); ex.hours += p.hours; } else data[dateStr][info.name] = { ...p, team: info.team }; };
    Object.keys(colMap).forEach(cs => proc(parseInt(cs), colMap[parseInt(cs)]));
    Object.keys(dupCols).forEach(ds => { const pc = dupCols[parseInt(ds)]; if (colMap[pc]) proc(parseInt(ds), colMap[pc]); });
  }
  return { data, dates: Object.keys(data).sort().reverse(), members: Object.values(colMap) };
}

function parseAttendanceRows(rows) {
  const header = rows[0].map(h => String(h || "").toLowerCase().trim());
  const dateCol = header.findIndex(h => h.includes("empdate") || h.includes("date"));
  const nameCol = header.findIndex(h => h === "name" || h.includes("name"));
  const checkCols = [];
  for (let i = 0; i < header.length; i++) { const m = header[i].match(/checkin(\d+)/); if (m) { const o = header.findIndex(h => h === "checkout" + m[1]); if (o >= 0) checkCols.push({ i, o }); } }
  if (dateCol < 0 || nameCol < 0 || !checkCols.length) throw new Error("Invalid attendance sheet format");
  const lT = 9 * 60 + 45; const latC = {}, shC = {}; const wR = {};
  let detMonth = null, detYear = 2026;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row || !row[dateCol]) continue;
    const name = String(row[nameCol] || "").trim(); if (!name) continue;
    const ds = String(row[dateCol]); let day = 1, month = 1;
    const dm = ds.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    if (dm) { day = parseInt(dm[3]); month = parseInt(dm[2]); detYear = parseInt(dm[1]); }
    if (!detMonth) detMonth = month;
    const ci = row[checkCols[0].i] ? String(row[checkCols[0].i]).trim() : "";
    let cim = null; if (ci) { const tm = ci.match(/(\d{1,2}):(\d{2})/); if (tm) cim = parseInt(tm[1]) * 60 + parseInt(tm[2]); }
    let lastOut = "", lot = null;
    for (let j = checkCols.length - 1; j >= 0; j--) { const v = row[checkCols[j].o]; if (v && String(v).trim()) { lastOut = String(v).trim(); const tm = lastOut.match(/(\d{1,2}):(\d{2})/); if (tm) lot = parseInt(tm[1]) * 60 + parseInt(tm[2]); break; } }
    let th = 0; if (cim !== null && lot !== null && lot > cim) { th = (lot - cim) / 60; if (th > 5) th -= 1; }
    if (cim && cim > lT) latC[name] = (latC[name] || 0) + 1;
    if (th > 0 && th < 7.5) shC[name] = (shC[name] || 0) + 1;
    const wn = day <= 7 ? "w1" : day <= 14 ? "w2" : day <= 21 ? "w3" : day <= 28 ? "w4" : "w5";
    if (!wR[wn]) wR[wn] = [];
    let hd = "-"; if (th > 0) { const hh = Math.floor(th), mm = Math.round((th - hh) * 60); hd = hh + "h " + mm + "m"; }
    wR[wn].push({ date: day + "/" + month + "/" + detYear, name, ci: ci || "-", co: lastOut || "-", hrs: hd, rm: "" });
  }
  if (!detMonth) detMonth = new Date().getMonth() + 1;
  const mN = ["","January","February","March","April","May","June","July","August","September","October","November","December"];
  return { monthKey: detYear + "-" + detMonth, monthLabel: mN[detMonth] + " " + detYear, data: { late: Object.entries(latC).map(([n,c]) => ({name:n,count:c})).sort((a,b) => b.count-a.count), short: Object.entries(shC).map(([n,c]) => ({name:n,count:c})).sort((a,b) => b.count-a.count), sle: [], weekly: wR }, count: rows.length - 1 };
}

export async function POST(request) {
  const user = await verifyAdmin(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { type } = await request.json();
  const auth = getGoogleAuth();
  if (!auth) return NextResponse.json({ error: "Google Sheets not configured. Add GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in Vercel env vars." }, { status: 400 });
  const sheets = google.sheets({ version: "v4", auth });
  const db = getAdminClient();
  try {
    if (type === "productivity") {
      const sid = process.env.GOOGLE_SHEET_ID_PRODUCTIVITY;
      if (!sid) return NextResponse.json({ error: "GOOGLE_SHEET_ID_PRODUCTIVITY not set in Vercel" }, { status: 400 });
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: "Form Responses!A:Z" });
      if (!res.data.values?.length) return NextResponse.json({ error: "No data" }, { status: 400 });
      const parsed = parseProductivityRows(res.data.values);
      await db.from("productivity_records").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await db.from("productivity_records").insert({ data: parsed.data, dates: parsed.dates, members: parsed.members, uploaded_by: user.id });
      return NextResponse.json({ success: true, days: parsed.dates.length });
    } else if (type === "attendance") {
      const sid = process.env.GOOGLE_SHEET_ID_ATTENDANCE;
      if (!sid) return NextResponse.json({ error: "GOOGLE_SHEET_ID_ATTENDANCE not set in Vercel" }, { status: 400 });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sid });
      const sn = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: sn + "!A:Z" });
      if (!res.data.values?.length) return NextResponse.json({ error: "No data" }, { status: 400 });
      const parsed = parseAttendanceRows(res.data.values);
      await db.from("attendance_records").upsert({ month_key: parsed.monthKey, month_label: parsed.monthLabel, data: parsed.data, uploaded_by: user.id }, { onConflict: "month_key" });
      return NextResponse.json({ success: true, records: parsed.count, month: parsed.monthLabel });
    }
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
