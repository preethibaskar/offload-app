// Add an invite-only user (no email is sent):
//   npm run invite -- someone@example.com
//
// Uses the SERVICE ROLE key — never commit it or expose it in the browser.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run invite -- someone@example.com");
  process.exit(1);
}

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data, error } = await supabaseAdmin.auth.admin.createUser({
  email,
  email_confirm: true,
});

if (error) {
  if (error.message?.toLowerCase().includes("already")) {
    console.error(`User already exists: ${email}`);
  } else {
    console.error("Failed to add user:", error.message);
  }
  process.exit(1);
}

console.log(`Added ${email} — no email sent. They can sign in at the app with this address.`);
console.log("User id:", data.user.id);
