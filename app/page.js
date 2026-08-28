"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { parseProductivity, parseAttendance } from "@/lib/parser";

const TEAMS = ["Design","Video","Content","Social","CSE","Sales","Knowledge","Finance"];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Data
  const [prodData, setProdData] = useState(null);
  const [attIndex, setAttIndex] = useState([]);
  const [attData, setAttData] = useState({});

  // UI state
  const [tab, setTab] = useState("prod");
  const [date, setDate] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [view, setView] = useState("daily");
  const [attMonth, setAttMonth] = useState("");
  const [modal, setModal] = useState(null);
  const [attWeek, setAttWeek] = useState("");

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return; }
    setUser(session.user);
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    setProfile(prof);
    await loadData();
    setLoading(false);
  }

  async function loadData() {
    // Load productivity
    const { data: prodRows } = await supabase.from("productivity_records").select("*").order("uploaded_at", { ascending: false }).limit(1);
    if (prodRows?.length) {
      const r = prodRows[0];
      setProdData({ data: r.data, dates: r.dates, members: r.members });
      setDate(r.dates?.[0] || "");
    }
    // Load attendance index
    const { data: attRows } = await supabase.from("attendance_records").select("month_key, month_label, data").order("month_key", { ascending: false });
    if (attRows?.length) {
      setAttIndex(attRows.map(r => ({ key: r.month_key, label: r.month_label })));
      const map = {};
      attRows.forEach(r => { map[r.month_key] = r.data; });
      setAttData(map);
      setAttMonth(attRows[0].month_key);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400 text-sm">Loading...</p></div>;

  const isAdmin = profile?.role === "admin";
  const curAtt = attData[attMonth];
  const dayData = prodData?.data?.[date] || {};
  const allMembers = prodData?.members || [];
  const teams = new Set(); allMembers.forEach(m => teams.add(m.team));

  const byTeam = {};
  allMembers.forEach(m => {
    if (teamFilter !== "all" && m.team !== teamFilter) return;
    if (!byTeam[m.team]) byTeam[m.team] = [];
    byTeam[m.team].push({ name: m.name, data: dayData[m.name] || null });
  });

  const summaryStats = {};
  if (prodData?.data) Object.values(prodData.data).forEach(dd => Object.entries(dd).forEach(([name, d]) => {
    if (!summaryStats[name]) summaryStats[name] = { team: d.team, totalHours: 0, totalTasks: 0, daysWorked: 0, daysLeave: 0 };
    if (d.leave) summaryStats[name].daysLeave++; else if (d.tasks?.length > 0 || d.hours > 0) { summaryStats[name].totalHours += d.hours; summaryStats[name].totalTasks += d.tasks.length; summaryStats[name].daysWorked++; }
  }));
  const summaryRows = Object.entries(summaryStats).filter(([, s]) => teamFilter === "all" || s.team === teamFilter).sort((a, b) => b[1].totalHours - a[1].totalHours);

  return (
    <div className="max-w-7xl mx-auto px-5 py-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-1">
        <h1 className="text-xl font-semibold">Team dashboard</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{profile?.email} ({profile?.role})</span>
          <button onClick={logout} className="text-xs text-red-500 hover:text-red-700">Sign out</button>
        </div>
      </div>

      {/* Admin Panel */}
      {isAdmin && <AdminPanel user={user} onDataUpdated={loadData} />}

      {/* Tabs */}
      <div className="flex border-b border-gray-100 mb-5 mt-4">
        {[["prod", "Productivity"], ["att", "Attendance"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 ${tab === k ? "text-gray-900 border-gray-800" : "text-gray-400 border-transparent"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Productivity */}
      {tab === "prod" && (prodData ? (
        <>
          <div className="flex gap-3 items-end flex-wrap mb-5">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-400 uppercase tracking-wide">Date</label>
              <select value={date} onChange={e => setDate(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm">
                {prodData.dates.map(d => {
                  const dt = new Date(d + "T00:00:00");
                  return <option key={d} value={d}>{dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</option>;
                })}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-400 uppercase tracking-wide">Team</label>
              <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm">
                <option value="all">All teams</option>
                {TEAMS.filter(t => teams.has(t)).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex border border-gray-200 rounded-md overflow-hidden ml-auto">
              {["daily", "summary"].map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3.5 py-1.5 text-xs ${view === v ? "bg-gray-900 text-white" : "bg-white text-gray-400"}`}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {view === "daily" ? TEAMS.map(team => {
            const ms = byTeam[team]; if (!ms?.length) return null;
            const th = ms.reduce((s, m) => s + (m.data?.hours || 0), 0);
            return (
              <div key={team} className="mb-6">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2 border-b border-gray-100 mb-3 flex justify-between">
                  <span>{team} team</span>{th > 0 && <span className="font-medium text-gray-900">{th.toFixed(1)} hrs</span>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ms.map(({ name, data }) => (
                    <div key={name} className="bg-gray-50 rounded-lg p-3.5 min-h-[70px]">
                      <div className="text-sm font-medium mb-2 flex justify-between items-center">
                        <span>{name}</span>
                        {data?.leave ? <span className="text-xs text-red-600 font-medium px-2 py-0.5 bg-red-50 rounded">{data.leave}</span>
                          : data?.hours > 0 ? <span className="text-lg font-medium text-blue-500">{data.hours.toFixed(1)}h</span> : null}
                      </div>
                      {data?.tasks?.length > 0 ? data.tasks.map((t, i) => (
                        <div key={i} className="flex gap-2 py-1 border-b border-gray-100 last:border-0 text-xs items-start">
                          <span className="font-medium min-w-[80px] max-w-[120px] shrink-0">{t.project}</span>
                          <span className="flex-1 text-gray-500">{t.desc}</span>
                          <span className="font-medium text-blue-500 min-w-[35px] text-right shrink-0">{t.hrs > 0 ? t.hrs + "h" : ""}</span>
                        </div>
                      )) : !data?.leave && <p className="text-xs text-gray-300 italic">No tasks logged</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          }) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50">
                  {["#","Member","Team","Days worked","Tasks","Total hours","Avg hrs/day","Leave"].map((h, i) => (
                    <th key={h} className={`px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 ${i > 2 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{summaryRows.map(([name, s], i) => {
                  const avg = s.daysWorked > 0 ? (s.totalHours / s.daysWorked).toFixed(1) : "--";
                  return (
                    <tr key={name} className="hover:bg-gray-50">
                      <td className="px-3 py-2 border-b border-gray-100 font-semibold">{i + 1}</td>
                      <td className="px-3 py-2 border-b border-gray-100">{name}</td>
                      <td className="px-3 py-2 border-b border-gray-100">{s.team}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right">{s.daysWorked}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right">{s.totalTasks}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right">{s.totalHours.toFixed(1)}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right">{avg}</td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right">{s.daysLeave || "-"}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </>
      ) : <EmptyState icon="📊" text={isAdmin ? "Upload productivity data from the Admin panel" : "No productivity data yet"} />)}

      {/* Attendance */}
      {tab === "att" && (attIndex.length > 0 ? (
        <>
          <div className="mb-5">
            <label className="text-[10px] text-gray-400 uppercase tracking-wide block mb-1">Month</label>
            <select value={attMonth} onChange={e => setAttMonth(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm">
              {attIndex.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          {curAtt && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Late clock-ins", value: curAtt.late.length, sub: "After 9:45 AM", key: "late" },
                { label: "Short hours", value: curAtt.short.length, sub: "Below 7.5 hrs", key: "short" },
                { label: "SL / EL", value: curAtt.sle.length, sub: "Sick + emergency leave", key: "sle" },
                { label: "Weekly view", value: Object.keys(curAtt.weekly).length || "--", sub: "Weeks recorded", key: "weekly" },
              ].map(m => (
                <div key={m.key} onClick={() => { setModal(m.key); if (m.key === "weekly") setAttWeek(Object.keys(curAtt.weekly)[0] || ""); }}
                  className="bg-gray-50 rounded-lg p-4 cursor-pointer border border-transparent hover:border-gray-200 transition-all">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">{m.label}</div>
                  <div className="text-2xl font-medium">{m.value}</div>
                  <div className="text-xs text-gray-300 mt-1">{m.sub}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : <EmptyState icon="📅" text={isAdmin ? "Upload attendance data from the Admin panel" : "No attendance data yet"} />)}

      {/* Attendance Modal */}
      {modal && curAtt && (
        <div onClick={() => setModal(null)} className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl p-5 max-w-[860px] w-[92%] max-h-[82vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3 pb-3 border-b border-gray-100">
              <h3 className="text-base font-medium">
                {modal === "late" && "Late clock-ins (after 9:45 AM)"}{modal === "short" && "Short hours (below 7.5 hrs)"}{modal === "sle" && "SL / EL usage"}{modal === "weekly" && "Weekly attendance"}
              </h3>
              <button onClick={() => setModal(null)} className="text-xl text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            {modal === "weekly" && (
              <div className="flex gap-2 items-center mb-3">
                <span className="text-xs text-gray-400">Week:</span>
                <select value={attWeek} onChange={e => setAttWeek(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-sm">
                  {Object.keys(curAtt.weekly).map(w => <option key={w} value={w}>{w.replace("w", "Week ")}</option>)}
                </select>
              </div>
            )}
            <table className="w-full text-sm">
              {modal === "late" && <><thead><tr className="bg-gray-50"><th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">#</th><th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Employee</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-400 uppercase">Count</th></tr></thead><tbody>{curAtt.late.map((e, i) => <tr key={i}><td className="px-3 py-2 border-b border-gray-100 font-semibold">{i + 1}</td><td className="px-3 py-2 border-b border-gray-100">{e.name}</td><td className="px-3 py-2 border-b border-gray-100 text-right font-medium">{e.count}</td></tr>)}</tbody></>}
              {modal === "short" && <><thead><tr className="bg-gray-50"><th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">#</th><th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Employee</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-400 uppercase">Count</th></tr></thead><tbody>{curAtt.short.map((e, i) => <tr key={i}><td className="px-3 py-2 border-b border-gray-100 font-semibold">{i + 1}</td><td className="px-3 py-2 border-b border-gray-100">{e.name}</td><td className="px-3 py-2 border-b border-gray-100 text-right font-medium">{e.count}</td></tr>)}</tbody></>}
              {modal === "sle" && <><thead><tr className="bg-gray-50"><th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">#</th><th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">Employee</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-400 uppercase">SL</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-400 uppercase">EL</th></tr></thead><tbody>{curAtt.sle.map((e, i) => <tr key={i}><td className="px-3 py-2 border-b border-gray-100 font-semibold">{i + 1}</td><td className="px-3 py-2 border-b border-gray-100">{e.name}</td><td className="px-3 py-2 border-b border-gray-100 text-right font-medium">{e.sl}</td><td className="px-3 py-2 border-b border-gray-100 text-right font-medium">{e.el}</td></tr>)}</tbody></>}
              {modal === "weekly" && <><thead><tr className="bg-gray-50">{["Date","Name","Clock In","Clock Out","Hours","Remark"].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>)}</tr></thead><tbody>{(curAtt.weekly[attWeek] || []).map((r, i) => <tr key={i}><td className="px-3 py-2 border-b border-gray-100">{r.date}</td><td className="px-3 py-2 border-b border-gray-100">{r.name}</td><td className="px-3 py-2 border-b border-gray-100">{r.ci}</td><td className="px-3 py-2 border-b border-gray-100">{r.co}</td><td className="px-3 py-2 border-b border-gray-100">{r.hrs}</td><td className="px-3 py-2 border-b border-gray-100">{r.rm && <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${r.rm.toUpperCase().includes("WFH") ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"}`}>{r.rm}</span>}</td></tr>)}</tbody></>}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== ADMIN PANEL ==========
function AdminPanel({ user, onDataUpdated }) {
  const [users, setUsers] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("viewer");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [prodStatus, setProdStatus] = useState(null);
  const [attStatus, setAttStatus] = useState(null);
  const [recording, setRecording] = useState(false);
  const [pendingProd, setPendingProd] = useState(null);
  const [pendingAtt, setPendingAtt] = useState(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    if (data) setUsers(data);
  }

  async function addUser() {
    if (!newEmail) { setAddError("Enter an email address"); return; }
    setAdding(true); setAddError("");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ email: newEmail, role: newRole }),
    });
    const result = await res.json();
    if (result.error) { setAddError(result.error); setAdding(false); return; }
    setAddError(""); setNewEmail(""); setNewRole("viewer");
    alert("Invite sent to " + newEmail + ". They will receive an email to set their password.");
    loadUsers(); setAdding(false);
  }

  async function removeUser(userId) {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ userId }),
    });
    loadUsers();
  }

  function handleProdFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const result = parseProductivity(evt.target.result);
        setPendingProd(result);
        setProdStatus({ ok: true, msg: `${result.dates.length} days parsed from ${file.name}` });
      } catch (err) { setProdStatus({ ok: false, msg: err.message }); }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleAttFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const result = parseAttendance(evt.target.result, file.name);
        setPendingAtt(result);
        setAttStatus({ ok: true, msg: `${result.count} records parsed (${result.monthLabel})` });
      } catch (err) { setAttStatus({ ok: false, msg: err.message }); }
    };
    reader.readAsArrayBuffer(file);
  }

  async function recordProd() {
    if (!pendingProd) return; setRecording(true);
    // Delete old records, insert new
    await supabase.from("productivity_records").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("productivity_records").insert({
      data: pendingProd.data, dates: pendingProd.dates, members: pendingProd.members, uploaded_by: user.id,
    });
    setPendingProd(null); setProdStatus({ ok: true, msg: "Recorded and live for all users" });
    setRecording(false); onDataUpdated();
  }

  async function recordAtt() {
    if (!pendingAtt) return; setRecording(true);
    await supabase.from("attendance_records").upsert({
      month_key: pendingAtt.monthKey, month_label: pendingAtt.monthLabel, data: pendingAtt.data, uploaded_by: user.id,
    }, { onConflict: "month_key" });
    setPendingAtt(null); setAttStatus({ ok: true, msg: "Recorded and live for all users" });
    setRecording(false); onDataUpdated();
  }

  return (
    <details className="mt-4 mb-2">
      <summary className="text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-600">Admin panel</summary>
      <div className="pt-4 space-y-4">
        {/* User Management */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Manage access</h3>
          <div className="flex gap-2 mb-3 flex-wrap">
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@company.com"
              className="flex-1 min-w-[160px] px-3 py-1.5 border border-gray-200 rounded-md text-sm" />
            <select value={newRole} onChange={e => setNewRole(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm">
              <option value="viewer">Viewer</option><option value="admin">Admin</option>
            </select>
            <button onClick={addUser} disabled={adding}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-50">Add</button>
          </div>
          {addError && <p className="text-xs text-red-600 mb-2">{addError}</p>}
          <div className="space-y-1">
            {users.map(u => (
              <div key={u.id} className="flex justify-between items-center px-2 py-1.5 bg-white rounded text-sm">
                <span>{u.email}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${u.role === "admin" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"}`}>{u.role}</span>
                  {u.id !== user.id && <button onClick={() => removeUser(u.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Upload Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block cursor-pointer">
              <div className={`border-2 border-dashed rounded-lg p-5 text-center transition-all ${prodStatus?.ok ? "border-green-500 bg-green-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}>
                <div className={`text-lg mb-1 ${prodStatus?.ok ? "text-green-600" : "text-gray-300"}`}>{prodStatus?.ok ? "✓" : "📊"}</div>
                <div className={`text-sm ${prodStatus?.ok ? "text-green-600" : "text-gray-500"}`}>{prodStatus?.msg || "Upload TEAM_PRODUCTIVITY Excel"}</div>
              </div>
              <input type="file" accept=".xlsx,.xls" onChange={handleProdFile} className="hidden" />
            </label>
            {pendingProd && <button onClick={recordProd} disabled={recording}
              className="mt-2 w-full py-2 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {recording ? "Recording..." : "Record productivity data"}</button>}
          </div>
          <div>
            <label className="block cursor-pointer">
              <div className={`border-2 border-dashed rounded-lg p-5 text-center transition-all ${attStatus?.ok ? "border-green-500 bg-green-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}>
                <div className={`text-lg mb-1 ${attStatus?.ok ? "text-green-600" : "text-gray-300"}`}>{attStatus?.ok ? "✓" : "📅"}</div>
                <div className={`text-sm ${attStatus?.ok ? "text-green-600" : "text-gray-500"}`}>{attStatus?.msg || "Upload ATT_Month Excel"}</div>
              </div>
              <input type="file" accept=".xlsx,.xls" onChange={handleAttFile} className="hidden" />
            </label>
            {pendingAtt && <button onClick={recordAtt} disabled={recording}
              className="mt-2 w-full py-2 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {recording ? "Recording..." : "Record attendance data"}</button>}
          </div>
        </div>
      </div>
    </details>
  );
}

function EmptyState({ icon, text }) {
  return <div className="text-center py-12 text-gray-400"><div className="text-3xl text-gray-200 mb-2">{icon}</div><p>{text}</p></div>;
}
