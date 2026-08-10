/** Strip accidental newlines / duplicate pastes from Vercel env vars. */
export function sanitizeEnvValue(value) {
  if (value == null || value === "") return undefined;
  const first = String(value).trim().split(/\r?\n/)[0].trim();
  return first || undefined;
}
