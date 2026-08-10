import { useEffect, useState } from "react";
import { supabase, supabaseConfigError } from "./supabaseClient";
import Login from "./components/Login.jsx";
import Offload from "./components/Offload.jsx";
import { LogOut } from "lucide-react";

function ConfigError({ message }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f3ee",
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#fbfaf7",
          border: "1px solid #dedad0",
          borderRadius: 14,
          padding: "28px 24px",
          maxWidth: 480,
          color: "#21262b",
        }}
      >
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, margin: "0 0 12px" }}>
          Configuration error
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "#565f66", margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (supabaseConfigError) {
    return <ConfigError message={supabaseConfigError} />;
  }

  if (session === undefined) {
    return <div style={{ padding: 40, fontFamily: "system-ui" }}>Loading...</div>;
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "10px 20px 0",
          maxWidth: 980,
          margin: "0 auto",
        }}
      >
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: "none",
            background: "none",
            color: "#565f66",
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          <LogOut size={13} /> Sign out ({session.user.email})
        </button>
      </div>
      <Offload />
    </div>
  );
}
