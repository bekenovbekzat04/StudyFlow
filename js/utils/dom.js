export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function setVisible(element, visible) {
  if (element) element.classList.toggle("hidden", !visible);
}

export function showMessage(element, message, type = "success") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("hidden", !message);
  element.classList.toggle("error", type === "error");
}

const activeToasts = new Map();
const MAX_TOASTS = 3;

export function showToast(message, type = "info", duration = 3000) {
  const text = String(message || "").trim();
  if (!text) return;
  let region = document.getElementById("studyflow-toast-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "studyflow-toast-region";
    region.className = "toast-region";
    region.setAttribute("role", "region");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-relevant", "additions text");
    document.body.append(region);
  }
  const key = `${type}:${text}`;
  const existing = activeToasts.get(key);
  if (existing) {
    window.clearTimeout(existing.timeout);
    existing.timeout = window.setTimeout(() => removeToast(key), duration);
    return;
  }
  while (activeToasts.size >= MAX_TOASTS) removeToast(activeToasts.keys().next().value);
  const toast = document.createElement("div");
  toast.className = `studyflow-toast toast-${["success", "error", "info"].includes(type) ? type : "info"}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.textContent = text;
  region.append(toast);
  const timeout = window.setTimeout(() => removeToast(key), duration);
  activeToasts.set(key, { toast, timeout });
}

function removeToast(key) {
  const item = activeToasts.get(key);
  if (!item) return;
  window.clearTimeout(item.timeout);
  item.toast.remove();
  activeToasts.delete(key);
}

export function clearToasts() {
  for (const key of activeToasts.keys()) removeToast(key);
}

export function showFatal(message) {
  document.getElementById("app-loading")?.classList.add("hidden");
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText = "margin:24px;padding:18px;background:#fff;border:1px solid #f1b8b8;border-radius:10px;color:#8b3030;font:14px sans-serif";
  box.textContent = message;
  document.body.appendChild(box);
}
