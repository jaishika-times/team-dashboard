"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        await handlePostSignIn(session);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const router = useRouter();

  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const ok = await handlePostSignIn(session);
      if (ok) return;
    }
    setChecking(false);
  }

  async function handlePostSignIn(session) {
    const email = session.user.email?.toLowerCase();

    // Check if user is authorized
    const { data: allowed } = await supabase
      .from("allowed_emails")
      .select("role")
      .eq("email", email)
      .single();

    // Also check if they already have a profile (existing admin)
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (!allowed && !profile) {
      // Not authorized
      await supabase.auth.signOut();
      setError("Access not authorized. Ask an admin to add your email.");
      setChecking(false);
      return false;
    }

    // If allowed but no profile yet, create one
    if (allowed && !profile) {
      await supabase.from("profiles").upsert({
        id: session.user.id,
        email: email,
        role: allowed.role,
      }, { onConflict: "id" });
    }

    router.push("/");
    return true;
  }

  async function signInWithGoogle() {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/login",
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, sans-serif" }}>
        <p style={{ color: "#aaa", fontSize: 14 }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Team Dashboard</h1>
        <p style={{ fontSize: 13, color: "#999", marginBottom: 28 }}>Sign in with your company Google account</p>

        {error && <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 16, background: "#fef2f2", padding: "8px 12px", borderRadius: 8 }}>{error}</p>}

        <button
          onClick={signInWithGoogle}
          disabled={loading}
          style={{
            width: "100%", padding: "12px 0", background: "#fff", color: "#333",
            border: "1px solid #ddd", borderRadius: 8, fontSize: 14, fontWeight: 500,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            opacity: loading ? 0.6 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" fill="#4285F4"/><path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" fill="#34A853"/><path d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" fill="#FBBC05"/><path d="M8.98 3.58c1.16 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.9z" fill="#EA4335"/></svg>
          {loading ? "Redirecting..." : "Continue with Google"}
        </button>

        <p style={{ fontSize: 11, color: "#ccc", marginTop: 20 }}>
          Only pre-authorized emails can access this dashboard
        </p>
      </div>
    </div>
  );
}
