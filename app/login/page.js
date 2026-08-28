"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("checking"); // "checking", "login", "set-password"
  const router = useRouter();

  useEffect(() => {
    // Set up auth listener FIRST to catch invite token exchange
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("Auth event:", event);
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          // Check if user needs to set password (invited user)
          if (session) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("role")
              .eq("id", session.user.id)
              .single();

            // If user was invited, they need to set a password
            const isInvite =
              window.location.hash.includes("type=invite") ||
              window.location.hash.includes("type=recovery") ||
              window.location.hash.includes("type=signup") ||
              event === "PASSWORD_RECOVERY";

            if (isInvite) {
              setMode("set-password");
              return;
            }

            // Otherwise normal sign in
            router.push("/");
          }
        }
      }
    );

    // Then check for existing session (not from invite)
    setTimeout(async () => {
      // Give the auth listener time to process any tokens in the URL
      const { data: { session } } = await supabase.auth.getSession();
      if (session && mode === "checking") {
        // Already logged in, check if this is a redirect from invite
        const hash = window.location.hash;
        if (hash && (hash.includes("type=invite") || hash.includes("type=signup") || hash.includes("type=recovery"))) {
          setMode("set-password");
        } else {
          router.push("/");
        }
      } else if (mode === "checking") {
        setMode("login");
      }
    }, 1000);

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    if (!email || !password) { setError("Fill in both fields"); return; }
    setLoading(true); setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError("Wrong email or password. Ask an admin if you need access.");
      setLoading(false);
      return;
    }
    router.push("/");
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true); setError("");

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setError(error.message); setLoading(false); return; }

    setSuccess("Password set! Redirecting...");
    setTimeout(() => router.push("/"), 1500);
  }

  if (mode === "checking") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, sans-serif" }}>
        <p style={{ color: "#aaa", fontSize: 14 }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Team Dashboard</h1>
        <p style={{ fontSize: 13, color: "#999", marginBottom: 28 }}>
          {mode === "set-password"
            ? "Welcome! Set your password to complete setup"
            : "Sign in with your credentials"}
        </p>

        {mode === "set-password" ? (
          <form onSubmit={handleSetPassword}>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Choose a password (min 6 characters)"
              autoFocus
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, marginBottom: 12, outline: "none" }}
            />
            {error && <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</p>}
            {success && <p style={{ fontSize: 12, color: "#16a34a", marginBottom: 10 }}>{success}</p>}
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "Saving..." : "Set password & sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, marginBottom: 12, outline: "none" }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, marginBottom: 12, outline: "none" }}
            />
            {error && <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</p>}
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}

        <p style={{ fontSize: 11, color: "#bbb", marginTop: 16, textAlign: "center" }}>
          Don't have access? Ask your admin to invite you.
        </p>
      </div>
    </div>
  );
}
