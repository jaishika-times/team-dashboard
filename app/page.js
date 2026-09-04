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
  const [employees, setEmployees] = useState([]);
  const [selCompany, setSelCompany] = useState(null);
  const [selDept, setSelDept] = useState(null);
  const [empModal, setEmpModal] = useState(null);
  const [empForm, setEmpForm] = useState({ name: "", company: "", department: "" });
  const [kpiData, setKpiData] = useState(null);
  const [kpiPeriod, setKpiPeriod] = useState("");

  // Live productivity (synced from Google Sheets)
  const [liveProdDate, setLiveProdDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [liveProdTasks, setLiveProdTasks] = useState([]);
  const [liveProdLoading, setLiveProdLoading] = useState(true);
  const [selectedProdEmployee, setSelectedProdEmployee] = useState(null);

  useEffect(() => { init(); }, []);

  useEffect(() => {
    let cancelled = false;
    setLiveProdLoading(true);
    supabase
      .from("daily_productivity_tasks")
      .select("*")
      .eq("task_date", liveProdDate)
      .order("employee_name", { ascending: true })
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) {
          setLiveProdTasks(data || []);
          setLiveProdLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [liveProdDate]);

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
    const { data: empRows } = await supabase.from("employees").select("*").order("name");
    if (empRows) setEmployees(empRows);
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
          {page === "overview" && (() => {
            const COMP_COLORS = {"Xcalibur Digital":"#6366f1","Times Media":"#3b82f6","Edunexa AI Sdn Bhd":"#10b981"};
            const COMP_ICONS = {"Xcalibur Digital":"⚡","Times Media":"📰","Edunexa AI Sdn Bhd":"🎓"};
            const DEPT_ICONS_MAP = {"Design":"🎨","Video":"🎬","Content":"✍️","Social Media":"📱","Sales":"💼","Operations":"⚙️","Account Manager":"🤝","SEO and Website":"🔍","Knowledge Base and Product":"📚"};
            const companies = [...new Set(employees.map(e => e.company))];
            const deptsByCompany = {};
            employees.forEach(e => {
              if (!deptsByCompany[e.company]) deptsByCompany[e.company] = {};
              if (!deptsByCompany[e.company][e.department]) deptsByCompany[e.company][e.department] = [];
              deptsByCompany[e.company][e.department].push(e);
            });

            async function saveEmployee() {
              if (!empForm.name || !empForm.company || !empForm.department) return;
              if (empModal === "add") {
                await supabase.from("employees").insert({ name: empForm.name, company: empForm.company, department: empForm.department });
              } else {
                await supabase.from("employees").update({ name: empForm.name, company: empForm.company, department: empForm.department }).eq("id", empModal);
              }
              setEmpModal(null); setEmpForm({ name: "", company: "", department: "" });
              const { data } = await supabase.from("employees").select("*").order("name");
              if (data) setEmployees(data);
            }

            async function deleteEmployee(id) {
              if (!confirm("Remove this employee?")) return;
              await supabase.from("employees").delete().eq("id", id);
              const { data } = await supabase.from("employees").select("*").order("name");
              if (data) setEmployees(data);
            }

            return (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-xl font-semibold">Overview</h1>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button onClick={() => { setEmpModal("add"); setEmpForm({ name: "", company: companies[0] || "", department: "" }); }}
                        className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800">+ Add</button>
                      <button onClick={() => setEmpModal("edit-pick")}
                        className="px-3 py-1.5 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50">Edit</button>
                      <button onClick={() => setEmpModal("remove-pick")}
                        className="px-3 py-1.5 bg-white text-red-500 text-xs font-medium rounded-lg border border-red-200 hover:bg-red-50">Remove</button>
                    </div>
                  )}
                </div>
                {isAdmin && <PendingBanner onGoToAdmin={() => setPage("admin")} />}

                {/* Breadcrumb */}
                {(selCompany || selDept) && (
                  <div className="flex items-center gap-2 text-sm mb-5">
                    <button onClick={() => { setSelCompany(null); setSelDept(null); }} className="text-gray-400 hover:text-gray-600">All Companies</button>
                    {selCompany && <><span className="text-gray-300">/</span><button onClick={() => setSelDept(null)} className={selDept ? "text-gray-400 hover:text-gray-600" : "text-gray-900 font-medium"}>{selCompany}</button></>}
                    {selDept && <><span className="text-gray-300">/</span><span className="text-gray-900 font-medium">{selDept}</span></>}
                  </div>
                )}

                {/* Level 1: Company cards */}
                {!selCompany && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {companies.map(company => {
                      const depts = Object.keys(deptsByCompany[company] || {});
                      const count = employees.filter(e => e.company === company).length;
                      return (
                        <div key={company} onClick={() => setSelCompany(company)}
                          className="group rounded-2xl overflow-hidden border border-gray-100 cursor-pointer hover:shadow-lg hover:-translate-y-1 transition-all bg-white">
                          <div className="h-2" style={{ background: COMP_COLORS[company] || "#888" }} />
                          <div className="p-6">
                            <div className="flex items-center gap-4 mb-4">
                              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform" style={{ background: (COMP_COLORS[company] || "#888") + "15" }}>
                                {COMP_ICONS[company] || "🏢"}
                              </div>
                              <div>
                                <p className="text-base font-bold">{company}</p>
                                <p className="text-xs text-gray-400">{count} employees, {depts.length} departments</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pt-3 border-t border-gray-100">
                              {depts.map(d => (
                                <span key={d} className="text-[11px] px-2 py-1 bg-gray-50 text-gray-500 rounded-lg">{d}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Level 2: Department cards */}
                {selCompany && !selDept && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {Object.entries(deptsByCompany[selCompany] || {}).map(([dept, members]) => (
                        <div key={dept} onClick={() => setSelDept(dept)}
                          className="rounded-xl border border-gray-100 p-5 cursor-pointer hover:shadow-sm hover:border-gray-200 transition-all bg-white">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: (COMP_COLORS[selCompany] || "#888") + "15" }}>
                              {DEPT_ICONS_MAP[dept] || "📋"}
                            </div>
                            <div>
                              <p className="text-sm font-bold">{dept}</p>
                              <p className="text-xs text-gray-400">{members.length} member{members.length !== 1 ? "s" : ""}</p>
                            </div>
                          </div>
                          <div className="flex -space-x-2 pt-2">
                            {members.slice(0, 6).map((m, i) => (
                              <div key={i} className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-white" style={{ background: COMP_COLORS[selCompany] || "#888" }}>{m.name[0]}</div>
                            ))}
                            {members.length > 6 && <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold bg-gray-100 text-gray-500 border-2 border-white">+{members.length - 6}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Level 3: Employee list */}
                {selCompany && selDept && (
                  <>
                    {isAdmin && (
                      <button onClick={() => { setEmpModal("add"); setEmpForm({ name: "", company: selCompany, department: selDept }); }}
                        className="mb-4 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                        + Add employee
                      </button>
                    )}
                    <div className="space-y-2">
                      {(deptsByCompany[selCompany]?.[selDept] || []).map(emp => (
                        <div key={emp.id} className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-100 hover:border-gray-200 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: COMP_COLORS[selCompany] || "#888" }}>{emp.name[0]}</div>
                            <div>
                              <p className="text-sm font-semibold">{emp.name}</p>
                              <p className="text-xs text-gray-400">{emp.department}</p>
                            </div>
                          </div>
                          {isAdmin && (
                            <div className="flex items-center gap-2">
                              <button onClick={() => { setEmpModal(emp.id); setEmpForm({ name: emp.name, company: emp.company, department: emp.department }); }}
                                className="text-xs text-blue-500 hover:text-blue-700">Edit</button>
                              <button onClick={() => deleteEmployee(emp.id)}
                                className="text-xs text-red-400 hover:text-red-600">Remove</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {employees.length === 0 && (
                  <div className="text-center py-16 text-gray-300">
                    <p className="text-4xl mb-3">👥</p>
                    <p className="text-gray-400">No employees added yet</p>
                  </div>
                )}

                {/* Add/Edit/Remove Modal */}
                {empModal && (
                  <div onClick={() => setEmpModal(null)} className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl p-6 w-[460px] max-w-[92%] max-h-[80vh] overflow-y-auto shadow-xl">

                      {/* ADD form */}
                      {empModal === "add" && (
                        <>
                          <h3 className="text-base font-semibold mb-4">Add employee</h3>
                          <div className="space-y-3">
                            <input value={empForm.name} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} placeholder="Full name" autoFocus
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            <select value={empForm.company} onChange={e => setEmpForm({ ...empForm, company: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                              <option value="">Select company</option>
                              {companies.map(c => <option key={c} value={c}>{c}</option>)}
                              <option value="__new">+ New company</option>
                            </select>
                            {empForm.company === "__new" && (
                              <input onChange={e => setEmpForm({ ...empForm, company: e.target.value })} placeholder="New company name"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            )}
                            <input value={empForm.department} onChange={e => setEmpForm({ ...empForm, department: e.target.value })} placeholder="Department"
                              list="dept-list" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            <datalist id="dept-list">
                              {[...new Set(employees.map(e => e.department))].map(d => <option key={d} value={d} />)}
                            </datalist>
                          </div>
                          <div className="flex gap-2 mt-4">
                            <button onClick={saveEmployee} className="flex-1 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg">Add</button>
                            <button onClick={() => setEmpModal(null)} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg">Cancel</button>
                          </div>
                        </>
                      )}

                      {/* EDIT: pick employee first */}
                      {empModal === "edit-pick" && (
                        <>
                          <h3 className="text-base font-semibold mb-4">Select employee to edit</h3>
                          <input id="emp-search" placeholder="Search by name..." onChange={e => document.querySelectorAll("[data-emp-row]").forEach(el => { el.style.display = el.dataset.empRow.toLowerCase().includes(e.target.value.toLowerCase()) ? "" : "none"; })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-3" />
                          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                            {employees.map(emp => (
                              <div key={emp.id} data-emp-row={emp.name}
                                onClick={() => { setEmpModal(emp.id); setEmpForm({ name: emp.name, company: emp.company, department: emp.department }); }}
                                className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-50 text-sm">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: COMP_COLORS[emp.company] || "#888" }}>{emp.name[0]}</div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{emp.name}</p>
                                  <p className="text-[11px] text-gray-400">{emp.company} / {emp.department}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {/* EDIT form (after picking) */}
                      {empModal && empModal !== "add" && empModal !== "edit-pick" && empModal !== "remove-pick" && (
                        <>
                          <h3 className="text-base font-semibold mb-4">Edit employee</h3>
                          <div className="space-y-3">
                            <input value={empForm.name} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} placeholder="Full name"
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            <select value={empForm.company} onChange={e => setEmpForm({ ...empForm, company: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                              {companies.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <input value={empForm.department} onChange={e => setEmpForm({ ...empForm, department: e.target.value })} placeholder="Department"
                              list="dept-list2" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            <datalist id="dept-list2">
                              {[...new Set(employees.map(e => e.department))].map(d => <option key={d} value={d} />)}
                            </datalist>
                          </div>
                          <div className="flex gap-2 mt-4">
                            <button onClick={saveEmployee} className="flex-1 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg">Save</button>
                            <button onClick={() => setEmpModal(null)} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg">Cancel</button>
                          </div>
                        </>
                      )}

                      {/* REMOVE: pick employee */}
                      {empModal === "remove-pick" && (
                        <>
                          <h3 className="text-base font-semibold mb-4">Select employee to remove</h3>
                          <input placeholder="Search by name..." onChange={e => document.querySelectorAll("[data-rem-row]").forEach(el => { el.style.display = el.dataset.remRow.toLowerCase().includes(e.target.value.toLowerCase()) ? "" : "none"; })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-3" />
                          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                            {employees.map(emp => (
                              <div key={emp.id} data-rem-row={emp.name}
                                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-red-50 text-sm">
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: COMP_COLORS[emp.company] || "#888" }}>{emp.name[0]}</div>
                                  <div>
                                    <p className="font-medium">{emp.name}</p>
                                    <p className="text-[11px] text-gray-400">{emp.company} / {emp.department}</p>
                                  </div>
                                </div>
                                <button onClick={() => deleteEmployee(emp.id)} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-100">Remove</button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {/* ===== PRODUCTIVITY (live, synced from Google Sheets) ===== */}
          {page === "productivity" && (() => {
            const byTeam = {};
            liveProdTasks.forEach(t => {
              if (!byTeam[t.team]) byTeam[t.team] = {};
              if (!byTeam[t.team][t.employee_name]) byTeam[t.team][t.employee_name] = [];
              byTeam[t.team][t.employee_name].push(t);
            });
            const teamNames = Object.keys(byTeam).sort((a, b) => {
              const ai = TEAMS.indexOf(a), bi = TEAMS.indexOf(b);
              if (ai !== -1 && bi !== -1) return ai - bi;
              if (ai !== -1) return -1;
              if (bi !== -1) return 1;
              return a.localeCompare(b);
            });

            function empTotal(tasks) { return tasks.reduce((s, t) => s + (t.hours_spent || 0), 0); }
            function empStatus(tasks) {
              if (tasks.every(t => t.entry_status === "leave")) return tasks[0]?.leave_label || "On leave";
              if (tasks.every(t => t.entry_status === "no_tasks")) return "No tasks today";
              return empTotal(tasks).toFixed(2) + " hrs";
            }

            const selEmpTasks = selectedProdEmployee ? liveProdTasks.filter(t => t.employee_name === selectedProdEmployee) : [];

            return (
              <>
                <h1 className="text-xl font-semibold mb-1">Productivity</h1>
                <p className="text-sm text-gray-400 mb-5">Daily tasks, synced live from the team's Google Sheet</p>

                <div className="flex gap-3 items-end flex-wrap mb-5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-gray-400 uppercase tracking-wide">Date</label>
                    <input type="date" value={liveProdDate} onChange={e => setLiveProdDate(e.target.value)}
                      className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" />
                  </div>
                </div>

                {liveProdLoading ? (
                  <p className="text-sm text-gray-400 text-center py-12">Loading...</p>
                ) : teamNames.length === 0 ? (
                  <div className="text-center py-16 text-gray-300">
                    <div className="text-4xl mb-3">📊</div>
                    <p className="text-gray-400">No submissions synced for this date yet</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {teamNames.map(team => {
                      const employeesInTeam = Object.entries(byTeam[team]);
                      return (
                        <div key={team} className="rounded-xl overflow-hidden border border-gray-100 bg-white">
                          <div className={`h-1 bg-gradient-to-r ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"}`} />
                          <div className="p-4">
                            <div className="flex items-center gap-2.5 mb-3">
                              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"} flex items-center justify-center text-base`}>{TEAM_ICONS[team] || "📋"}</div>
                              <p className="text-sm font-bold">{team} Team</p>
                            </div>
                            <div className="space-y-1.5">
                              {employeesInTeam.map(([name, tasks]) => {
                                const isLeave = tasks.every(t => t.entry_status === "leave");
                                const isEmpty = tasks.every(t => t.entry_status === "no_tasks");
                                return (
                                  <button key={name} onClick={() => setSelectedProdEmployee(name)}
                                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 transition-all text-left">
                                    <span className="text-sm font-medium">{name}</span>
                                    <span className={`text-xs font-medium ${isLeave ? "text-amber-500" : isEmpty ? "text-gray-300" : "text-emerald-600"}`}>{empStatus(tasks)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedProdEmployee && (
                  <div onClick={() => setSelectedProdEmployee(null)} className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl p-6 w-[520px] max-w-[92%] max-h-[80vh] overflow-y-auto shadow-xl">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-base font-semibold">{selectedProdEmployee}</h3>
                        <button onClick={() => setSelectedProdEmployee(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
                      </div>
                      {selEmpTasks.every(t => t.entry_status === "leave") ? (
                        <p className="text-amber-600 font-medium text-sm">{selEmpTasks[0]?.leave_label || "On leave"}</p>
                      ) : selEmpTasks.every(t => t.entry_status === "no_tasks") ? (
