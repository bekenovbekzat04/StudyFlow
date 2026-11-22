export function escapeHTML(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

export function formatDue(date, language = "en") {
  if (!date) return "No date";
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? String(date)
    : parsed.toLocaleDateString(language === "kk" ? "kk-KZ" : language === "ru" ? "ru-RU" : "en-US", { month: "short", day: "numeric" });
}

export function normalizeStatus(value) {
  const status = String(value || "todo").toLowerCase().replace(/[\s-]+/g, "_");
  if (["progress", "in_progress", "in progress"].includes(status)) return "progress";
  return ["completed", "complete", "done"].includes(status) ? "completed" : "todo";
}

// The working database mapping is todo / progress / completed.
export function toDatabaseStatus(value) {
  return normalizeStatus(value);
}

export function normalizePriority(value) {
  const priority = String(value || "Medium").toLowerCase();
  return priority === "high" ? "High" : priority === "low" ? "Low" : "Medium";
}

export function validSubjectColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#7765e9";
}

export function getInitials(name, email) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
  return String(email || "?").slice(0, 1).toUpperCase();
}

export function getErrorMessage(error) {
  const message = error && error.message ? error.message : "Something went wrong. Please try again.";
  return message.replace(/^Error:\s*/i, "");
}

export function getAuthErrorKind(error) {
  const code = String(error?.code || error?.error_code || "").toLowerCase();
  const status = Number(error?.status);
  const message = String(error?.message || "").toLowerCase();
  if (["over_email_send_rate_limit", "over_sms_send_rate_limit", "rate_limit", "too_many_requests"].includes(code) ||
      status === 429 || message.includes("rate limit") || message.includes("too many requests")) return "rateLimited";
  if (["email_not_confirmed"].includes(code) ||
      message.includes("email not confirmed") || message.includes("confirm your email")) return "emailNotConfirmed";
  if (["invalid_credentials", "invalid_login_credentials"].includes(code) ||
      status === 400 && (message.includes("invalid login credentials") || message.includes("invalid credentials"))) return "invalidCredentials";
  if (["weak_password", "validation_failed"].includes(code)) return "weakPassword";
  if (["user_already_exists", "email_exists"].includes(code)) return "duplicateRegistration";
  if (message.includes("already been registered") || message.includes("already registered") || message.includes("user already exists")) return "duplicateRegistration";
  if (["otp_expired", "token_expired", "email_not_allowed", "bad_jwt", "session_not_found"].includes(code)) return "invalidRecovery";
  return "unknown";
}
