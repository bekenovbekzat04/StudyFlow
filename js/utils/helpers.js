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
