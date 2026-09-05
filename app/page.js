"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { parseProductivity, parseAttendanceAuto, parseWeeklyKPI, parsePastedCSV, parsePeopleLifecycle } from "@/lib/parser";

const TEAMS = ["Design","Video","Content","Social","CSE","Sales","Knowledge","Finance"];
function normMonth(m) {
  const s = String(m || "").trim().toLowerCase();
  const map = {january:"Jan",february:"Feb",march:"Mar",april:"Apr",may:"May",june:"Jun",july:"Jul",august:"Aug",september:"Sep",sept:"Sep",october:"Oct",november:"Nov",december:"Dec",jan:"Jan",feb:"Feb",mar:"Mar",apr:"Apr",jun:"Jun",jul:"Jul",aug:"Aug",sep:"Sep",oct:"Oct",nov:"Nov",dec:"Dec"};
  return map[s] || m;
}
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
  const [assets, setAssets] = useState([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetModal, setAssetModal] = useState(null);
  const [assetForm, setAssetForm] = useState({ code: "", name: "", category: "Video Properties", status: "Available", remark: "" });
  const [selCompany, setSelCompany] = useState(null);
  const [selDept, setSelDept] = useState(null);
  const [empModal, setEmpModal] = useState(null);
  const [empForm, setEmpForm] = useState({ name: "", company: "", department: "" });
  const [kpiData, setKpiData] = useState(null);
  const [kpiPeriod, setKpiPeriod] = useState("");
  const [selectedProdTeam, setSelectedProdTeam] = useState(null);

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
    // Fetch live from Google Sheet
    try {
      const liveRes = await fetch("/api/live-prod");
      const liveData = await liveRes.json();
      if (liveData.dates?.length) { setProdData(liveData); setDate(liveData.dates[0]); }
    } catch (e) { console.log("Sheet fetch error"); }
    const { data: empRows } = await supabase.from("employees").select("*").order("name");
    const { data: assetRows } = await supabase.from("assets").select("*").order("code");
    if (assetRows) setAssets(assetRows);
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
    { id: "assets", icon: "◫", label: "Assets" },
    { id: "people", icon: "◐", label: "People" },
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
            const COMP_ICONS = {"Xcalibur Digital":"XD","Times Media":"TM","Edunexa AI Sdn Bhd":"EN"};
const COMP_LOGOS = {
  "Xcalibur Digital": () => <svg viewBox="0 0 40 40" width="40" height="40"><rect width="40" height="40" rx="10" fill="#6366f1"/><path d="M10 12L20 28L30 12" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 28h14" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/><circle cx="20" cy="10" r="2" fill="#a5b4fc"/></svg>,
  "Times Media": () => <svg viewBox="0 0 40 40" width="40" height="40"><rect width="40" height="40" rx="10" fill="#3b82f6"/><rect x="9" y="10" width="22" height="3" rx="1.5" fill="#fff"/><rect x="9" y="16" width="22" height="2" rx="1" fill="#93c5fd" opacity="0.7"/><rect x="9" y="20" width="22" height="2" rx="1" fill="#93c5fd" opacity="0.7"/><rect x="9" y="24" width="14" height="2" rx="1" fill="#93c5fd" opacity="0.7"/><rect x="9" y="28" width="22" height="2" rx="1" fill="#93c5fd" opacity="0.5"/></svg>,
  "Edunexa AI Sdn Bhd": () => <svg viewBox="0 0 40 40" width="40" height="40"><rect width="40" height="40" rx="10" fill="#10b981"/><path d="M12 26l8-14 8 14" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/><circle cx="20" cy="15" r="3" fill="#fff" opacity="0.3"/><path d="M16 22h8" stroke="#fff" strokeWidth="2" strokeLinecap="round"/><circle cx="20" cy="10" r="1.5" fill="#6ee7b7"/></svg>,
};
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
                              <div className="group-hover:scale-110 transition-transform">
                                {COMP_LOGOS[company] ? COMP_LOGOS[company]() : <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl" style={{ background: (COMP_COLORS[company] || "#888") + "15" }}>🏢</div>}
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
            const dayData = prodData?.data?.[date] || {};
            const allMems = prodData?.members || [];
            const teamsSet = new Set(); allMems.forEach(m => teamsSet.add(m.team));

            return (
              <>
                <h1 className="text-xl font-semibold mb-1">Productivity</h1>
                <p className="text-sm text-gray-400 mb-5">Daily tasks, live from Google Sheet</p>

                {prodData ? (
                  <>
                    <div className="flex gap-3 items-end flex-wrap mb-5">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-gray-400 uppercase tracking-wide">Date</label>
                        <select value={date} onChange={e => setDate(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                          {prodData.dates.map(d => { const dt = new Date(d + "T00:00:00"); return <option key={d} value={d}>{dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</option>; })}
                        </select>
                      </div>
                    </div>

                    {/* Team cards */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                      {TEAMS.filter(t => allMems.some(m => m.team === t)).map(team => {
                        const members = allMems.filter(m => m.team === team);
                        const th = members.reduce((s, m) => s + (dayData[m.name]?.hours || 0), 0);
                        const taskCount = members.reduce((s, m) => s + (dayData[m.name]?.tasks?.length || 0), 0);
                        const isSelected = selectedProdTeam === team;
                        return (
                          <div key={team} onClick={() => setSelectedProdTeam(isSelected ? null : team)}
                            className={`rounded-xl overflow-hidden border cursor-pointer transition-all hover:shadow-sm ${isSelected ? "border-gray-300 shadow-sm ring-2 ring-gray-200" : "border-gray-100"}`} style={{ background: "#fff" }}>
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

                    {/* Member details for selected team */}
                    {selectedProdTeam && (
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${TEAM_GRADIENTS[selectedProdTeam] || "from-gray-400 to-gray-500"} flex items-center justify-center text-sm`}>{TEAM_ICONS[selectedProdTeam] || "📋"}</div>
                          <span className="text-sm font-semibold">{selectedProdTeam} Team</span>
                          <button onClick={() => setSelectedProdTeam(null)} className="ml-2 text-xs text-gray-400 hover:text-gray-600">Close</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {allMems.filter(m => m.team === selectedProdTeam).map(({ name }) => {
                            const data = dayData[name];
                            return (
                              <div key={name} className="bg-white rounded-xl p-5 border border-gray-100">
                                <div className="flex justify-between items-center mb-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: TEAM_COLORS[selectedProdTeam] || "#888" }}>{name[0]}</div>
                                    <p className="text-base font-semibold">{name}</p>
                                  </div>
                                  {data?.leave ? <span className="text-xs text-amber-600 font-medium px-2 py-1 bg-amber-50 rounded-lg">{data.leave}</span>
                                    : data?.hours > 0 ? <span className="text-2xl font-bold text-blue-500">{data.hours.toFixed(1)}h</span> : null}
                                </div>
                                {data?.tasks?.length > 0 ? (
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-gray-400 border-b border-gray-100">
                                        <th className="py-1.5 text-[11px] uppercase tracking-wide">Task Name</th>
                                        <th className="py-1.5 text-[11px] uppercase tracking-wide">Description</th>
                                        <th className="py-1.5 text-right text-[11px] uppercase tracking-wide">Hours</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {data.tasks.map((t, i) => (
                                        <tr key={i} className="border-b border-gray-50 last:border-0">
                                          <td className="py-2 pr-2 font-medium text-gray-700">{t.project}</td>
                                          <td className="py-2 pr-2 text-gray-400">{t.desc}</td>
                                          <td className="py-2 text-right font-medium text-blue-500">{t.hrs > 0 ? t.hrs + "h" : ""}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="font-semibold border-t border-gray-200">
                                        <td className="py-2" colSpan={2}>Total</td>
                                        <td className="py-2 text-right text-blue-600">{data.hours.toFixed(1)}h</td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                ) : !data?.leave && <p className="text-sm text-gray-300 italic">No tasks logged</p>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : <EmptyState icon="📊" text="No form submissions yet. Data syncs live from Google Sheet." />}
              </>
            );
          })()}

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
          {page === "kpi" && (() => {
            const rawEntries = kpiData?.entries || [];
            // Normalize months at display time
            const entries = rawEntries.map(e => ({ ...e, month: normMonth(e.month) }));
            const monthsSet = new Set();
            const weeksPerMonth = {};
            entries.forEach(e => {
              if (e.month) { monthsSet.add(e.month); if (!weeksPerMonth[e.month]) weeksPerMonth[e.month] = new Set(); }
              if (e.month && e.week) weeksPerMonth[e.month].add(e.week);
            });
            const months = Array.from(monthsSet);
            const curMonth = kpiPeriod.split("|")[0] || months[months.length - 1] || "";
            const weeksForMonth = Array.from(weeksPerMonth[curMonth] || []).sort((a,b) => parseInt(a) - parseInt(b));
            const curWeek = kpiPeriod.split("|")[1] || weeksForMonth[weeksForMonth.length - 1] || "";

            const filtered = entries.filter(e => e.month === curMonth && String(e.week) === String(curWeek));
            const byTeam = {};
            filtered.forEach(e => { const t = e.team || "Other"; if (!byTeam[t]) byTeam[t] = []; byTeam[t].push(e); });
            const kpiTeams = ["Content", "Video", "Design"].filter(t => byTeam[t]);

            return (
              <>
                <h1 className="text-xl font-semibold mb-1">Weekly KPI</h1>
                <p className="text-sm text-gray-400 mb-5">Team performance by week</p>

                {entries.length > 0 ? (
                  <>
                    <div className="flex gap-3 items-end flex-wrap mb-5">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-gray-400 uppercase tracking-wide">Month</label>
                        <select value={curMonth} onChange={e => { const w = Array.from(weeksPerMonth[e.target.value] || []); setKpiPeriod(e.target.value + "|" + (w[w.length-1] || "")); }} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                          {months.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-gray-400 uppercase tracking-wide">Week</label>
                        <select value={curWeek} onChange={e => setKpiPeriod(curMonth + "|" + e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                          {weeksForMonth.map(w => <option key={w} value={w}>W{w}</option>)}
                        </select>
                      </div>
                      {isAdmin && <SmallUpload type="kpi" onRecorded={loadData} userId={user.id} />}
                    </div>

                    {/* Team cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      {kpiTeams.map(team => {
                        const members = byTeam[team];
                        const withPct = members.filter(m => m.kpiPct !== null && !isNaN(m.kpiPct));
                        const avgPct = withPct.length > 0 ? withPct.reduce((s, m) => s + m.kpiPct, 0) / withPct.length : 0;
                        const avgRound = Math.round(avgPct * 100);
                        const color = avgRound >= 90 ? "#16a34a" : avgRound < 70 ? "#dc2626" : "#d97706";
                        const isSelected = selectedTeam === team;
                        return (
                          <div key={team} onClick={() => setSelectedTeam(isSelected ? null : team)}
                            className={`rounded-xl overflow-hidden border cursor-pointer transition-all hover:shadow-sm ${isSelected ? "border-gray-300 shadow-sm ring-2 ring-gray-200" : "border-gray-100"}`} style={{ background: "#fff" }}>
                            <div className={`h-1 bg-gradient-to-r ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"}`} />
                            <div className="p-4">
                              <div className="flex items-center gap-2.5 mb-3">
                                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${TEAM_GRADIENTS[team] || "from-gray-400 to-gray-500"} flex items-center justify-center text-lg`}>{TEAM_ICONS[team] || "📋"}</div>
                                <div>
                                  <p className="text-sm font-bold">{team}</p>
                                  <p className="text-[11px] text-gray-400">{members.length} members</p>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                                <span className="text-2xl font-bold" style={{ color }}>{avgRound}%</span>
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${avgRound >= 90 ? "bg-green-50 text-green-600" : avgRound < 70 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
                                  {avgRound >= 90 ? "On Target" : avgRound < 70 ? "Behind" : "Slightly Behind"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Member details for selected team */}
                    {selectedTeam && byTeam[selectedTeam] && (
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${TEAM_GRADIENTS[selectedTeam] || "from-gray-400 to-gray-500"} flex items-center justify-center text-sm`}>{TEAM_ICONS[selectedTeam] || "📋"}</div>
                          <span className="text-sm font-semibold">{selectedTeam} Team - {curMonth} W{curWeek}</span>
                          <button onClick={() => setSelectedTeam(null)} className="ml-2 text-xs text-gray-400 hover:text-gray-600">Close</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {byTeam[selectedTeam].map((e, i) => {
                            const pct = e.kpiPct !== null ? Math.round(e.kpiPct * 100) : null;
                            const isGood = pct !== null && pct >= 90;
                            const isBad = pct !== null && pct < 70;
                            const clr = isGood ? "#16a34a" : isBad ? "#dc2626" : "#d97706";
                            return (
                              <div key={i} className="bg-white rounded-xl p-5 border border-gray-100">
                                <div className="flex justify-between items-center mb-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: TEAM_COLORS[selectedTeam] || "#888" }}>{e.employee?.[0]}</div>
                                    <p className="text-base font-semibold">{e.employee}</p>
                                  </div>
                                  {pct !== null && <p className="text-3xl font-bold" style={{ color: clr }}>{pct}%</p>}
                                </div>
                                {pct !== null && (
                                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
                                    <div className="h-full rounded-full" style={{ width: Math.min(pct, 100) + "%", background: clr }} />
                                  </div>
                                )}
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between py-1 border-b border-gray-50"><span className="text-gray-400">Target</span><span className="font-medium text-right max-w-[60%]">{e.target || "..."}</span></div>
                                  <div className="flex justify-between py-1 border-b border-gray-50"><span className="text-gray-400">Completed</span><span className="font-medium">{e.completed || "..."}</span></div>
                                  {e.notes && <div className="flex justify-between py-1 border-b border-gray-50"><span className="text-gray-400">Notes</span><span className="text-xs text-gray-500 text-right max-w-[60%]">{e.notes}</span></div>}
                                  {e.status && <div className="flex justify-between py-1 border-b border-gray-50"><span className="text-gray-400">Status</span><span className={`text-xs font-medium px-2 py-0.5 rounded ${isGood ? "bg-green-50 text-green-600" : isBad ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>{e.status}</span></div>}
                                  {e.links && (
                                    <div className="pt-1">
                                      <span className="text-gray-400 text-sm">Links</span>
                                      <div className="mt-1 space-y-1">
                                        {e.links.split("\n").filter(l => l.trim()).map((link, li) => {
                                          const isUrl = link.trim().startsWith("http");
                                          return isUrl ? (
                                            <a key={li} href={link.trim()} target="_blank" rel="noopener" className="block text-xs text-blue-500 hover:underline truncate">{link.trim()}</a>
                                          ) : (
                                            <p key={li} className="text-xs text-gray-500">{link.trim()}</p>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Progress Report Table */}
                    {kpiTeams.length > 0 && (
                      <div className="mt-6 bg-white rounded-xl border border-gray-100 overflow-hidden">
                        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                          <h3 className="text-sm font-semibold">Weekly Team KPI Progress Report - {curMonth} W{curWeek}</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Team</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Name</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Total Target / Task</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Completed</th>
                                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase">Progress</th>
                              </tr>
                            </thead>
                            <tbody>
                              {kpiTeams.map((team, ti) => 
                                byTeam[team].map((e, i) => {
                                  const pct = e.kpiPct !== null ? Math.round(e.kpiPct * 100) : null;
                                  const pctColor = pct >= 90 ? "text-green-600" : pct < 70 ? "text-red-500" : "text-amber-600";
                                  return (
                                    <tr key={team + i} className="border-b border-gray-50 hover:bg-gray-50">
                                      {i === 0 ? <td className="px-4 py-2.5 font-semibold align-top" rowSpan={byTeam[team].length}><span className="text-xs px-2 py-0.5 rounded text-white" style={{ background: TEAM_COLORS[team] || "#888" }}>{team}</span></td> : null}
                                      <td className="px-4 py-2.5 font-medium">{e.employee}</td>
                                      <td className="px-4 py-2.5 text-gray-500 max-w-[200px]">{e.target}</td>
                                      <td className="px-4 py-2.5 text-gray-500 max-w-[200px]">{e.completed}</td>
                                      <td className={`px-4 py-2.5 text-right font-bold ${pctColor}`}>{pct !== null ? pct + "%" : "..."}</td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {kpiTeams.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No data for {curMonth} W{curWeek}</p>}
                  </>
                ) : isAdmin ? <InlineUpload type="kpi" onRecorded={loadData} userId={user.id} /> : <EmptyState icon="📋" text="No KPI data yet" />}

                {isAdmin && <PasteArea onRecorded={loadData} userId={user.id} />}
              </>
            );
          })()}

          {/* ===== ASSETS ===== */}
          {page === "assets" && (() => {
            const filtered = assets.filter(a =>
              assetSearch ? (a.code + " " + a.name + " " + a.remark).toLowerCase().includes(assetSearch.toLowerCase()) : true
            );
            const available = assets.filter(a => a.status === "Available").length;
            const cantUse = assets.filter(a => a.status === "Cannot Use").length;

            async function saveAsset() {
              if (!assetForm.code || !assetForm.name) return;
              if (assetModal === "add") {
                await supabase.from("assets").insert(assetForm);
              } else {
                await supabase.from("assets").update(assetForm).eq("id", assetModal);
              }
              setAssetModal(null);
              const { data } = await supabase.from("assets").select("*").order("code");
              if (data) setAssets(data);
            }

            async function deleteAsset(id) {
              if (!confirm("Delete this asset?")) return;
              await supabase.from("assets").delete().eq("id", id);
              const { data } = await supabase.from("assets").select("*").order("code");
              if (data) setAssets(data);
            }

            async function toggleStatus(id, current) {
              const next = current === "Available" ? "Cannot Use" : current === "Cannot Use" ? "In Use" : "Available";
              await supabase.from("assets").update({ status: next }).eq("id", id);
              const { data } = await supabase.from("assets").select("*").order("code");
              if (data) setAssets(data);
            }

            return (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h1 className="text-xl font-semibold">Assets</h1>
                    <p className="text-sm text-gray-400">Equipment inventory</p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button onClick={() => { setAssetModal("add"); setAssetForm({ code: "", name: "", category: "Video Properties", status: "Available", remark: "", held_by: "", date_taken: "", date_returned: "", notes: "" }); }}
                        className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg">+ Add item</button>
                      <button onClick={() => setAssetModal("stockcheck")}
                        className="px-3 py-1.5 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50">Friday Stock Check</button>
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3 mb-5">
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 text-center">
                    <p className="text-2xl font-bold">{assets.length}</p>
                    <p className="text-[11px] text-gray-400">Total items</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100 text-center">
                    <p className="text-2xl font-bold text-green-600">{available}</p>
                    <p className="text-[11px] text-gray-400">Available</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 text-center">
                    <p className="text-2xl font-bold text-blue-600">{assets.filter(a => a.status === "In Use").length}</p>
                    <p className="text-[11px] text-gray-400">In use</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 border border-red-100 text-center">
                    <p className="text-2xl font-bold text-red-500">{cantUse}</p>
                    <p className="text-[11px] text-gray-400">Cannot use</p>
                  </div>
                </div>

                {/* Search */}
                <input value={assetSearch} onChange={e => setAssetSearch(e.target.value)} placeholder="Search by code, name, or remark..."
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm mb-4 focus:outline-none focus:border-gray-400" />

                {/* Table */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Code</th>
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Item Name</th>
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Status</th>
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Held By</th>
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Date Taken</th>
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Returned</th>
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Notes</th>
                          {isAdmin && <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase w-20"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(a => (
                          <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono font-semibold text-gray-500 text-xs">{a.code}</td>
                            <td className="px-3 py-2 text-sm max-w-[200px]">{a.name}</td>
                            <td className="px-3 py-2">
                              {isAdmin ? (
                                <button onClick={() => toggleStatus(a.id, a.status)}
                                  className={`text-[11px] font-medium px-2 py-0.5 rounded cursor-pointer ${a.status === "Available" ? "bg-green-50 text-green-600" : a.status === "In Use" ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-500"}`}>
                                  {a.status}
                                </button>
                              ) : (
                                <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${a.status === "Available" ? "bg-green-50 text-green-600" : a.status === "In Use" ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-500"}`}>{a.status}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600">{a.held_by || "-"}</td>
                            <td className="px-3 py-2 text-xs text-gray-400">{a.date_taken || "-"}</td>
                            <td className="px-3 py-2 text-xs text-gray-400">{a.date_returned || "-"}</td>
                            <td className="px-3 py-2 text-xs text-gray-400 max-w-[120px] truncate">{a.notes || "-"}</td>
                            {isAdmin && (
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <button onClick={() => { setAssetModal(a.id); setAssetForm({ code: a.code, name: a.name, category: a.category, status: a.status, remark: a.remark || "", held_by: a.held_by || "", date_taken: a.date_taken || "", date_returned: a.date_returned || "", notes: a.notes || "" }); }}
                                  className="text-xs text-blue-500 hover:text-blue-700 mr-2">Edit</button>
                                <button onClick={() => deleteAsset(a.id)} className="text-xs text-red-400 hover:text-red-600">Del</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No items found</p>}
                </div>

                {/* Add/Edit Modal */}
                {assetModal && (
                  <div onClick={() => setAssetModal(null)} className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl p-6 w-[440px] max-w-[92%] shadow-xl">
                      <h3 className="text-base font-semibold mb-4">{assetModal === "add" ? "Add asset" : "Edit asset"}</h3>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <input value={assetForm.code} onChange={e => setAssetForm({ ...assetForm, code: e.target.value })} placeholder="Code (e.g. VR67)"
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                          <select value={assetForm.status} onChange={e => setAssetForm({ ...assetForm, status: e.target.value })}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                            <option>Available</option><option>In Use</option><option>Cannot Use</option>
                          </select>
                        </div>
                        <input value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="Item name"
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                        <input value={assetForm.held_by} onChange={e => setAssetForm({ ...assetForm, held_by: e.target.value })} placeholder="Person holding stock"
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                        <div className="grid grid-cols-2 gap-3">
                          <input value={assetForm.date_taken} onChange={e => setAssetForm({ ...assetForm, date_taken: e.target.value })} placeholder="Date taken"
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                          <input value={assetForm.date_returned} onChange={e => setAssetForm({ ...assetForm, date_returned: e.target.value })} placeholder="Date returned"
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                        </div>
                        <input value={assetForm.remark} onChange={e => setAssetForm({ ...assetForm, remark: e.target.value })} placeholder="Remark"
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                        <textarea value={assetForm.notes} onChange={e => setAssetForm({ ...assetForm, notes: e.target.value })} placeholder="Notes (stock check observations, condition, etc.)" rows={2}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y" />
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button onClick={saveAsset} className="flex-1 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg">{assetModal === "add" ? "Add" : "Save"}</button>
                        <button onClick={() => setAssetModal(null)} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg">Cancel</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stock Check Modal */}
                {assetModal === "stockcheck" && (
                  <div onClick={() => setAssetModal(null)} className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl p-6 w-[700px] max-w-[95%] max-h-[85vh] overflow-y-auto shadow-xl">
                      <div className="flex justify-between items-center mb-4">
                        <div>
                          <h3 className="text-base font-semibold">Friday Stock Check</h3>
                          <p className="text-xs text-gray-400">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                        </div>
                        <button onClick={() => setAssetModal(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
                      </div>
                      <p className="text-xs text-gray-400 mb-3">Update each item: who has it, status, and any notes. Changes save immediately.</p>
                      <div className="space-y-2">
                        {assets.filter(a => a.status !== "Cannot Use").map(a => (
                          <div key={a.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 text-sm">
                            <span className="font-mono text-xs text-gray-500 w-12 shrink-0">{a.code}</span>
                            <span className="flex-1 min-w-0 truncate text-xs">{a.name}</span>
                            <input defaultValue={a.held_by || ""} placeholder="Who has it?" onBlur={e => { if (e.target.value !== (a.held_by || "")) supabase.from("assets").update({ held_by: e.target.value }).eq("id", a.id).then(() => loadData()); }}
                              className="w-28 px-2 py-1 border border-gray-200 rounded text-xs" />
                            <select defaultValue={a.status} onChange={e => supabase.from("assets").update({ status: e.target.value }).eq("id", a.id).then(() => loadData())}
                              className={`w-20 px-1 py-1 border-0 rounded text-[11px] font-medium ${a.status === "Available" ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"}`}>
                              <option>Available</option><option>In Use</option>
                            </select>
                            <input defaultValue={a.notes || ""} placeholder="Notes" onBlur={e => { if (e.target.value !== (a.notes || "")) supabase.from("assets").update({ notes: e.target.value }).eq("id", a.id).then(() => loadData()); }}
                              className="w-32 px-2 py-1 border border-gray-200 rounded text-xs" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {/* ===== PEOPLE ===== */}
          {page === "people" && <PeoplePage isAdmin={isAdmin} userId={user.id} />}

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

// ===== PEOPLE (ONBOARDING / OFFBOARDING) =====
const PROBATION_LABELS = { m1: "Month 1", m2: "Month 2", m3: "Month 3", m4: "Month 4", m5: "Month 5", m6: "Month 6" };
const PEOPLE_LINK_LABELS = { staffFolder: "Staff Folder", hrRecording: "HR Recording", tlRecording: "TL Recording", plan: "Plan", confirmationLetter: "Confirmation Letter" };
const STATUS_OPTIONS = { Onboarding: ["Probation", "Confirmed", "Extended", "Terminated"], Offboarding: ["Pending", "Exited"] };
const STATUS_COLORS = { Probation: "bg-amber-50 text-amber-600", Confirmed: "bg-green-50 text-green-600", Extended: "bg-blue-50 text-blue-600", Terminated: "bg-red-50 text-red-500", Pending: "bg-amber-50 text-amber-600", Exited: "bg-red-50 text-red-500" };
const PROBATION_STATUS_COLORS = { Done: "bg-green-50 text-green-600", "In Progress": "bg-amber-50 text-amber-600", Scheduled: "bg-gray-100 text-gray-400" };

function parseFlexDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    y = y.length === 2 ? "20" + y : y;
    const dt = new Date(+y, +mo - 1, +d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}
function addMonths(date, n) { const d = new Date(date); d.setMonth(d.getMonth() + n); return d; }
function fmtDate(d) { return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : null; }

// Builds the probation checkpoint schedule for a record: Month 1-3 always,
// plus Month 4-6 for as long as they're within the active extension length,
// OR if that month already has recorded data — so confirming/terminating someone
// never hides an extension's history unless the data is explicitly cleared.
function buildProbationSchedule(r) {
  const join = parseFlexDate(r.join_date);
  const extMonths = r.status === "Extended" ? Math.min(Math.max(parseInt(r.extension_months) || 1, 1), 3) : 0;
  const keys = ["m1", "m2", "m3"];
  for (let i = 0; i < 3; i++) {
    const key = `m${4 + i}`;
    const stored = r.probation?.[key];
    const hasData = !!(stored && (stored.text || stored.url || stored.done));
    if (i < extMonths || hasData) keys.push(key);
  }
  const today = new Date();
  return keys.map((key) => {
    const monthNum = parseInt(key.slice(1), 10);
    const stored = r.probation?.[key] || null;
    const storedDate = stored?.text ? parseFlexDate(stored.text) : null;
    const dueDate = storedDate || (join ? addMonths(join, monthNum) : null);
    let status;
    if (stored?.done) status = "Done";
    else if (dueDate && dueDate <= today) status = "In Progress";
    else status = "Scheduled";
    return { key, label: PROBATION_LABELS[key], dueLabel: stored?.text || fmtDate(dueDate) || "Not scheduled", url: stored?.url || null, done: !!stored?.done, status };
  });
}

function normalizeName(name) { return String(name || "").trim().replace(/\s+/g, " ").toLowerCase(); }

function emptyPeopleForm() {
  return {
    type: "Onboarding", status: "Probation", month: "", staff_name: "", join_date: "", key_date: "",
    links: { staffFolder: "", hrRecording: "", tlRecording: "", plan: "", confirmationLetter: "" },
    probation: { m1: "", m2: "", m3: "", m4: "", m5: "", m6: "" },
  };
}

function PeopleLink({ label, item }) {
  if (!item) return <div className="text-xs text-gray-300">{label}: <span className="text-gray-300">—</span></div>;
  return item.url ? (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline block truncate">{label}: {item.text || "Open"}</a>
  ) : (
    <div className="text-xs text-gray-500 truncate">{label}: {item.text || "—"}</div>
  );
}

function PeoplePage({ isAdmin, userId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [modal, setModal] = useState(null); // null | "add" | record id
  const [form, setForm] = useState(emptyPeopleForm());
  const [uploadStatus, setUploadStatus] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("people_lifecycle").select("*").order("uploaded_at", { ascending: false });
    if (data) setRecords(data);
    setLoading(false);
  }

  // Refetches quietly in the background, without the loading screen replacing the list.
  async function silentReload() {
    const { data } = await supabase.from("people_lifecycle").select("*").order("uploaded_at", { ascending: false });
    if (data) setRecords(data);
  }

  function openAdd() { setForm(emptyPeopleForm()); setModal("add"); }
  function openEdit(r) {
    setForm({
      type: r.type, status: r.status || STATUS_OPTIONS[r.type][0], month: r.month || "", staff_name: r.staff_name, join_date: r.join_date || "", key_date: r.key_date || "",
      links: {
        staffFolder: r.links?.staffFolder?.url || "", hrRecording: r.links?.hrRecording?.url || "",
        tlRecording: r.links?.tlRecording?.url || "", plan: r.links?.plan?.url || "", confirmationLetter: r.links?.confirmationLetter?.url || "",
      },
      probation: {
        m1: r.probation?.m1?.text || "", m2: r.probation?.m2?.text || "", m3: r.probation?.m3?.text || "",
        m4: r.probation?.m4?.text || "", m5: r.probation?.m5?.text || "", m6: r.probation?.m6?.text || "",
      },
    });
    setModal(r.id);
  }

  function buildPayload() {
    const links = {};
    Object.keys(PEOPLE_LINK_LABELS).forEach(k => { links[k] = form.links[k] ? { text: PEOPLE_LINK_LABELS[k], url: form.links[k] } : null; });
    const probation = {};
    Object.keys(PROBATION_LABELS).forEach(k => { probation[k] = form.probation[k] ? { text: form.probation[k], url: null } : null; });
    return { type: form.type, status: form.status, month: form.month.trim(), staff_name: form.staff_name.trim(), join_date: form.join_date.trim() || null, key_date: form.key_date.trim() || null, links, probation, uploaded_by: userId };
  }

  async function save() {
    const payload = buildPayload();
    if (!payload.staff_name) return;
    setBusy(true);
    const norm = normalizeName(payload.staff_name);
    const existing = records.find(x => x.id !== modal && normalizeName(x.staff_name) === norm);
    if (existing) {
      // Same person already exists under this name (case/whitespace-insensitive) — merge into
      // that record instead of creating a duplicate row.
      await supabase.from("people_lifecycle").update(payload).eq("id", existing.id);
    } else if (modal === "add") {
      await supabase.from("people_lifecycle").upsert(payload, { onConflict: "staff_name" });
    } else {
      await supabase.from("people_lifecycle").update(payload).eq("id", modal);
    }
    setBusy(false); setModal(null); silentReload();
  }

  async function del(id) {
    if (!confirm("Delete this person's record?")) return;
    setRecords(prev => prev.filter(x => x.id !== id));
    await supabase.from("people_lifecycle").delete().eq("id", id);
  }

  // Updates the row in place immediately, then saves in the background — no reload, no flicker.
  async function changeStatus(id, status) {
    const patch = { status };
    const rec = records.find(x => x.id === id);
    if (status === "Extended" && !rec?.extension_months) patch.extension_months = 1;
    setRecords(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
    await supabase.from("people_lifecycle").update(patch).eq("id", id);
  }

  // Sets how many extra months (1-3) the current extension covers. Calling this again later
  // (e.g. after the first extension month is up and they're still not confirmed) simply
  // bumps the count so another month gets added — same record, no new status change needed.
  async function setExtensionMonths(r, n) {
    setRecords(prev => prev.map(x => x.id === r.id ? { ...x, extension_months: n } : x));
    await supabase.from("people_lifecycle").update({ extension_months: n }).eq("id", r.id);
  }

  async function toggleProbationDone(r, key) {
    const current = r.probation?.[key] || {};
    const updated = { ...r.probation, [key]: { ...current, done: !current.done } };
    setRecords(prev => prev.map(x => x.id === r.id ? { ...x, probation: updated } : x));
    await supabase.from("people_lifecycle").update({ probation: updated }).eq("id", r.id);
  }

  async function setProbationLink(r, key) {
    const current = r.probation?.[key] || {};
    const input = window.prompt(`Link for ${PROBATION_LABELS[key]} (leave blank to remove)`, current.url || "");
    if (input === null) return; // cancelled
    const url = input.trim() || null;
    const updated = { ...r.probation, [key]: { ...current, url } };
    setRecords(prev => prev.map(x => x.id === r.id ? { ...x, probation: updated } : x));
    await supabase.from("people_lifecycle").update({ probation: updated }).eq("id", r.id);
  }

  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const result = parsePeopleLifecycle(evt.target.result, file.name);
        setPendingUpload(result);
        setUploadStatus({ ok: true, msg: `${result.count} staff records found in ${file.name}` });
      } catch (err) { setUploadStatus({ ok: false, msg: err.message }); }
    };
    reader.readAsArrayBuffer(file);
  }

  async function confirmUpload() {
    if (!pendingUpload) return;
    setBusy(true);
    // Match each row to an existing person by normalized name (trim/case-insensitive) so the
    // same person never ends up as two rows — whether the duplicate is already in the table
    // or appears twice within this same file.
    const nameToId = new Map(records.map(x => [normalizeName(x.staff_name), x.id]));
    for (const r of pendingUpload.records) {
      const row = {
        type: r.type, status: r.status, month: r.month, staff_name: r.staffName, join_date: r.joinDate, key_date: r.keyDate,
        links: r.links, probation: r.probation, uploaded_by: userId,
      };
      const norm = normalizeName(r.staffName);
      const existingId = nameToId.get(norm);
      if (existingId) {
        await supabase.from("people_lifecycle").update(row).eq("id", existingId);
      } else {
        const { data } = await supabase.from("people_lifecycle").upsert(row, { onConflict: "staff_name" }).select("id").single();
        if (data) nameToId.set(norm, data.id);
      }
    }
    setPendingUpload(null); setUploadStatus(null); setBusy(false); silentReload();
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-12">Loading...</p>;

  const onboardingRecs = records.filter(r => r.type === "Onboarding");
  const offboardingRecs = records.filter(r => r.type === "Offboarding");
  const inProbation = onboardingRecs.filter(r => (r.status || "Probation") === "Probation" || r.status === "Extended").length;
  const confirmed = onboardingRecs.filter(r => r.status === "Confirmed").length;
  const terminated = onboardingRecs.filter(r => r.status === "Terminated").length;

  const filtered = records
    .filter(r => tab === "all" || r.type === tab)
    .filter(r => !search.trim() || r.staff_name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">People</h1>
          <p className="text-sm text-gray-400">Onboarding &amp; offboarding lifecycle</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={openAdd} className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg">+ Add person</button>
            <label className="cursor-pointer">
              <div className="px-3 py-1.5 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50">Upload file</div>
              <input type="file" accept=".xlsx,.xls,.csv,.ods" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}
      </div>

      {uploadStatus && (
        <div className={`mb-4 p-3 rounded-xl text-xs flex items-center justify-between ${uploadStatus.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
          <span>{uploadStatus.ok ? "✓ " + uploadStatus.msg : uploadStatus.msg}</span>
          {uploadStatus.ok && pendingUpload && (
            <div className="flex gap-2">
              <button onClick={confirmUpload} disabled={busy} className="px-3 py-1 bg-gray-900 text-white rounded-lg disabled:opacity-50">{busy ? "Saving..." : "Confirm & save"}</button>
              <button onClick={() => { setPendingUpload(null); setUploadStatus(null); }} className="px-3 py-1 text-gray-400">Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 text-center">
          <p className="text-2xl font-bold">{records.length}</p>
          <p className="text-[11px] text-gray-400">Total tracked</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 text-center">
          <p className="text-2xl font-bold text-blue-600">{inProbation}</p>
          <p className="text-[11px] text-gray-400">In probation</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 border border-green-100 text-center">
          <p className="text-2xl font-bold text-green-600">{confirmed}</p>
          <p className="text-[11px] text-gray-400">Confirmed</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4 border border-red-100 text-center">
          <p className="text-2xl font-bold text-red-500">{terminated}</p>
          <p className="text-[11px] text-gray-400">Terminated</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4 border border-red-100 text-center">
          <p className="text-2xl font-bold text-red-500">{offboardingRecs.length}</p>
          <p className="text-[11px] text-gray-400">Offboarded</p>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-2 mb-4">
        {[["all", "All"], ["Onboarding", "Onboarding"], ["Offboarding", "Offboarding"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{label}</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name..."
          className="ml-auto px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-48 focus:outline-none focus:border-gray-400" />
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.map(r => (
          <div key={r.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-500 shrink-0">
                {r.staff_name?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.staff_name}</p>
                <p className="text-[11px] text-gray-400">{r.month || "—"}{r.join_date ? ` · Joined ${r.join_date}` : ""}</p>
              </div>
              {r.links?.staffFolder?.url && (
                <a href={r.links.staffFolder.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                  title="Open employee folder" className="text-xs text-gray-400 hover:text-gray-700 shrink-0">📁 Folder</a>
              )}
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 ${r.type === "Onboarding" ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-500"}`}>{r.type}</span>
              {isAdmin ? (
                <select value={r.status || STATUS_OPTIONS[r.type][0]} onClick={e => e.stopPropagation()} onChange={e => changeStatus(r.id, e.target.value)}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 border-0 cursor-pointer ${STATUS_COLORS[r.status] || STATUS_COLORS[STATUS_OPTIONS[r.type][0]]}`}>
                  {STATUS_OPTIONS[r.type].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 ${STATUS_COLORS[r.status] || STATUS_COLORS[STATUS_OPTIONS[r.type][0]]}`}>{r.status || STATUS_OPTIONS[r.type][0]}</span>
              )}
              {isAdmin && (
                <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                  <button onClick={() => openEdit(r)} className="text-xs text-blue-500 hover:text-blue-700">Edit</button>
                  <button onClick={() => del(r.id)} className="text-xs text-red-400 hover:text-red-600">Del</button>
                </div>
              )}
              <span className="text-gray-300 text-xs shrink-0">{expanded === r.id ? "▲" : "▼"}</span>
            </div>
            {expanded === r.id && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-50 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase mb-2">
                    {r.type === "Onboarding" ? "Probation (3 months from hire date)" : "Timeline"}
                  </p>
                  <div className="space-y-1.5">
                    <div className="text-xs text-gray-600">Join date: <span className="text-gray-800">{r.join_date || "—"}</span></div>
                    {r.type === "Onboarding" && buildProbationSchedule(r).map(p => (
                      <div key={p.key} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={p.done} disabled={!isAdmin} onChange={() => toggleProbationDone(r, p.key)} className="accent-gray-900 shrink-0" />
                        <span className={`w-16 shrink-0 ${p.done ? "text-gray-400 line-through" : "text-gray-600"}`}>{p.label}</span>
                        <span className="text-gray-800 truncate">{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{p.dueLabel}</a> : p.dueLabel}</span>
                        {isAdmin && (
                          <button onClick={() => setProbationLink(r, p.key)} title={p.url ? "Edit link" : "Add link"} className="text-gray-300 hover:text-blue-500 shrink-0">🔗</button>
                        )}
                        <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${PROBATION_STATUS_COLORS[p.status]}`}>{p.status}</span>
                      </div>
                    ))}
                    <div className="text-xs text-gray-600 pt-1">{r.type === "Onboarding" ? "Confirmation date" : "Last day"}: <span className="text-gray-800">{r.key_date || "—"}</span></div>
                  </div>
                  {r.type === "Onboarding" && (
                    <div className="mt-3 pt-3 border-t border-gray-50">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase mb-1.5">Confirmation decision</p>
                      {isAdmin ? (
                        <select value={r.status || "Probation"} onChange={e => changeStatus(r.id, e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                          <option value="Probation">Still on probation</option>
                          <option value="Confirmed">Confirmed</option>
                          <option value="Extended">Extended</option>
                          <option value="Terminated">Terminated</option>
                        </select>
                      ) : (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${STATUS_COLORS[r.status] || STATUS_COLORS.Probation}`}>{r.status || "Probation"}</span>
                      )}
                      {r.status === "Extended" && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className="text-[11px] text-gray-400 mr-0.5">Extended by:</span>
                          {isAdmin ? [1, 2, 3].map(n => (
                            <button key={n} onClick={() => setExtensionMonths(r, n)}
                              className={`px-2 py-1 rounded text-[11px] font-medium ${(r.extension_months || 1) === n ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                              {n} {n === 1 ? "month" : "months"}
                            </button>
                          )) : (
                            <span className="text-[11px] text-gray-600">{r.extension_months || 1} {(r.extension_months || 1) === 1 ? "month" : "months"}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase mb-2">Documents</p>
                  <div className="space-y-1.5">
                    {Object.keys(PEOPLE_LINK_LABELS).map(k => <PeopleLink key={k} label={PEOPLE_LINK_LABELS[k]} item={r.links?.[k]} />)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No records found</p>}
      </div>

      {/* Add/Edit Modal */}
      {modal && (
        <div onClick={() => setModal(null)} className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl p-6 w-[560px] max-w-full max-h-[88vh] overflow-y-auto shadow-xl">
            <h3 className="text-base font-semibold mb-4">{modal === "add" ? "Add person" : "Edit person"}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input value={form.staff_name} onChange={e => setForm({ ...form, staff_name: e.target.value })} placeholder="Staff name"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                <select value={form.type} onChange={e => { const type = e.target.value; setForm({ ...form, type, status: STATUS_OPTIONS[type][0] }); }} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  <option>Onboarding</option><option>Offboarding</option>
                </select>
              </div>
              <div>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  {STATUS_OPTIONS[form.type].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input value={form.month} onChange={e => setForm({ ...form, month: e.target.value })} placeholder="Month (e.g. August)"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                <input value={form.join_date} onChange={e => setForm({ ...form, join_date: e.target.value })} placeholder="Join date"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                <input value={form.key_date} onChange={e => setForm({ ...form, key_date: e.target.value })} placeholder={form.type === "Onboarding" ? "Confirmation date" : "Last day"}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>

              <p className="text-[11px] font-semibold text-gray-400 uppercase pt-2">Document links (URLs)</p>
              {Object.keys(PEOPLE_LINK_LABELS).map(k => (
                <input key={k} value={form.links[k]} onChange={e => setForm({ ...form, links: { ...form.links, [k]: e.target.value } })} placeholder={PEOPLE_LINK_LABELS[k]}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              ))}

              <p className="text-[11px] font-semibold text-gray-400 uppercase pt-2">Probation evaluations</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.keys(PROBATION_LABELS).map(k => (
                  <input key={k} value={form.probation[k]} onChange={e => setForm({ ...form, probation: { ...form.probation, [k]: e.target.value } })} placeholder={PROBATION_LABELS[k]}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={save} disabled={busy} className="flex-1 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">{busy ? "Saving..." : modal === "add" ? "Add" : "Save"}</button>
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
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
  const [month, setMonth] = useState("");
  const [week, setWeek] = useState("1");
  const [team, setTeam] = useState("Content");
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  async function handleRecord() {
    if (!text.trim() || !month) { setMsg("Enter month and paste data"); return; }
    setRecording(true); setMsg("");
    try {
      const lines = text.trim().split("\n").map(l => l.split("\t").map(c => c.trim()));
      // Skip header if first row looks like headers
      let startIdx = 0;
      if (lines[0]?.some(c => c.toLowerCase().includes("name") || c.toLowerCase().includes("target"))) startIdx = 1;
      
      const entries = [];
      for (let i = startIdx; i < lines.length; i++) {
        const row = lines[i];
        if (!row || row.every(c => !c)) continue;
        // Auto-detect: if first cell is a name (no number), it's Name, Target, Completed, Progress
        // If it has numbers, try to match sheet format
        const name = row[0] || "";
        if (!name) continue;
        
        const target = row[1] || "";
        const completed = row[2] || "";
        const progress = parseFloat(row[3]) || parseFloat(row[row.length - 1]) || null;
        const notes = row[4] || "";
        const status = row[5] || (progress >= 0.9 ? "On Target" : progress >= 0.7 ? "Slightly Behind" : "Behind");
        const links = row[6] || "";

        entries.push({ month, week, team, employee: name, target, completed, kpiPct: isNaN(progress) ? null : progress, notes, status, links });
      }

      if (!entries.length) { setMsg("No data found. Check format."); setRecording(false); return; }

      // Merge with existing KPI data
      const { data: existing } = await supabase.from("weekly_kpi").select("*").order("uploaded_at", { ascending: false }).limit(1);
      let allEntries = existing?.[0]?.data?.entries || [];
      // Remove old entries for this month+week+team
      allEntries = allEntries.filter(e => !(e.month === month && String(e.week) === String(week) && e.team === team));
      allEntries = allEntries.concat(entries);

      await supabase.from("weekly_kpi").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("weekly_kpi").insert({ data: { entries: allEntries }, uploaded_by: userId });
      setText(""); setMsg("Added " + entries.length + " entries for " + team + " " + month + " W" + week);
      onRecorded();
    } catch (err) { setMsg("Error: " + err.message); }
    setRecording(false);
  }

  return (
    <div className="mt-8 border-t border-gray-100 pt-6">
      <button onClick={() => setOpen(!open)} className="text-sm font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-3">
        {open ? "▾" : "▸"} Paste weekly data
      </button>
      {open && (
        <>
          <div className="flex gap-3 mb-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-400 uppercase">Team</label>
              <select value={team} onChange={e => setTeam(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
                <option>Content</option><option>Video</option><option>Design</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-400 uppercase">Month</label>
              <input value={month} onChange={e => setMonth(e.target.value)} placeholder="e.g. July" className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-24" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-400 uppercase">Week</label>
              <select value={week} onChange={e => setWeek(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
                <option value="1">W1</option><option value="2">W2</option><option value="3">W3</option><option value="4">W4</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-2">Copy rows from your sheet and paste below. Format: Name, Target, Completed, Progress (tab-separated)</p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
            placeholder={"Jeremiah\t2 videos\t2 videos\t1.0\nMahal\t2 videos\t2 videos\t1.0\nRosie\tEnsure delivery\t1\t0.9"}
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
