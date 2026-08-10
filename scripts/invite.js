// Add an invite-only user (no email is sent):
//   npm run invite -- someone@example.com
//
// Uses the SERVICE ROLE key — never commit it or expose it in the browser.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { deriveLoginPassword } from "../api/loginPassword.js";

dotenv.config();

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run invite -- someone@example.com");
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const loginSecret = process.env.LOGIN_SECRET?.trim() || serviceRoleKey;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

const password = deriveLoginPassword(email, loginSecret);

const { data, error } = await supabaseAdmin.auth.admin.createUser({
  email,
  email_confirm: true,
  password,
});

if (error) {
  if (error.message?.toLowerCase().includes("already")) {
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (listError) {
      console.error("Failed to list users:", listError.message);
      process.exit(1);
    }
    const existing = users.users.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      });
      if (updateError) {
        console.error("User exists but couldn't refresh login password:", updateError.message);
        process.exit(1);
      }
      console.log(`Updated login for ${email} — no email sent. They can sign in at the app.`);
      process.exit(0);
    }
    console.error(`User already exists: ${email}`);
  } else {
    console.error("Failed to add user:", error.message);
  }
  process.exit(1);
}

console.log(`Added ${email} — no email sent. They can sign in at the app with this address.`);
console.log("User id:", data.user.id);
