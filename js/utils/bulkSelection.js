import { t } from "./i18n.js";

export function selectionCheckbox(taskId, title, checked = false) {
  const id = String(taskId).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const label = String(title).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<label class="bulk-select-control"><input type="checkbox" data-bulk-select="${id}" aria-label="${t("bulk.selectTask", { title: label })}"${checked ? " checked" : ""}><span aria-hidden="true"></span></label>`;
}

export function mountBulkSelectionControls(heading, { actions = ["complete", "archive"] } = {}) {
  const masterLabel = document.createElement("label");
  masterLabel.className = "bulk-select-all";
  masterLabel.innerHTML = `<input type="checkbox" data-bulk-select-all aria-label="${t("bulk.selectAll")}"><span>${t("bulk.selectAll")}</span>`;
  const resultCount = heading.querySelector("[id$='result-count']");
  heading.insertBefore(masterLabel, resultCount || null);
  const toolbar = document.createElement("div");
  toolbar.className = "bulk-toolbar hidden";
  toolbar.dataset.bulkToolbar = "";
  toolbar.innerHTML = `<span class="bulk-selected-count" data-bulk-count></span>${actions.map(action => { const attr = action.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`); const buttonClass = action === "archive" || action === "delete" ? "bulk-destructive-button" : action === "complete" ? "bulk-complete-button" : "secondary-button"; return `<button type="button" class="${buttonClass}" data-bulk-${attr}>${t(`bulk.${action === "delete" ? "deletePermanently" : action}`)}</button>`; }).join("")}<button type="button" class="bulk-clear-button" data-bulk-clear>${t("bulk.clear")}</button>`;
  const refresh = () => { masterLabel.querySelector("span").textContent = t("bulk.selectAll"); masterLabel.querySelector("input").setAttribute("aria-label", t("bulk.selectAll")); toolbar.querySelectorAll("button[data-bulk-restore],button[data-bulk-restore-completed],button[data-bulk-complete],button[data-bulk-archive],button[data-bulk-delete]").forEach(button => { const action = button.dataset.bulkRestoreCompleted !== undefined ? "restoreCompleted" : button.dataset.bulkDelete !== undefined ? "deletePermanently" : button.dataset.bulkRestore !== undefined ? "restore" : button.dataset.bulkComplete !== undefined ? "complete" : "archive"; button.textContent = t(`bulk.${action}`); }); toolbar.querySelector("[data-bulk-clear]").textContent = t("bulk.clear"); };
  refresh();
  heading.after(toolbar);
  return { toolbar, master: masterLabel.querySelector("input"), count: toolbar.querySelector("[data-bulk-count]"), refresh };
}

export function createBulkSelection({ root, list, toolbar, master, count, clearButton, onSelectionChange = () => {} }) {
  const selected = new Set();
  let visibleIds = [];
  let busy = false;

  function sync(ids = visibleIds) {
    visibleIds = [...new Set(ids.map(String))];
    const visible = new Set(visibleIds);
    selected.forEach(id => { if (!visible.has(id)) selected.delete(id); });
    toolbar.classList.toggle("hidden", selected.size === 0);
    count.textContent = t("bulk.selectedCount", { count: selected.size });
    const selectedVisible = visibleIds.filter(id => selected.has(id)).length;
    master.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
    master.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
    master.disabled = busy || visibleIds.length === 0;
    list.querySelectorAll("[data-bulk-select]").forEach(input => {
      const checked = selected.has(String(input.dataset.bulkSelect));
      input.checked = checked;
      input.disabled = busy;
      input.closest(".task-row,.archive-task-card")?.classList.toggle("is-bulk-selected", checked);
    });
    toolbar.querySelectorAll("button").forEach(button => { button.disabled = busy; });
    onSelectionChange([...selected]);
  }

  function deselect(ids) {
    ids.map(String).forEach(id => selected.delete(id));
    sync();
  }

  function clear() {
    selected.clear();
    sync();
  }

  function setBusy(value) {
    busy = Boolean(value);
    root.setAttribute("aria-busy", String(busy));
    sync();
  }

  root.addEventListener("change", event => {
    const input = event.target.closest("[data-bulk-select]");
    if (input) {
      const id = String(input.dataset.bulkSelect);
      if (input.checked && visibleIds.includes(id)) selected.add(id);
      else selected.delete(id);
      sync();
      return;
    }
    if (event.target === master) {
      if (master.checked) visibleIds.forEach(id => selected.add(id));
      else visibleIds.forEach(id => selected.delete(id));
      sync();
    }
  });
  root.addEventListener("click", event => {
    if (event.target.closest("[data-bulk-clear]")) clear();
  });

  return {
    sync,
    clear,
    deselect,
    setBusy,
    selectedIds: () => visibleIds.filter(id => selected.has(id)),
    destroy() { root.removeAttribute("aria-busy"); }
  };
}
