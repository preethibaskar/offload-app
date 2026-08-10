import crypto from "crypto";

export function deriveLoginPassword(email, secret) {
  if (!secret) throw new Error("Missing login secret");
  const normalized = String(email || "").trim().toLowerCase();
  const hash = crypto.createHmac("sha256", secret).update(normalized).digest("hex");
  // Supabase requires a non-trivial password; suffix satisfies typical rules.
  return `${hash.slice(0, 48)}Aa1!`;
}
