import React, { useState } from "react";
import { Loader2, LogIn, AlertCircle } from "lucide-react";
import { supabase } from "../supabaseClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    setLoading(false);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 20, marginBottom: 4, textTransform: "uppercase" }}>
          Site Daily Report
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>
          Sign in with the account your site admin set up for you.
        </div>

        {error && (
          <div className="banner error">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        <div className="field">
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        </div>

        <button className="btn-primary" onClick={handleSubmit} disabled={loading} style={{ marginTop: 6 }}>
          {loading ? <Loader2 size={17} className="spin" /> : <LogIn size={16} />}
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 16, lineHeight: 1.5 }}>
          No account yet? Ask whoever set up this app to add you in Supabase under
          Authentication → Users.
        </div>
      </div>
    </div>
  );
}
