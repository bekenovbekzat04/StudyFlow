import { loadArchivedTasks, restoreTask, restoreTasks, permanentlyDeleteArchivedTask, permanentlyDeleteArchivedTasks } from "../services/tasks.service.js";
import { $, showToast } from "../utils/dom.js";
import { escapeHTML, formatDue, getErrorMessage, normalizePriority, normalizeStatus, validSubjectColor } from "../utils/helpers.js";
import { getLanguage, t } from "../utils/i18n.js";
import { createBulkSelection, mountBulkSelectionControls, selectionCheckbox } from "../utils/bulkSelection.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function initArchive({ state, onTaskRestored }) {
  const pageContent = $(".page-content");
  const view = document.createElement("section");
  view.id = "archive-page";
  view.className = "archive-page hidden";
  view.innerHTML = `<div class="archive-heading"><div><h1>${t("archive.title")}</h1><p>${t("archive.subtitle")}</p></div></div><label class="tasks-search-field archive-search"><span class="sr-only">${t("archive.searchLabel")}</span><input id="archive-search" type="search" placeholder="${t("archive.searchPlaceholder")}" aria-label="${t("archive.searchLabel")}"></label><div id="archive-loading" class="archive-loading hidden">${t("archive.loading")}</div><div id="archive-list" class="archive-list"></div><p id="archive-empty" class="archive-empty hidden">${t("archive.empty")}</p>`;
  pageContent.append(view);

  const loading = $("#archive-loading", view);
  const list = $("#archive-list", view);
  const empty = $("#archive-empty", view);
  const search = $("#archive-search", view);
  const archiveBulkHeading = document.createElement("div");
  archiveBulkHeading.className = "tasks-result-heading archive-result-heading";
  archiveBulkHeading.innerHTML = `<h2>${t("archive.title")}</h2><span id="archive-result-count"></span>`;
  list.before(archiveBulkHeading);
  const archiveBulkControls = mountBulkSelectionControls(archiveBulkHeading, { actions: ["restore", "restoreCompleted", "delete"] });
  const archiveBulk = createBulkSelection({ root: view, list, ...archiveBulkControls });
  let archiveQuery = "";
  let bulkBusy = false;
  let busyTaskId = null;
  let loadSequence = 0;
  let archiveVersion = 0;
  let loadFailed = false;
  let pendingLoad = null;
  let pendingLoadUserId = null;

  function mapRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
      subjectId: row.subject_id,
      title: row.title,
      description: row.description || "",
      dueDate: row.due_date,
      status: normalizeStatus(row.status),
      priority: normalizePriority(row.priority),
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      deletedSubjectName: row.deleted_subject_name || null,
      deletedSubjectColor: row.deleted_subject_color || null
    };
  }

  function locale() {
    return getLanguage() === "kk" ? "kk-KZ" : getLanguage() === "ru" ? "ru-RU" : "en-US";
  }

  function deletedDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return t("archive.invalidDate");
    return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function remainingLabel(value) {
    const deletedAt = new Date(value).getTime();
    if (!value || !Number.isFinite(deletedAt)) return t("archive.invalidDate");
    const remaining = Math.ceil((deletedAt + RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000));
    return remaining <= 0 ? t("archive.expiresToday") : t("archive.daysRemaining", { days: remaining });
  }

  function render() {
    const allTasks = state.archivedTasks || [];
    const filteredTasks = allTasks.filter(task => { const subjectName = task.deletedSubjectName || state.subjects.find(item => String(item.id) === String(task.subjectId))?.name || ""; return `${task.title} ${subjectName}`.toLocaleLowerCase().includes(archiveQuery); });
    list.innerHTML = filteredTasks.map(task => {
      const subject = state.subjects.find(item => String(item.id) === String(task.subjectId));
      const hasSubject = Boolean(task.deletedSubjectName || subject);
      const color = hasSubject ? validSubjectColor(task.deletedSubjectColor || subject?.color) : "#ffffff";
      const subjectDotClass = !hasSubject ? "is-no-subject-dot" : color.toLowerCase() === "#ffffff" ? "is-white-subject-dot" : "";
      const dueLabel = task.dueDate ? formatDue(task.dueDate, getLanguage()) : t("tasks.noDate");
      const disabled = String(busyTaskId) === String(task.id) ? " disabled" : "";
      return `<article class="archive-task-card">${selectionCheckbox(task.id, task.title)}<div class="archive-task-copy"><h2>${escapeHTML(task.title)}</h2><p class="archive-task-subject"><span class="archive-subject-dot ${subjectDotClass}" style="background-color:${color}"></span><span class="task-subject-chip ${hasSubject ? "" : "task-no-subject"}">${escapeHTML(task.deletedSubjectName || subject?.name || t("tasks.noSubject"))}</span><span aria-hidden="true">·</span>${escapeHTML(dueLabel)}</p><div class="archive-task-meta"><span class="priority ${escapeHTML(task.priority)}">${t(`tasks.${task.priority.toLowerCase()}`)}</span><time>${escapeHTML(t("archive.deletedAt", { date: deletedDate(task.deletedAt) }))}</time></div><p class="archive-retention">${escapeHTML(remainingLabel(task.deletedAt))}</p></div><div class="archive-task-actions"><button type="button" class="secondary-button" data-archive-restore="${escapeHTML(task.id)}"${disabled}>${t("archive.restore")}</button><button type="button" class="archive-delete-button" data-archive-delete="${escapeHTML(task.id)}"${disabled}>${t("archive.deletePermanently")}</button></div></article>`;
    }).join("");
    empty.textContent = allTasks.length ? t("archive.noMatches") : t("archive.empty");
    empty.classList.toggle("hidden", (allTasks.length > 0 && filteredTasks.length > 0) || loading.classList.contains("visible") || loadFailed);
    list.classList.toggle("hidden", filteredTasks.length === 0);
    $("#archive-result-count", view).textContent = t("archive.resultCount", { count: filteredTasks.length });
    archiveBulk.sync(filteredTasks.map(task => String(task.id)));
  }

  async function load() {
    const userId = state.user?.id;
    if (!userId) return;
    if (state.archiveLoadedFor === userId) {
      render();
      return;
    }
    if (pendingLoad && pendingLoadUserId === userId) return pendingLoad;
    const sequence = ++loadSequence;
    const version = archiveVersion;
    pendingLoadUserId = userId;
    loadFailed = false;
    loading.textContent = t("archive.loading");
    loading.classList.remove("hidden");
    loading.classList.add("visible");
    list.classList.add("hidden");
    empty.classList.add("hidden");
    const operation = (async () => {
      try {
        const rows = await loadArchivedTasks(userId);
        if (sequence !== loadSequence || state.user?.id !== userId) return;
        const localRows = state.archivedTasks || [];
        state.archivedTasks = rows.map(mapRow);
        if (version !== archiveVersion) {
          const byId = new Map(state.archivedTasks.map(task => [String(task.id), task]));
          localRows.forEach(task => byId.set(String(task.id), task));
          state.archivedTasks = Array.from(byId.values()).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
        }
        state.archiveLoadedFor = userId;
        loadFailed = false;
        render();
      } catch (error) {
        if (sequence !== loadSequence || state.user?.id !== userId) return;
        showToast(t("archive.loadError", { error: getErrorMessage(error) }), "error");
        state.archivedTasks = [];
        loadFailed = true;
        render();
      } finally {
        if (sequence === loadSequence) {
          loading.classList.remove("visible");
          loading.classList.add("hidden");
          pendingLoad = null;
          pendingLoadUserId = null;
          render();
        }
      }
    })();
    pendingLoad = operation;
    return operation;
  }

  async function runBulkAction(action) {
    if (bulkBusy || busyTaskId !== null || !state.user) return;
    const ids = archiveBulk.selectedIds();
    if (!ids.length) return;
    if (action === "delete" && !window.confirm(t("bulk.confirmPermanent", { count: ids.length }))) return;
    const userId = state.user.id;
    bulkBusy = true;
    archiveBulk.setBusy(true);
    try {
      if (action === "delete") {
        const rows = await permanentlyDeleteArchivedTasks(userId, ids);
        if (state.user?.id !== userId) return;
        const removed = new Set(rows.map(row => String(row.id)));
        state.archivedTasks = state.archivedTasks.filter(task => !removed.has(String(task.id)));
        archiveVersion += 1;
        archiveBulk.clear();
        const failed = ids.length - rows.length;
        showToast(failed ? t("bulk.partial", { succeeded: rows.length, failed }) : t("bulk.successDeleted", { count: rows.length }), failed ? "error" : "success");
      } else {
        const result = await restoreTasks(userId, ids, { completed: action === "restoreCompleted" });
        if (state.user?.id !== userId) return;
        const restoredIds = new Set(result.rows.map(row => String(row.id)));
        state.archivedTasks = state.archivedTasks.filter(task => !restoredIds.has(String(task.id)));
        archiveVersion += 1;
        result.subjects.forEach(subject => { if (!state.subjects.some(item => String(item.id) === String(subject.id))) state.subjects.push(subject); });
        state.subjects.sort((a, b) => a.name.localeCompare(b.name));
        await onTaskRestored(result.rows);
        archiveBulk.clear();
        let message = t(action === "restoreCompleted" ? "bulk.successRestoredCompleted" : "bulk.successRestored", { count: result.rows.length });
        if (result.recreatedSubjectCount) message += ` ${t("bulk.restoreSubjectRecreated")}`;
        else if (result.rows.some(row => row.subject_id)) message += ` ${t("bulk.restoreSubject")}`;
        showToast(message, "success");
      }
    } catch (error) {
      if (state.user?.id !== userId) return;
      const key = action === "delete" ? "archive.deleteError" : "archive.restoreError";
      showToast(t(key, { error: getErrorMessage(error) }), "error");
    } finally {
      bulkBusy = false;
      archiveBulk.setBusy(false);
      render();
    }
  }
  async function restore(id) {
    if (busyTaskId !== null || bulkBusy || !state.user) return;
    const userId = state.user.id;
    busyTaskId = id;
    render();
    try {
      const row = await restoreTask(userId, id);
      if (state.user?.id !== userId) return;
      archiveVersion += 1;
      state.archivedTasks = state.archivedTasks.filter(task => String(task.id) !== String(id));
      (row._restoredSubjects || []).forEach(subject => { if (!state.subjects.some(item => String(item.id) === String(subject.id))) state.subjects.push(subject); });
      state.subjects.sort((a, b) => a.name.localeCompare(b.name));
      showToast(row._subjectRecreated ? t("bulk.restoreSubjectRecreated") : row.subject_id ? t("bulk.restoreSubject") : t("archive.restoreSuccess"), "success");
      await onTaskRestored(row);
    } catch (error) {
      if (state.user?.id !== userId) return;
      showToast(t("archive.restoreError", { error: getErrorMessage(error) }), "error");
    } finally {
      busyTaskId = null;
      render();
    }
  }

  async function removePermanently(id) {
    if (busyTaskId !== null || bulkBusy || !state.user) return;
    const task = state.archivedTasks.find(item => String(item.id) === String(id));
    if (bulkBusy || !task || !window.confirm(t("archive.deleteConfirm", { title: task.title }))) return;
    const userId = state.user.id;
    busyTaskId = id;
    render();
    try {
      await permanentlyDeleteArchivedTask(userId, id);
      if (state.user?.id !== userId) return;
      archiveVersion += 1;
      state.archivedTasks = state.archivedTasks.filter(item => String(item.id) !== String(id));
      showToast(t("archive.deleteSuccess"), "success");
    } catch (error) {
      if (state.user?.id !== userId) return;
      showToast(t("archive.deleteError", { error: getErrorMessage(error) }), "error");
    } finally {
      busyTaskId = null;
      render();
    }
  }

  function onTasksArchived(rows) {
    if (!state.user || !rows.length) return;
    archiveVersion += 1;
    const current = state.archiveLoadedFor === state.user.id ? state.archivedTasks : [];
    const byId = new Map(current.map(task => [String(task.id), task]));
    rows.forEach(row => { const archived = mapRow(row); byId.set(String(archived.id), archived); });
    state.archivedTasks = Array.from(byId.values()).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    render();
  }
  function onTaskArchived(row) {
    if (!state.user) return;
    archiveVersion += 1;
    const archived = mapRow(row);
    const current = state.archiveLoadedFor === state.user.id ? state.archivedTasks : [];
    state.archivedTasks = [archived, ...current.filter(task => String(task.id) !== String(archived.id))]
      .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    render();
  }

  function reset() {
    loadSequence += 1;
    archiveVersion += 1;
    pendingLoad = null;
    pendingLoadUserId = null;
    state.archivedTasks = [];
    state.archiveLoadedFor = null;
    loadFailed = false;
    view.classList.add("hidden");
    render();
  }

  function refreshLanguage() {
    search.placeholder = t("archive.searchPlaceholder");
    search.setAttribute("aria-label", t("archive.searchLabel"));
    archiveBulkHeading.querySelector("h2").textContent = t("archive.title");
    archiveBulkControls.refresh();
    view.querySelector("h1").textContent = t("archive.title");
    view.querySelector(".archive-heading p").textContent = t("archive.subtitle");
    loading.textContent = t("archive.loading");
    render();
  }

  function destroy() {
    loadSequence += 1;
    list.removeEventListener("click", handleListClick);
    view.remove();
  }

  // Use one delegated listener for all archive actions.
  function handleListClick(event) {
    const restoreButton = event.target.closest("[data-archive-restore]");
    if (restoreButton) {
      restore(restoreButton.dataset.archiveRestore);
      return;
    }
    const deleteButton = event.target.closest("[data-archive-delete]");
    if (deleteButton) removePermanently(deleteButton.dataset.archiveDelete);
  }
  list.addEventListener("click", handleListClick);
  search.addEventListener("input", () => { archiveQuery = search.value.trim().toLocaleLowerCase(); render(); });
  view.addEventListener("click", event => {
    if (event.target.closest("[data-bulk-restore]")) runBulkAction("restore");
    else if (event.target.closest("[data-bulk-restore-completed]")) {
      const ids = archiveBulk.selectedIds();
      if (ids.length && window.confirm(t("bulk.confirmRestoreCompleted", { count: ids.length }))) runBulkAction("restoreCompleted");
    } else if (event.target.closest("[data-bulk-delete]")) runBulkAction("delete");
  });

  return { view, load, render, onTaskArchived, onTasksArchived, reset, refreshLanguage, destroy };
}
