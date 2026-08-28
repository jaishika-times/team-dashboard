"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("login"); // "login" or "set-password"
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkState();
  }, []);

  async function checkState() {
    // Check if this is an invite callback (user clicked email link)
    const hash = window.location.hash;
    if (hash && hash.includes("type=invite")) {
      // Supabase auto-handles the token exchange via the hash
      const { data: { session }, error } = await supabase.auth.getSession();
      if (session) {
        setMode("set-password");
        setChecking(false);
        return;
      }
    }

    // Check for existing session
    const { data: { session } } = await supabase.auth.getSession();
    if (session) { router.push("/"); return; }

    // Listen for auth changes (handles invite token exchange)
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        if (window.location.hash.includes("type=invite")) {
          setMode("set-password");
        } else {
          router.push("/");
        }
      }
    });

    setChecking(false);
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!email || !password) { setError("Fill in both fields"); return; }
    setLoading(true); setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Wrong email or password. Ask an admin if you need access.");
      setLoading(false); return;
    }
    router.push("/");
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setError(error.message); setLoading(false); return; }

    setSuccess("Password set! Redirecting...");
    setTimeout(() => router.push("/"), 1500);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Team Dashboard</h1>
        <p className="text-sm text-gray-400 mb-7">
          {mode === "set-password" ? "Set your password to complete setup" : "Sign in with your credentials"}
        </p>

        {mode === "set-password" ? (
          <form onSubmit={handleSetPassword} className="space-y-3">
            <input
              type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Choose a password (min 6 characters)" autoFocus
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            {success && <p className="text-xs text-green-600">{success}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {loading ? "Saving..." : "Set password"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" autoFocus
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}

        <p className="text-xs text-gray-400 mt-4 text-center">
          Don't have access? Ask your admin to invite you.
        </p>
      </div>
    </div>
  );
}
