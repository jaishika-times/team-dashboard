"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkState();
  }, []);

  async function checkState() {
    // Already logged in?
    const { data: { session } } = await supabase.auth.getSession();
    if (session) { router.push("/"); return; }
    // Any users exist?
    const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true });
    setIsSetup(!count || count === 0);
    setChecking(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) { setError("Fill in both fields"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");

    if (isSetup) {
      // First user - sign up as admin
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) { setError(signUpError.message); setLoading(false); return; }
      // The database trigger auto-creates a profile with role='admin'
      router.push("/");
    } else {
      // Sign in
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message === "Invalid login credentials"
          ? "Wrong email or password. Ask an admin if you need access."
          : signInError.message);
        setLoading(false); return;
      }
      router.push("/");
    }
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
          {isSetup ? "Create the first admin account to get started" : "Sign in with your credentials"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
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

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "Please wait..." : isSetup ? "Create admin account" : "Sign in"}
          </button>
        </form>

        {isSetup && (
          <p className="text-xs text-gray-400 mt-4 text-center">
            This is a one-time setup. You'll be able to add team members after.
          </p>
        )}
      </div>
    </div>
  );
}
