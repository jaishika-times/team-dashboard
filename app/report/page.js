"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ReportPage() {
  const [loading, setLoading] = useState(true);
  const [prodData, setProdData] = useState(null);
  const [attData, setAttData] = useState({});
  const [attIndex, setAttIndex] = useState([]);
  const router = useRouter();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return; }

    const { data: prodRows } = await supabase.from("productivity_records").select("*").order("uploaded_at", { ascending: false }).limit(1);
    if (prodRows?.length) setProdData(prodRows[0]);

    const { data: attRows } = await supabase.from("attendance_records").select("*").order("month_key", { ascending: false });
    if (attRows?.length) {
      setAttIndex(attRows.map(r => ({ key: r.month_key, label: r.month_label })));
      const map = {};
      attRows.forEach(r => { map[r.month_key] = r.data; });
      setAttData(map);
    }
    setLoading(false);
  }

  function handlePrint() { window.print(); }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>Loading report data...</div>;

  // Compute productivity summary
  const prodSummary = {};
  if (prodData?.data) {
    Object.values(prodData.data).forEach(dd => {
      Object.entries(dd).forEach(([name, d]) => {
        if (!prodSummary[name]) prodSummary[name] = { team: d.team, totalHours: 0, totalTasks: 0, daysWorked: 0, daysLeave: 0 };
        if (d.leave) prodSummary[name].daysLeave++;
        else if (d.tasks?.length > 0 || d.hours > 0) { prodSummary[name].totalHours += d.hours; prodSummary[name].totalTasks += d.tasks.length; prodSummary[name].daysWorked++; }
      });
    });
  }
  const prodRows = Object.entries(prodSummary).sort((a, b) => b[1].totalHours - a[1].totalHours);
  const dateRange = prodData?.dates?.length ? `${prodData.dates[prodData.dates.length - 1]} to ${prodData.dates[0]}` : "N/A";
  const latestAtt = attIndex[0];
  const latestAttData = latestAtt ? attData[latestAtt.key] : null;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { font-size: 11px; }
          .report { padding: 0 !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
          .section { page-break-inside: avoid; }
        }
        .report { max-width: 900px; margin: 0 auto; padding: 40px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; }
        .report h1 { font-size: 24px; font-weight: 600; margin-bottom: 2px; }
        .report h2 { font-size: 16px; font-weight: 600; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #111; }
        .report .meta { font-size: 13px; color: #888; margin-bottom: 24px; }
        .report table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
        .report th { padding: 8px 10px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; background: #f5f5f5; border-bottom: 1px solid #ddd; }
        .report td { padding: 7px 10px; border-bottom: 1px solid #eee; }
        .report .r { text-align: right; }
        .report .bold { font-weight: 600; }
        .report .totals td { font-weight: 600; border-top: 2px solid #111; background: #f9f9f9; }
        .print-btn { position: fixed; top: 20px; right: 20px; padding: 10px 20px; background: #111; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; z-index: 10; }
        .print-btn:hover { background: #333; }
        .back-btn { position: fixed; top: 20px; left: 20px; padding: 10px 20px; background: #fff; color: #111; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; cursor: pointer; z-index: 10; text-decoration: none; }
      `}</style>

      <a href="/" className="back-btn no-print">Back to dashboard</a>
      <button onClick={handlePrint} className="print-btn no-print">Download as PDF</button>

      <div className="report">
        <h1>Monthly Team Report</h1>
        <div className="meta">
          Period: {dateRange} | Generated: {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </div>

        {/* PRODUCTIVITY */}
        {prodRows.length > 0 && (
          <div className="section">
            <h2>Productivity Summary</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Member</th>
                  <th>Team</th>
                  <th className="r">Days worked</th>
                  <th className="r">Tasks</th>
                  <th className="r">Total hours</th>
                  <th className="r">Avg hrs/day</th>
                  <th className="r">Leave days</th>
                </tr>
              </thead>
              <tbody>
                {prodRows.map(([name, s], i) => {
                  const avg = s.daysWorked > 0 ? (s.totalHours / s.daysWorked).toFixed(1) : "--";
                  return (
                    <tr key={name}>
                      <td className="bold">{i + 1}</td>
                      <td>{name}</td>
                      <td>{s.team}</td>
                      <td className="r">{s.daysWorked}</td>
                      <td className="r">{s.totalTasks}</td>
                      <td className="r bold">{s.totalHours.toFixed(1)}</td>
                      <td className="r">{avg}</td>
                      <td className="r">{s.daysLeave || "-"}</td>
                    </tr>
                  );
                })}
                <tr className="totals">
                  <td></td>
                  <td>Total</td>
                  <td></td>
                  <td className="r">{prodRows.reduce((s, [, d]) => s + d.daysWorked, 0)}</td>
                  <td className="r">{prodRows.reduce((s, [, d]) => s + d.totalTasks, 0)}</td>
                  <td className="r">{prodRows.reduce((s, [, d]) => s + d.totalHours, 0).toFixed(1)}</td>
                  <td className="r"></td>
                  <td className="r">{prodRows.reduce((s, [, d]) => s + d.daysLeave, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ATTENDANCE */}
        {latestAttData && (
          <div className="section">
            <h2>Attendance Summary - {latestAtt.label}</h2>

            {latestAttData.late?.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 500, margin: "16px 0 8px", color: "#555" }}>Late arrivals (after 9:45 AM)</h3>
                <table>
                  <thead><tr><th>#</th><th>Employee</th><th className="r">Days late</th></tr></thead>
                  <tbody>
                    {latestAttData.late.map((e, i) => (
                      <tr key={i}><td className="bold">{i + 1}</td><td>{e.name}</td><td className="r bold">{e.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {latestAttData.short?.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 500, margin: "16px 0 8px", color: "#555" }}>Short hours (below 7.5 hrs)</h3>
                <table>
                  <thead><tr><th>#</th><th>Employee</th><th className="r">Days short</th></tr></thead>
                  <tbody>
                    {latestAttData.short.map((e, i) => (
                      <tr key={i}><td className="bold">{i + 1}</td><td>{e.name}</td><td className="r bold">{e.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {latestAttData.sle?.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 500, margin: "16px 0 8px", color: "#555" }}>Leave usage</h3>
                <table>
                  <thead><tr><th>#</th><th>Employee</th><th className="r">SL</th><th className="r">EL</th></tr></thead>
                  <tbody>
                    {latestAttData.sle.map((e, i) => (
                      <tr key={i}><td className="bold">{i + 1}</td><td>{e.name}</td><td className="r">{e.sl}</td><td className="r">{e.el}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #eee", fontSize: 11, color: "#bbb", textAlign: "center" }}>
          Times Media Sdn Bhd - Team Dashboard Report - Confidential
        </div>
      </div>
    </>
  );
}
