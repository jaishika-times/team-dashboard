import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function verifyAdmin(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const admin = getAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return false;
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin";
}

export async function POST(request) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email, role } = await request.json();
  if (!email || !role) {
    return NextResponse.json({ error: "Missing email or role" }, { status: 400 });
  }

  const admin = getAdminClient();
  const emailLower = email.trim().toLowerCase();

  // Add to allowed_emails table
  const { error } = await admin.from("allowed_emails").upsert(
    { email: emailLower, role },
    { onConflict: "email" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email } = await request.json();
  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  const admin = getAdminClient();

  // Remove from allowed_emails
  await admin.from("allowed_emails").delete().eq("email", email.toLowerCase());

  // Also remove their profile if it exists
  await admin.from("profiles").delete().eq("email", email.toLowerCase());

  return NextResponse.json({ success: true });
}
