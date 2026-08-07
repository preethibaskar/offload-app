// Run this from your own machine to invite someone:
//   npm run invite -- someone@example.com
//
// It uses the SERVICE ROLE key, which can do anything to your database and
// must NEVER be committed to git, put in VITE_-prefixed env vars, or used
// in any file that ships to the browser. It only belongs in your local
// .env (untracked) or in a secrets manager for a script you run yourself.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run invite -- someone@example.com");
  process.exit(1);
}

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);

if (error) {
  console.error("Failed to invite:", error.message);
  process.exit(1);
}

console.log(`Invited ${email}. They'll get an email with a sign-in link.`);
console.log("User id:", data.user.id);
