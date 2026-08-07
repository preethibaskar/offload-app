import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import Login from "./components/Login.jsx";
import Offload from "./components/Offload.jsx";
import { LogOut } from "lucide-react";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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
