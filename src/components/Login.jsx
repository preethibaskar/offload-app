import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";

// Accounts are created by an admin running `npm run invite -- email` (see
// scripts/invite.js). No email is sent. Sign-in checks the allowlist on the
// server and creates a session immediately if the address is registered.
export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | signing-in | error
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("signing-in");
    setErrorMsg("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus("error");
        setErrorMsg(
          data.error ||
            (response.status === 403
              ? "You haven't been invited yet. Ask the admin to add your email."
              : "Sign-in failed. Try again in a moment.")
        );
        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (error) {
        setStatus("error");
        console.error("[login]", error);
        setErrorMsg("Sign-in failed. Try again in a moment.");
        return;
      }
    } catch (err) {
      setStatus("error");
      console.error("[login]", err);
      setErrorMsg("Sign-in failed. Try again in a moment.");
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>Offload</h1>
        <p style={styles.sub}>Invite-only. Enter the email your admin added for you.</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputRow}>
            <Mail size={15} style={{ opacity: 0.5 }} />
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              disabled={status === "signing-in"}
            />
          </div>
          <button type="submit" disabled={status === "signing-in"} style={styles.button}>
            {status === "signing-in" ? (
              <span style={styles.buttonInner}>
                <Loader2 size={14} className="login-spin" />
                Signing in...
              </span>
            ) : (
              "Continue"
            )}
          </button>
          {status === "error" && <div style={styles.error}>{errorMsg}</div>}
        </form>
      </div>
      <style>{`
        @keyframes login-spin { to { transform: rotate(360deg); } }
        .login-spin { animation: login-spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f5f3ee",
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  },
  card: {
    background: "#fbfaf7",
    border: "1px solid #dedad0",
    borderRadius: 14,
    padding: "32px 28px",
    width: 340,
  },
  title: {
    fontFamily: "'Fraunces', Georgia, serif",
    fontWeight: 600,
    fontSize: 28,
    margin: "0 0 6px",
    color: "#21262b",
  },
  sub: { fontSize: 13.5, color: "#565f66", margin: "0 0 20px", lineHeight: 1.5 },
  form: { display: "flex", flexDirection: "column", gap: 10 },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #dedad0",
    borderRadius: 8,
    padding: "9px 12px",
    background: "#fff",
  },
  input: {
    border: "none",
    outline: "none",
    fontSize: 14,
    flex: 1,
    background: "transparent",
    fontFamily: "inherit",
  },
  button: {
    border: "none",
    background: "#21262b",
    color: "#f5f3ee",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  buttonInner: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  error: { color: "#b0503f", fontSize: 12.5, marginTop: 2 },
};
