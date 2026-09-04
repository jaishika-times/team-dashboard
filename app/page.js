"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { parseProductivity, parseAttendanceAuto } from "@/lib/parser";

const TEAMS = ["Design","Video","Content","Social","CSE","Sales","Knowledge","Finance"];
const TEAM_COLORS = {Design:"#6366f1",Video:"#3b82f6",Content:"#10b981",Social:"#f59e0b",CSE:"#ef4444",Sales:"#8b5cf6",Knowledge:"#06b6d4",Finance:"#ec4899"};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prodData, setProdData] = useState(null);
  const [attIndex, setAttIndex] = useState([]);
  const [attData, setAttData] = useState({});
  const [page, setPage] = useState("overview");
  const [sideOpen, setSideOpen] = useState(true);
  const [date, setDate] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [view, setView] = useState("daily");
  const [attMonth, setAttMonth] = useState("");
  const [modal, setModal] = useState(null);
  const [attWeek, setAttWeek] = useState("");
  const [selectedTeam, setSelectedTeam] = useState(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return; }
    setUser(session.user);
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    if (!prof || prof.role === "pending") { router.push("/login"); return; }
    setProfile(prof);
    await loadData();
    setLoading(false);
  }

  async function loadData() {
    const { data: prodRows } = await supabase.from("productivity_records").select("*").order("uploaded_at", { ascending: false }).limit(1);
    if (prodRows?.length) { const r = prodRows[0]; setProdData({ data: r.data, dates: r.dates, members: r.members }); setDate(r.dates?.[0] || ""); }
    const { data: attRows } = await supabase.from("attendance_records").select("*").order("month_key", { ascending: false });
    if (attRows?.length) { setAttIndex(attRows.map(r => ({ key: r.month_key, label: r.month_label }))); const map = {}; attRows.forEach(r => { map[r.month_key] = r.data; }); setAttData(map); setAttMonth(attRows[0].month_key); }
  }

  async function logout() { await supabase.auth.signOut(); router.push("/login"); }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400 text-sm">Loading...</p></div>;

  const isAdmin = profile?.role === "admin";
  const curAtt = attData[attMonth];

  // Compute overview stats
  const totalMembers = prodData?.members?.length || 0;
  const totalDates = prodData?.dates?.length || 0;
  const totalAttMonths = attIndex.length;
  let totalLate = 0; let totalShort = 0;
  if (curAtt) { totalLate = curAtt.late?.reduce((s, e) => s + e.count, 0) || 0; totalShort = curAtt.short?.reduce((s, e) => s + e.count, 0) || 0; }

  // Team stats for cards
  const teamStats = {};
  if (prodData?.data) {
    Object.values(prodData.data).forEach(dd => {
      Object.entries(dd).forEach(([name, d]) => {
        if (!teamStats[d.team]) teamStats[d.team] = { hours: 0, tasks: 0, members: new Set(), daysLeave: 0 };
        teamStats[d.team].members.add(name);
        if (d.leave) teamStats[d.team].daysLeave++;
        else { teamStats[d.team].hours += d.hours || 0; teamStats[d.team].tasks += d.tasks?.length || 0; }
      });
    });
  }

  // Daily data for selected date
  const dayData = prodData?.data?.[date] || {};
  const allMembers = prodData?.members || [];
  const teams = new Set(); allMembers.forEach(m => teams.add(m.team));

  // Summary stats
  const summaryStats = {};
  if (prodData?.data) Object.values(prodData.data).forEach(dd => Object.entries(dd).forEach(([name, d]) => {
    if (!summaryStats[name]) summaryStats[name] = { team: d.team, totalHours: 0, totalTasks: 0, daysWorked: 0, daysLeave: 0 };
    if (d.leave) summaryStats[name].daysLeave++; else if (d.tasks?.length > 0 || d.hours > 0) { summaryStats[name].totalHours += d.hours; summaryStats[name].totalTasks += d.tasks.length; summaryStats[name].daysWorked++; }
  }));

  const navItems = [
    { id: "overview", icon: "◻", label: "Overview" },
    { id: "productivity", icon: "◈", label: "Productivity" },
    { id: "attendance", icon: "◷", label: "Attendance" },
    { id: "report", icon: "◩", label: "Report" },
  ];
  if (isAdmin) navItems.push({ id: "admin", icon: "◎", label: "Admin" });

  return (
    <div className="flex min-h-screen bg-white" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* SIDEBAR */}
      <div className={`${sideOpen ? "w-56" : "w-16"} bg-gray-950 text-white flex flex-col transition-all duration-200 shrink-0`}>
        <div className="p-4 flex items-center justify-between">
          {sideOpen && <span className="text-sm font-semibold tracking-wide">Dashboard</span>}
          <button onClick={() => setSideOpen(!sideOpen)} className="text-gray-400 hover:text-white text-lg">
            {sideOpen ? "◁" : "▷"}
          </button>
        </div>
        <nav className="flex-1 px-2 space-y-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => { setPage(item.id); setSelectedTeam(null); if (item.id === "report") window.open("/report", "_blank"); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${page === item.id ? "bg-white/10 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"}`}>
              <span className="text-base">{item.icon}</span>
              {sideOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className={`flex items-center gap-2 ${sideOpen ? "" : "justify-center"}`}>
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-medium">
              {profile?.email?.[0]?.toUpperCase()}
            </div>
            {sideOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white truncate">{profile?.email}</p>
                <button onClick={logout} className="text-[10px] text-gray-500 hover:text-red-400">Sign out</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-6">

          {/* ===== OVERVIEW ===== */}
          {page === "overview" && (
            <>
              <h1 className="text-xl font-semibold mb-1">Overview</h1>
              <p className="text-sm text-gray-400 mb-6">Team performance at a glance</p>

              {/* Summary boxes */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { label: "Team members", value: totalMembers, sub: "tracked", color: "#6366f1" },
                  { label: "Days recorded", value: totalDates, sub: "productivity", color: "#3b82f6" },
                  { label: "Late arrivals", value: totalLate, sub: curAtt ? "this month" : "no data", color: "#ef4444" },
                  { label: "Short hours", value: totalShort, sub: curAtt ? "this month" : "no data", color: "#f59e0b" },
                ].map((card, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">{card.label}</p>
                    <p className="text-3xl font-semibold" style={{ color: card.color }}>{card.value}</p>
                    <p className="text-xs text-gray-300 mt-1">{card.sub}</p>
                  </div>
                ))}
              </div>

              {/* Team cards */}
              {Object.keys(teamStats).length > 0 && (
                <>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Teams</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    {TEAMS.filter(t => teamStats[t]).map(team => {
                      const s = teamStats[team];
                      const avgHrs = s.members.size > 0 ? (s.hours / (s.members.size * Math.max(totalDates, 1))).toFixed(1) : "0";
                      return (
                        <div key={team} onClick={() => { setPage("productivity"); setTeamFilter(team); }}
                          className="bg-white border border-gray-100 rounded-xl p-5 cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-semibold" style={{ background: TEAM_COLORS[team] || "#888" }}>
                              {team[0]}
                            </div>
                            <div>
                              <p className="text-sm font-semibold">{team}</p>
                              <p className="text-xs text-gray-400">{s.members.size} members</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div><p className="text-lg font-semibold">{s.hours.toFixed(0)}</p><p className="text-[10px] text-gray-400">Total hrs</p></div>
                            <div><p className="text-lg font-semibold">{s.tasks}</p><p className="text-[10px] text-gray-400">Tasks</p></div>
                            <div><p className="text-lg font-semibold">{avgHrs}</p><p className="text-[10px] text-gray-400">Avg hrs/day</p></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Attendance snapshot */}
              {curAtt && (
                <>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Attendance - {attIndex[0]?.label}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {curAtt.late?.slice(0, 5).length > 0 && (
                      <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                        <p className="text-xs font-semibold text-red-400 uppercase mb-2">Most late arrivals</p>
                        {curAtt.late.slice(0, 5).map((e, i) => (
                          <div key={i} className="flex justify-between text-sm py-1"><span className="text-gray-600">{e.name}</span><span className="font-semibold text-red-500">{e.count}x</span></div>
                        ))}
                      </div>
                    )}
                    {curAtt.short?.slice(0, 5).length > 0 && (
                      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                        <p className="text-xs font-semibold text-amber-500 uppercase mb-2">Most short hours</p>
                        {curAtt.short.slice(0, 5).map((e, i) => (
                          <div key={i} className="flex justify-between text-sm py-1"><span className="text-gray-600">{e.name}</span><span className="font-semibold text-amber-500">{e.count}x</span></div>
                        ))}
                      </div>
                    )}
                    {curAtt.sle?.slice(0, 5).length > 0 && (
                      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                        <p className="text-xs font-semibold text-blue-400 uppercase mb-2">Leave usage (SL/EL)</p>
                        {curAtt.sle.slice(0, 5).map((e, i) => (
                          <div key={i} className="flex justify-between text-sm py-1"><span className="text-gray-600">{e.name}</span><span className="font-semibold text-blue-500">{e.sl + e.el}d</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {!prodData && !curAtt && (
                <div className="text-center py-16 text-gray-300">
                  <p className="text-4xl mb-3">📊</p>
                  <p className="text-lg font-medium text-gray-400">No data yet</p>
                  <p className="text-sm text-gray-300">{isAdmin ? "Go to Admin to upload your Excel files" : "Ask an admin to upload data"}</p>
                </div>
              )}
            </>
          )}

          {/* ===== PRODUCTIVITY ===== */}
          {page === "productivity" && (
            <>
              <h1 className="text-xl font-semibold mb-1">Productivity</h1>
              <p className="text-sm text-gray-400 mb-5">Daily tasks and team performance</p>

              {prodData ? (
                <>
                  <div className="flex gap-3 items-end flex-wrap mb-5">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-400 uppercase tracking-wide">Date</label>
                      <select value={date} onChange={e => setDate(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                        {prodData.dates.map(d => { const dt = new Date(d + "T00:00:00"); return <option key={d} value={d}>{dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</option>; })}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-400 uppercase tracking-wide">Team</label>
                      <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                        <option value="all">All teams</option>
                        {TEAMS.filter(t => teams.has(t)).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="flex border border-gray-200 rounded-lg overflow-hidden ml-auto">
                      {["daily", "summary"].map(v => (
                        <button key={v} onClick={() => setView(v)} className={`px-4 py-1.5 text-xs font-medium ${view === v ? "bg-gray-900 text-white" : "bg-white text-gray-400 hover:text-gray-600"}`}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {view === "daily" ? (
                    TEAMS.map(team => {
                      if (teamFilter !== "all" && team !== teamFilter) return null;
                      const members = allMembers.filter(m => m.team === team);
                      if (!members.length) return null;
                      const th = members.reduce((s, m) => s + (dayData[m.name]?.hours || 0), 0);
                      return (
                        <div key={team} className="mb-6">
                          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                            <div className="w-6 h-6 rounded flex items-center justify-center text-white text-[10px] font-bold" style={{ background: TEAM_COLORS[team] || "#888" }}>{team[0]}</div>
                            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex-1">{team} team</span>
                            {th > 0 && <span className="text-sm font-semibold">{th.toFixed(1)} hrs</span>}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {members.map(({ name }) => {
                              const data = dayData[name];
                              return (
                                <div key={name} className="bg-gray-50 rounded-xl p-4 min-h-[70px] border border-gray-100">
                                  <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-medium">{name}</span>
                                    {data?.leave ? <span className="text-xs text-red-500 font-medium px-2 py-0.5 bg-red-50 rounded-md border border-red-100">{data.leave}</span>
                                      : data?.hours > 0 ? <span className="text-xl font-semibold text-blue-500">{data.hours.toFixed(1)}h</span> : null}
                                  </div>
                                  {data?.tasks?.length > 0 ? data.tasks.map((t, i) => (
                                    <div key={i} className="flex gap-2 py-1.5 border-b border-gray-100 last:border-0 text-xs">
                                      <span className="font-medium min-w-[80px] max-w-[120px] shrink-0 text-gray-700">{t.project}</span>
                                      <span className="flex-1 text-gray-400">{t.desc}</span>
                                      <span className="font-medium text-blue-500 min-w-[35px] text-right shrink-0">{t.hrs > 0 ? t.hrs + "h" : ""}</span>
                                    </div>
                                  )) : !data?.leave && <p className="text-xs text-gray-300 italic">No tasks logged</p>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-gray-100">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-gray-50">{["#","Member","Team","Days","Tasks","Hours","Avg/day","Leave"].map((h, i) => (
                          <th key={h} className={`px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide ${i > 2 ? "text-right" : "text-left"}`}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{Object.entries(summaryStats).filter(([, s]) => teamFilter === "all" || s.team === teamFilter).sort((a, b) => b[1].totalHours - a[1].totalHours).map(([name, s], i) => (
                          <tr key={name} className="hover:bg-gray-50 border-t border-gray-50">
                            <td className="px-3 py-2 font-semibold text-gray-300">{i + 1}</td>
                            <td className="px-3 py-2 font-medium">{name}</td>
                            <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded-md text-white" style={{ background: TEAM_COLORS[s.team] || "#888" }}>{s.team}</span></td>
                            <td className="px-3 py-2 text-right">{s.daysWorked}</td>
                            <td className="px-3 py-2 text-right">{s.totalTasks}</td>
                            <td className="px-3 py-2 text-right font-semibold">{s.totalHours.toFixed(1)}</td>
                            <td className="px-3 py-2 text-right">{s.daysWorked > 0 ? (s.totalHours / s.daysWorked).toFixed(1) : "--"}</td>
                            <td className="px-3 py-2 text-right">{s.daysLeave || "-"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : <EmptyState icon="📊" text={isAdmin ? "Upload data from Admin panel" : "No data yet"} />}
            </>
          )}

          {/* ===== ATTENDANCE ===== */}
          {page === "attendance" && (
            <>
              <h1 className="text-xl font-semibold mb-1">Attendance</h1>
              <p className="text-sm text-gray-400 mb-5">Clock-in analysis and leave tracking</p>

              {attIndex.length > 0 ? (
                <>
                  <div className="mb-5">
                    <label className="text-[10px] text-gray-400 uppercase tracking-wide block mb-1">Month</label>
                    <select value={attMonth} onChange={e => setAttMonth(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                      {attIndex.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  </div>
                  {curAtt && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      {[
                        { label: "Late clock-ins", value: curAtt.late?.length || 0, sub: "After 9:45 AM", key: "late", color: "#ef4444", bg: "bg-red-50 border-red-100" },
                        { label: "Short hours", value: curAtt.short?.length || 0, sub: "Below 7.5 hrs", key: "short", color: "#f59e0b", bg: "bg-amber-50 border-amber-100" },
                        { label: "SL / EL", value: curAtt.sle?.length || 0, sub: "Sick + emergency", key: "sle", color: "#6366f1", bg: "bg-indigo-50 border-indigo-100" },
                        { label: "Weekly view", value: Object.keys(curAtt.weekly || {}).length || "--", sub: "Weeks recorded", key: "weekly", color: "#3b82f6", bg: "bg-blue-50 border-blue-100" },
                      ].map(m => (
                        <div key={m.key} onClick={() => { setModal(m.key); if (m.key === "weekly") setAttWeek(Object.keys(curAtt.weekly)[0] || ""); }}
                          className={`rounded-xl p-4 cursor-pointer border transition-all hover:shadow-sm ${m.bg}`}>
                          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: m.color }}>{m.label}</p>
                          <p className="text-3xl font-semibold" style={{ color: m.color }}>{m.value}</p>
                          <p className="text-xs text-gray-400 mt-1">{m.sub}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : <EmptyState icon="📅" text={isAdmin ? "Upload data from Admin panel" : "No data yet"} />}
            </>
          )}

          {/* ===== ADMIN ===== */}
          {page === "admin" && isAdmin && <AdminPanel user={user} onDataUpdated={loadData} />}
        </div>
      </div>

      {/* ATTENDANCE MODALS */}
      {modal && curAtt && (
        <div onClick={() => setModal(null)} className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl p-5 max-w-[860px] w-[92%] max-h-[82vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center mb-3 pb-3 border-b border-gray-100">
              <h3 className="text-base font-semibold">
                {modal === "late" && "Late clock-ins (after 9:45 AM)"}{modal === "short" && "Short hours (below 7.5 hrs)"}{modal === "sle" && "SL / EL usage"}{modal === "weekly" && "Weekly attendance"}
              </h3>
              <button onClick={() => setModal(null)} className="text-xl text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100">&times;</button>
            </div>
            {modal === "weekly" && (
              <div className="flex gap-2 items-center mb-3">
                <span className="text-xs text-gray-400">Week:</span>
                <select value={attWeek} onChange={e => setAttWeek(e.target.value)} className="px-2 py-1 border border-gray-200 rounded-lg text-sm">
                  {Object.keys(curAtt.weekly).map(w => <option key={w} value={w}>{w.replace("w", "Week ")}</option>)}
                </select>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                {modal === "late" && <><thead><tr className="bg-gray-50"><th className={thC}>#</th><th className={thC}>Employee</th><th className={thCR}>Count</th></tr></thead><tbody>{curAtt.late.map((e, i) => <tr key={i} className="border-t border-gray-50"><td className={tdC + " font-semibold text-gray-300"}>{i + 1}</td><td className={tdC}>{e.name}</td><td className={tdCR + " font-semibold"}>{e.count}</td></tr>)}</tbody></>}
                {modal === "short" && <><thead><tr className="bg-gray-50"><th className={thC}>#</th><th className={thC}>Employee</th><th className={thCR}>Count</th></tr></thead><tbody>{curAtt.short.map((e, i) => <tr key={i} className="border-t border-gray-50"><td className={tdC + " font-semibold text-gray-300"}>{i + 1}</td><td className={tdC}>{e.name}</td><td className={tdCR + " font-semibold"}>{e.count}</td></tr>)}</tbody></>}
                {modal === "sle" && <><thead><tr className="bg-gray-50"><th className={thC}>#</th><th className={thC}>Employee</th><th className={thCR}>SL</th><th className={thCR}>EL</th></tr></thead><tbody>{curAtt.sle.map((e, i) => <tr key={i} className="border-t border-gray-50"><td className={tdC + " font-semibold text-gray-300"}>{i + 1}</td><td className={tdC}>{e.name}</td><td className={tdCR + " font-semibold"}>{e.sl}</td><td className={tdCR + " font-semibold"}>{e.el}</td></tr>)}</tbody></>}
                {modal === "weekly" && <><thead><tr className="bg-gray-50">{["Date","Name","Clock In","Clock Out","Hours","Remark"].map(h => <th key={h} className={thC}>{h}</th>)}</tr></thead><tbody>{(curAtt.weekly[attWeek] || []).map((r, i) => <tr key={i} className="border-t border-gray-50"><td className={tdC}>{r.date}</td><td className={tdC}>{r.name}</td><td className={tdC}>{r.ci}</td><td className={tdC}>{r.co}</td><td className={tdC}>{r.hrs}</td><td className={tdC}>{r.rm && <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${r.rm.toUpperCase().includes("WFH") ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"}`}>{r.rm}</span>}</td></tr>)}</tbody></>}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thC = "px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide";
const thCR = thC + " text-right";
const tdC = "px-3 py-2";
const tdCR = tdC + " text-right";

// ===== ADMIN PANEL =====
function AdminPanel({ user, onDataUpdated }) {
  const [users, setUsers] = useState([]);
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

  async function updateRole(userId, newRole) {
    await supabase.from("profiles").update({ role: newRole }).eq("id", userId);
    loadUsers();
  }

  async function removeUser(email) {
    await supabase.from("profiles").delete().eq("email", email.toLowerCase());
    loadUsers();
  }

  function handleProdFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try { const result = parseProductivity(evt.target.result); setPendingProd(result); setProdStatus({ ok: true, msg: `${result.dates.length} days from ${file.name}` }); }
      catch (err) { setProdStatus({ ok: false, msg: err.message }); }
    }; reader.readAsArrayBuffer(file);
  }

  function handleAttFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try { const result = parseAttendanceAuto(evt.target.result, file.name); setPendingAtt(result); setAttStatus({ ok: true, msg: `${result.count} records (${result.monthLabel})` }); }
      catch (err) { setAttStatus({ ok: false, msg: err.message }); }
    }; reader.readAsArrayBuffer(file);
  }

  async function recordProd() {
    if (!pendingProd) return; setRecording(true);
    await supabase.from("productivity_records").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("productivity_records").insert({ data: pendingProd.data, dates: pendingProd.dates, members: pendingProd.members, uploaded_by: user.id });
    setPendingProd(null); setProdStatus({ ok: true, msg: "Recorded" }); setRecording(false); onDataUpdated();
  }

  async function recordAtt() {
    if (!pendingAtt) return; setRecording(true);
    await supabase.from("attendance_records").upsert({ month_key: pendingAtt.monthKey, month_label: pendingAtt.monthLabel, data: pendingAtt.data, uploaded_by: user.id }, { onConflict: "month_key" });
    setPendingAtt(null); setAttStatus({ ok: true, msg: "Recorded" }); setRecording(false); onDataUpdated();
  }

  async function clearData(type) {
    if (!confirm("Clear all " + (type === "prod" ? "productivity" : "attendance") + " data?")) return;
    if (type === "prod") { await supabase.from("productivity_records").delete().neq("id", "00000000-0000-0000-0000-000000000000"); setProdStatus(null); }
    else { await supabase.from("attendance_records").delete().neq("id", "00000000-0000-0000-0000-000000000000"); setAttStatus(null); }
    onDataUpdated();
  }

  return (
    <>
      <h1 className="text-xl font-semibold mb-1">Admin</h1>
      <p className="text-sm text-gray-400 mb-6">Manage team access and upload data</p>

      {/* Users */}
      <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 mb-5">
        <h3 className="text-sm font-semibold mb-1">Team access</h3>
        <p className="text-xs text-gray-400 mb-4">People sign in with Google. Set their role to approve access.</p>
        <div className="space-y-1.5">
          {users.map(u => (
            <div key={u.id} className="flex justify-between items-center px-3 py-2 bg-white rounded-lg text-sm border border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-semibold">{u.email?.[0]?.toUpperCase()}</div>
                <span className="text-sm">{u.email}</span>
                {u.role === "pending" && <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-medium border border-amber-200">needs approval</span>}
              </div>
              <div className="flex items-center gap-2">
                <select value={u.role} onChange={e => updateRole(u.id, e.target.value)}
                  className={`text-xs font-medium px-2 py-1 rounded-md border-0 cursor-pointer ${u.role === "admin" ? "bg-blue-50 text-blue-600" : u.role === "pending" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-500"}`}>
                  <option value="pending">Pending</option><option value="viewer">Viewer</option><option value="admin">Admin</option>
                </select>
                {u.id !== user.id && <button onClick={() => removeUser(u.email)} className="text-xs text-red-400 hover:text-red-600">Remove</button>}
              </div>
            </div>
          ))}
          {users.length === 0 && <p className="text-sm text-gray-300 text-center py-4">No users yet. Share your dashboard URL for people to sign in.</p>}
        </div>
      </div>

      {/* Uploads */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block cursor-pointer">
            <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${prodStatus?.ok ? "border-green-400 bg-green-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}>
              <div className={`text-xl mb-1 ${prodStatus?.ok ? "text-green-500" : "text-gray-300"}`}>{prodStatus?.ok ? "✓" : "📊"}</div>
              <div className={`text-sm font-medium ${prodStatus?.ok ? "text-green-600" : "text-gray-500"}`}>{prodStatus?.msg || "Upload productivity file"}</div>
              <div className="text-xs text-gray-400 mt-1">XLSX, XLS, CSV</div>
            </div>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleProdFile} className="hidden" />
          </label>
          {pendingProd && <button onClick={recordProd} disabled={recording} className="mt-2 w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl disabled:opacity-50">Record</button>}
        </div>
        <div>
          <label className="block cursor-pointer">
            <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${attStatus?.ok ? "border-green-400 bg-green-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}>
              <div className={`text-xl mb-1 ${attStatus?.ok ? "text-green-500" : "text-gray-300"}`}>{attStatus?.ok ? "✓" : "📅"}</div>
              <div className={`text-sm font-medium ${attStatus?.ok ? "text-green-600" : "text-gray-500"}`}>{attStatus?.msg || "Upload attendance file"}</div>
              <div className="text-xs text-gray-400 mt-1">XLSX, XLS, CSV</div>
            </div>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleAttFile} className="hidden" />
          </label>
          {pendingAtt && <button onClick={recordAtt} disabled={recording} className="mt-2 w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl disabled:opacity-50">Record</button>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <a href="/report" target="_blank" className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 inline-block">Monthly report</a>
        <button onClick={() => clearData("prod")} className="px-4 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50">Clear productivity</button>
        <button onClick={() => clearData("att")} className="px-4 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50">Clear attendance</button>
      </div>
    </>
  );
}

function EmptyState({ icon, text }) {
  return <div className="text-center py-16 text-gray-300"><div className="text-4xl mb-3">{icon}</div><p className="text-gray-400">{text}</p></div>;
}
