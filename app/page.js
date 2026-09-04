"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { parseProductivity, parseAttendanceAuto, parseWeeklyKPI, parsePastedCSV } from "@/lib/parser";

const TEAMS = ["Design","Video","Content","Social","CSE","Sales","Knowledge","Finance"];
const TEAM_COLORS = {Design:"#6366f1",Video:"#3b82f6",Content:"#10b981",Social:"#f59e0b",CSE:"#ef4444",Sales:"#8b5cf6",Knowledge:"#06b6d4",Finance:"#ec4899"};
const TEAM_ICONS = {Design:"🎨",Video:"🎬",Content:"✍️",Social:"📱",CSE:"🛠️",Sales:"💼",Knowledge:"📚",Finance:"💰"};
const TEAM_GRADIENTS = {Design:"from-indigo-500 to-purple-600",Video:"from-blue-500 to-cyan-500",Content:"from-emerald-500 to-teal-500",Social:"from-amber-400 to-orange-500",CSE:"from-red-500 to-rose-500",Sales:"from-violet-500 to-purple-500",Knowledge:"from-cyan-500 to-blue-500",Finance:"from-pink-500 to-rose-500"};

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
  const [kpiData, setKpiData] = useState(null);
  const [kpiPeriod, setKpiPeriod] = useState("");

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
    const { data: kpiRows } = await supabase.from("weekly_kpi").select("*").order("uploaded_at", { ascending: false }).limit(1);
    if (kpiRows?.length) { setKpiData(kpiRows[0].data); }
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
    { id: "kpi", icon: "◆", label: "Weekly KPI" },
  ];
  const pendingCount = isAdmin ? 0 : 0; // calculated below
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
            <button key={item.id} onClick={() => { setPage(item.id); setSelectedTeam(null); }}
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
              <h1 className="text-xl font-semibold mb-6">Overview</h1>
              {isAdmin && <PendingBanner onGoToAdmin={() => setPage("admin")} />}

              {allMembers.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {TEAMS.filter(t => allMembers.some(m => m.team === t)).map(team => {
                    const members = allMembers.filter(m => m.team === team);
                    return (
                      <div key={team} className="rounded-2xl overflow-hidden border border-gray-100" style={{ background: "#fff" }}>
                        <div className={`h-1.5 bg-gradient-to-r ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"}`} />
                        <div className="p-5">
                          <div className="flex items-center gap-3 mb-4">
                            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"} flex items-center justify-center text-lg`}>
                              {TEAM_ICONS[team] || "📋"}
                            </div>
                            <div>
                              <p className="text-sm font-bold">{team}</p>
                              <p className="text-xs text-gray-400">{members.length} member{members.length !== 1 ? "s" : ""}</p>
                            </div>
                          </div>
                          <div className="space-y-2 pt-3 border-t border-gray-100">
                            {members.map(m => (
                              <div key={m.name} className="flex items-center gap-2.5 py-1">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: TEAM_COLORS[team] || "#888" }}>
                                  {m.name[0]}
                                </div>
                                <span className="text-sm text-gray-700">{m.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
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
                    {isAdmin && <SmallUpload type="prod" onRecorded={loadData} userId={user.id} />}
                  </div>

                  {/* Team summary cards */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                    {TEAMS.filter(t => allMembers.some(m => m.team === t)).map(team => {
                      const members = allMembers.filter(m => m.team === team);
                      const th = members.reduce((s, m) => s + (dayData[m.name]?.hours || 0), 0);
                      const taskCount = members.reduce((s, m) => s + (dayData[m.name]?.tasks?.length || 0), 0);
                      return (
                        <div key={team} className="rounded-xl overflow-hidden border border-gray-100 bg-white">
                          <div className={`h-1 bg-gradient-to-r ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"}`} />
                          <div className="p-3.5">
                            <div className="flex items-center gap-2.5 mb-2">
                              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"} flex items-center justify-center text-base`}>{TEAM_ICONS[team] || "📋"}</div>
                              <div>
                                <p className="text-sm font-bold">{team}</p>
                                <p className="text-[11px] text-gray-400">{members.length} members</p>
                              </div>
                            </div>
                            <div className="flex gap-4 pt-2 border-t border-gray-50">
                              <div><span className="text-lg font-bold">{taskCount}</span><span className="text-[10px] text-gray-400 ml-1">tasks</span></div>
                              <div><span className="text-lg font-bold">{th > 0 ? th.toFixed(1) : "0"}</span><span className="text-[10px] text-gray-400 ml-1">hrs</span></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Member details by team */}
                  <div className="space-y-6">
                    {TEAMS.filter(t => allMembers.some(m => m.team === t)).map(team => {
                      const members = allMembers.filter(m => m.team === team);
                      const th = members.reduce((s, m) => s + (dayData[m.name]?.hours || 0), 0);
                      return (
                        <div key={team}>
                          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"} flex items-center justify-center text-sm`}>{TEAM_ICONS[team] || "📋"}</div>
                            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex-1">{team}</span>
                            {th > 0 && <span className="text-sm font-semibold">{th.toFixed(1)} hrs</span>}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {members.map(({ name }) => {
                              const data = dayData[name];
                              return (
                                <div key={name} className="bg-gray-50 rounded-xl p-4 min-h-[70px] border border-gray-100">
                                  <div className="flex justify-between items-center mb-2">
                                    <div className="flex items-center gap-2.5">
                                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: TEAM_COLORS[team] || "#888" }}>{name[0]}</div>
                                      <span className="text-sm font-medium">{name}</span>
                                    </div>
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
                    })}
                  </div>
                </>
              ) : isAdmin ? <InlineUpload type="prod" onRecorded={loadData} userId={user.id} /> : <EmptyState icon="📊" text="No data yet" />}
            </>
          )}

          {/* ===== ATTENDANCE ===== */}
          {page === "attendance" && (
            <>
              <h1 className="text-xl font-semibold mb-1">Attendance</h1>
              <p className="text-sm text-gray-400 mb-5">Clock-in analysis and leave tracking</p>

              {attIndex.length > 0 ? (
                <>
                  <div className="flex gap-3 items-end flex-wrap mb-5">
                    {isAdmin && <SmallUpload type="att" onRecorded={loadData} userId={user.id} />}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-gray-400 uppercase tracking-wide">Month</label>
                      <select value={attMonth} onChange={e => setAttMonth(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                        {attIndex.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                      </select>
                    </div>
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
              ) : isAdmin ? <InlineUpload type="att" onRecorded={loadData} userId={user.id} /> : <EmptyState icon="📅" text="No data yet" />}
            </>
          )}

          {/* ===== WEEKLY KPI ===== */}
          {page === "kpi" && (
            <>
              <h1 className="text-xl font-semibold mb-1">Weekly KPI</h1>
              <p className="text-sm text-gray-400 mb-5">Team performance by week</p>

              {kpiData ? (() => {
                // Build month and week lists from data
                const monthsSet = new Set();
                const weeksMap = {};
                kpiData.entries.forEach(e => {
                  if (e.month) monthsSet.add(e.month);
                  const mKey = e.month || "";
                  if (!weeksMap[mKey]) weeksMap[mKey] = new Set();
                  if (e.week) weeksMap[mKey].add(e.week);
                });
                const months = Array.from(monthsSet);
                const selMonth = kpiPeriod.split("|")[0] || months[months.length - 1] || "";
                const weeksForMonth = Array.from(weeksMap[selMonth] || []).sort((a,b) => parseFloat(a) - parseFloat(b));
                const selWeek = kpiPeriod.split("|")[1] || weeksForMonth[weeksForMonth.length - 1] || "";
                
                // Filter entries for selected month + week
                const filtered = kpiData.entries.filter(e => e.month === selMonth && String(e.week) === String(selWeek));
                const byTeam = {};
                filtered.forEach(e => {
                  const t = e.team || "Other";
                  if (!byTeam[t]) byTeam[t] = [];
                  byTeam[t].push(e);
                });

                return (
                  <>
                    <div className="flex gap-3 items-end flex-wrap mb-6">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-gray-400 uppercase tracking-wide">Month</label>
                        <select value={selMonth} onChange={e => { const w = Array.from(weeksMap[e.target.value] || []); setKpiPeriod(e.target.value + "|" + (w[w.length-1] || "")); }} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                          {months.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-gray-400 uppercase tracking-wide">Week</label>
                        <select value={selWeek} onChange={e => setKpiPeriod(selMonth + "|" + e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                          {weeksForMonth.map(w => <option key={w} value={w}>W{w}</option>)}
                        </select>
                      </div>
                      {isAdmin && <SmallUpload type="kpi" onRecorded={loadData} userId={user.id} />}
                    </div>

                    {filtered.length > 0 ? (
                      <div className="space-y-6">
                        {TEAMS.filter(t => byTeam[t]).map(team => (
                          <div key={team}>
                            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                              <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"} flex items-center justify-center text-sm`}>{TEAM_ICONS[team] || "📋"}</div>
                              <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{team}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {byTeam[team].map((e, i) => {
                                const pct = e.kpiPct !== null ? Math.round(e.kpiPct * 100) : null;
                                const isGood = pct !== null && pct >= 95;
                                const isBad = pct !== null && pct < 85;
                                const color = isGood ? "#16a34a" : isBad ? "#dc2626" : "#d97706";
                                return (
                                  <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 hover:shadow-sm transition-all">
                                    <div className="flex justify-between items-center mb-3">
                                      <div className="flex items-center gap-2.5">
                                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: TEAM_COLORS[team] || "#888" }}>{e.employee?.[0]}</div>
                                        <div>
                                          <p className="text-sm font-semibold">{e.employee}</p>
                                          <p className="text-[11px] text-gray-400">{e.kpiType}</p>
                                        </div>
                                      </div>
                                      {pct !== null && <p className="text-2xl font-bold" style={{ color }}>{pct}%</p>}
                                    </div>
                                    {pct !== null && (
                                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
                                        <div className="h-full rounded-full" style={{ width: Math.min(pct, 100) + "%", background: color }} />
                                      </div>
                                    )}
                                    <div className="flex justify-between text-[11px] text-gray-400">
                                      <span>Target: {e.target}</span>
                                      <span>Actual: {e.actual || "..."}</span>
                                    </div>
                                    {e.status && <div className={`mt-2 text-[11px] font-medium px-2 py-0.5 rounded inline-block ${isGood ? "bg-green-50 text-green-600" : isBad ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>{e.status.replace(/[🟢🟡🔴]/g, "").trim()}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-sm text-gray-400 text-center py-8">No data for {selMonth} W{selWeek}</p>}
                  </>
                );
              })() : isAdmin ? <InlineUpload type="kpi" onRecorded={loadData} userId={user.id} /> : <EmptyState icon="📋" text="No KPI data yet" />}

              {isAdmin && <PasteArea onRecorded={loadData} userId={user.id} />}
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
    reader.onload = async (evt) => {
      try { const result = await parseProductivity(evt.target.result, file.name); setPendingProd(result); setProdStatus({ ok: true, msg: `${result.dates.length} days from ${file.name}` }); }
      catch (err) { setProdStatus({ ok: false, msg: err.message }); }
    }; reader.readAsArrayBuffer(file);
  }

  function handleAttFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try { const result = await parseAttendanceAuto(evt.target.result, file.name); setPendingAtt(result); setAttStatus({ ok: true, msg: `${result.count} records (${result.monthLabel})` }); }
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
              <div className="text-xs text-gray-400 mt-1">Excel, CSV, PDF, ODS</div>
            </div>
            <input type="file" accept=".xlsx,.xls,.csv,.tsv,.ods,.pdf" onChange={handleProdFile} className="hidden" />
          </label>
          {pendingProd && <button onClick={recordProd} disabled={recording} className="mt-2 w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl disabled:opacity-50">Record</button>}
        </div>
        <div>
          <label className="block cursor-pointer">
            <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${attStatus?.ok ? "border-green-400 bg-green-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}>
              <div className={`text-xl mb-1 ${attStatus?.ok ? "text-green-500" : "text-gray-300"}`}>{attStatus?.ok ? "✓" : "📅"}</div>
              <div className={`text-sm font-medium ${attStatus?.ok ? "text-green-600" : "text-gray-500"}`}>{attStatus?.msg || "Upload attendance file"}</div>
              <div className="text-xs text-gray-400 mt-1">Excel, CSV, PDF, ODS</div>
            </div>
            <input type="file" accept=".xlsx,.xls,.csv,.tsv,.ods,.pdf" onChange={handleAttFile} className="hidden" />
          </label>
          {pendingAtt && <button onClick={recordAtt} disabled={recording} className="mt-2 w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl disabled:opacity-50">Record</button>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
<button onClick={() => clearData("prod")} className="px-4 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50">Clear productivity</button>
        <button onClick={() => clearData("att")} className="px-4 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50">Clear attendance</button>
      </div>
    </>
  );
}

// Pending approvals banner
function PendingBanner({ onGoToAdmin }) {
  const [pending, setPending] = useState([]);
  useEffect(() => {
    supabase.from("profiles").select("email").eq("role", "pending").then(({ data }) => {
      if (data) setPending(data);
    });
  }, []);
  if (!pending.length) return null;
  return (
    <div onClick={onGoToAdmin} className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100 transition-all">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">👤</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">{pending.length} pending approval{pending.length > 1 ? "s" : ""}</p>
            <p className="text-xs text-amber-600">{pending.map(p => p.email).join(", ")}</p>
          </div>
        </div>
        <span className="text-xs text-amber-500 font-medium">Go to Admin &rarr;</span>
      </div>
    </div>
  );
}

// Inline upload for empty states
function InlineUpload({ type, onRecorded, userId }) {
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null);
  const [recording, setRecording] = useState(false);

  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        if (type === "prod") {
          const result = await parseProductivity(evt.target.result, file.name);
          setPending(result); setStatus({ ok: true, msg: result.dates.length + " days from " + file.name });
        } else if (type === "kpi") {
          const result = parseWeeklyKPI(evt.target.result, file.name);
          setPending(result); setStatus({ ok: true, msg: result.count + " entries from " + file.name });
        } else {
          const result = await parseAttendanceAuto(evt.target.result, file.name);
          setPending(result); setStatus({ ok: true, msg: result.count + " records (" + result.monthLabel + ")" });
        }
      } catch (err) { setStatus({ ok: false, msg: err.message }); }
    }; reader.readAsArrayBuffer(file);
  }

  async function record() {
    if (!pending) return; setRecording(true);
    if (type === "prod") {
      await supabase.from("productivity_records").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("productivity_records").insert({ data: pending.data, dates: pending.dates, members: pending.members, uploaded_by: userId });
    } else if (type === "kpi") {
      await supabase.from("weekly_kpi").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("weekly_kpi").insert({ data: { entries: pending.entries }, uploaded_by: userId });
    } else {
      await supabase.from("attendance_records").upsert({ month_key: pending.monthKey, month_label: pending.monthLabel, data: pending.data, uploaded_by: userId }, { onConflict: "month_key" });
    }
    setPending(null); setRecording(false); onRecorded();
  }

  return (
    <div className="text-center py-12">
      <div className="text-4xl mb-3">{type === "prod" ? "📊" : "📅"}</div>
      <p className="text-gray-400 mb-4">No {type === "prod" ? "productivity" : type === "kpi" ? "weekly KPI" : "attendance"} data yet</p>
      <label className="inline-block cursor-pointer">
        <div className={`px-6 py-3 rounded-xl text-sm font-medium transition-all ${status?.ok ? "bg-green-50 text-green-600 border border-green-200" : "bg-gray-900 text-white hover:bg-gray-800"}`}>
          {status?.ok ? "✓ " + status.msg : "Upload " + (type === "prod" ? "productivity" : type === "kpi" ? "weekly KPI" : "attendance") + " file"}
        </div>
        <input type="file" accept=".xlsx,.xls,.csv,.tsv,.ods,.pdf" onChange={handleFile} className="hidden" />
      </label>
      {status?.ok === false && <p className="text-xs text-red-500 mt-2">{status.msg}</p>}
      {pending && <button onClick={record} disabled={recording} className="mt-3 px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl disabled:opacity-50 block mx-auto">{recording ? "Recording..." : "Record"}</button>}
    </div>
  );
}

// Small upload button for when data already exists
function SmallUpload({ type, onRecorded, userId }) {
  const [pending, setPending] = useState(null);
  const [recording, setRecording] = useState(false);

  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        if (type === "prod") {
          const result = await parseProductivity(evt.target.result, file.name);
          setPending(result);
        } else if (type === "kpi") {
          const result = parseWeeklyKPI(evt.target.result, file.name);
          setPending(result);
        } else {
          const result = await parseAttendanceAuto(evt.target.result, file.name);
          setPending(result);
        }
      } catch (err) { alert("Error: " + err.message); }
    }; reader.readAsArrayBuffer(file);
  }

  async function record() {
    if (!pending) return; setRecording(true);
    if (type === "prod") {
      await supabase.from("productivity_records").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("productivity_records").insert({ data: pending.data, dates: pending.dates, members: pending.members, uploaded_by: userId });
    } else if (type === "kpi") {
      await supabase.from("weekly_kpi").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("weekly_kpi").insert({ data: { entries: pending.entries }, uploaded_by: userId });
    } else {
      await supabase.from("attendance_records").upsert({ month_key: pending.monthKey, month_label: pending.monthLabel, data: pending.data, uploaded_by: userId }, { onConflict: "month_key" });
    }
    setPending(null); setRecording(false); onRecorded();
  }

  return (
    <div className="flex items-center gap-2 ml-auto">
      {pending ? (
        <button onClick={record} disabled={recording} className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg disabled:opacity-50">
          {recording ? "..." : "Record"}
        </button>
      ) : null}
      <label className="cursor-pointer">
        <div className="px-3 py-1.5 bg-gray-100 text-gray-500 text-xs font-medium rounded-lg hover:bg-gray-200 transition-all">
          {pending ? "✓ Ready" : "Upload"}
        </div>
        <input type="file" accept=".xlsx,.xls,.csv,.tsv,.ods,.pdf" onChange={handleFile} className="hidden" />
      </label>
    </div>
  );
}

// Paste data area for quick entry
function PasteArea({ onRecorded, userId }) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  async function handleRecord() {
    if (!text.trim()) return;
    setRecording(true); setMsg("");
    try {
      const entries = parsePastedCSV(text);
      // Store as a simple weekly KPI update
      const grouped = {};
      const period = "Pasted " + new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      grouped[period] = { month: "", week: "", teams: {} };
      entries.forEach(e => {
        const team = e.team || "Other";
        if (!grouped[period].teams[team]) grouped[period].teams[team] = [];
        grouped[period].teams[team].push({
          employee: e.employee, team, kpiType: "", target: e.target,
          actual: e.completed || e.produced || "", kpiPct: parseFloat(e.progress) || null,
          notes: "", status: parseFloat(e.progress) >= 0.9 ? "On Target" : parseFloat(e.progress) >= 0.7 ? "Slightly Behind" : "Behind",
        });
      });
      await supabase.from("weekly_kpi").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("weekly_kpi").insert({ data: { entries, grouped, periods: Object.keys(grouped) }, uploaded_by: userId });
      setText(""); setMsg("Recorded " + entries.length + " entries");
      onRecorded();
    } catch (err) { setMsg("Error: " + err.message); }
    setRecording(false);
  }

  return (
    <div className="mt-8 border-t border-gray-100 pt-6">
      <button onClick={() => setOpen(!open)} className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-3">
        {open ? "▾" : "▸"} Quick data entry (paste CSV)
      </button>
      {open && (
        <>
          <p className="text-xs text-gray-400 mb-2">Paste CSV or tab-separated data. First row should be headers (Team, Name, Target, Completed, Progress).</p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6} placeholder={"Team,Name,Total Target/ Task,Estimated Time,Time Produced,Completed,Progress\nContent,Jeremiah,2 videos,—,—,2 videos,0.7\nVideo,Nic,6 videos/shoots,—,—,5 videos,0.9"}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-mono bg-gray-50 focus:outline-none focus:border-gray-400 resize-y" />
          <div className="flex items-center gap-3 mt-2">
            <button onClick={handleRecord} disabled={recording || !text.trim()}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {recording ? "Recording..." : "Record"}
            </button>
            {msg && <span className={`text-xs ${msg.startsWith("Error") ? "text-red-500" : "text-green-500"}`}>{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ icon, text }) {
  return <div className="text-center py-16 text-gray-300"><div className="text-4xl mb-3">{icon}</div><p className="text-gray-400">{text}</p></div>;
}
