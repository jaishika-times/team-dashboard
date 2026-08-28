import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Admin client with service role key (server-side only)
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Verify the requesting user is an admin
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

  const { email, password, role } = await request.json();
  if (!email || !password || !role) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const admin = getAdminClient();

  // Create user in Supabase Auth
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Skip email verification
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // The trigger auto-creates a profile, but update role if needed
  if (role === "admin") {
    await admin.from("profiles").update({ role: "admin" }).eq("id", data.user.id);
  }

  return NextResponse.json({ success: true, userId: data.user.id });
}

export async function DELETE(request) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await request.json();
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await admin.from("profiles").delete().eq("id", userId);
  return NextResponse.json({ success: true });
}
