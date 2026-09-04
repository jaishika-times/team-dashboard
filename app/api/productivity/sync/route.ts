import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchFormResponses, sheetSerialToDate } from "@/lib/googleSheets/fetchFormResponses";
import { parseEmployeeTaskCell } from "@/lib/googleSheets/parseTasks";

function normalizeTeam(raw: string): string {
  return raw.replace(/\s*Team\s*$/i, "").trim();
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: logRow } = await supabase
    .from("productivity_sync_log")
    .insert({ status: "running" })
    .select()
    .single();

  try {
    const formRows = await fetchFormResponses();

    const { data: employees } = await supabase.from("employees").select("id, name, team");
    const employeeByName = new Map((employees ?? []).map((e) => [e.name.toLowerCase(), e]));

    const upsertRows: any[] = [];
    let flaggedCount = 0;

    for (const row of formRows) {
      const serial = parseFloat(row.timestamp);
      if (Number.isNaN(serial)) continue;
      const submittedAt = sheetSerialToDate(serial);
      const taskDate = submittedAt.toISOString().slice(0, 10);
      const team = normalizeTeam(row.department);

      for (const [employeeName, rawCell] of Object.entries(row.employeeCells)) {
        const employee = employeeByName.get(employeeName.toLowerCase());
        const parsedTasks = parseEmployeeTaskCell(rawCell);

        parsedTasks.forEach((t) => {
          if (t.parseConfidence === "low") flaggedCount++;
          upsertRows.push({
            task_date: taskDate,
            team,
            employee_name: employeeName,
            employee_id: employee?.id ?? null,
            task_name: t.taskName,
            task_description: t.taskDescription,
            hours_spent: t.hoursSpent,
            entry_status: t.entryStatus,
            leave_label: t.leaveLabel,
            raw_cell_text: t.rawCellText,
            parse_confidence: t.parseConfidence,
            sort_order: t.sortOrder,
            form_response_timestamp: submittedAt.toISOString(),
          });
        });
      }
    }

    const BATCH_SIZE = 500;
    for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
      const batch = upsertRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("daily_productivity_tasks")
        .upsert(batch, { onConflict: "task_date,employee_name,sort_order" });
      if (error) throw error;
    }

    await supabase
      .from("productivity_sync_log")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        rows_synced: upsertRows.length,
        rows_flagged_low_confidence: flaggedCount,
      })
      .eq("id", logRow!.id);

    return NextResponse.json({
      success: true,
      rowsSynced: upsertRows.length,
      flaggedForReview: flaggedCount,
    });
  } catch (err: any) {
    await supabase
      .from("productivity_sync_log")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: err.message ?? String(err),
      })
      .eq("id", logRow!.id);

    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
