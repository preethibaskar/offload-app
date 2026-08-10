import { useState } from "react";
import { Mail, CheckCircle2 } from "lucide-react";
import { supabase } from "../supabaseClient";

// This screen deliberately has no "sign up" option. Accounts are created
// only by an admin running `npm run invite -- someone@example.com` (see
// scripts/invite.js), which uses Supabase's admin API to create the user
// and email them an invite link.
//
// `shouldCreateUser: false` below is the actual enforcement point: if
// someone who was never invited types their email in, Supabase refuses to
// send them a magic link at all, because no account exists for them and
// we've told it not to make one on the fly.
export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      setStatus("error");
      console.error("[login]", error);
      const msg = error.message?.toLowerCase() ?? "";
      if (
        error.code === "over_email_send_rate_limit" ||
        msg.includes("rate limit") ||
        msg.includes("only request this after")
      ) {
        setErrorMsg("Too many sign-in attempts — wait a few minutes, then try again.");
      } else if (msg.includes("redirect")) {
        setErrorMsg("Redirect URL not allowed. Add this site to Supabase → Auth → URL Configuration.");
      } else if (msg.includes("signups not allowed")) {
        setErrorMsg("No account for that email. Ask for an invite first.");
      } else {
        setErrorMsg("Couldn't send a link. If you were invited, try again in a moment.");
      }
      return;
    }
    setStatus("sent");
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>Offload</h1>
        <p style={styles.sub}>This is invite-only. Enter the email you were invited with.</p>

        {status === "sent" ? (
          <div style={styles.sentBox}>
            <CheckCircle2 size={18} />
            <span>Check your inbox for a sign-in link.</span>
          </div>
        ) : (
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
              />
            </div>
            <button type="submit" disabled={status === "sending"} style={styles.button}>
              {status === "sending" ? "Sending..." : "Send sign-in link"}
            </button>
            {status === "error" && <div style={styles.error}>{errorMsg}</div>}
          </form>
        )}
      </div>
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
  error: { color: "#b0503f", fontSize: 12.5, marginTop: 2 },
  sentBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "#2f6f62",
    fontSize: 14,
    background: "#e4efec",
    borderRadius: 8,
    padding: "10px 12px",
  },
};
