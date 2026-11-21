import { createTask, updateTask, updateTaskStatus, archiveTask, archiveTasks, updateTasksStatus, loadTasks } from "../services/tasks.service.js";
import { resolveTaskSubject } from "../services/subjects.service.js";
import { $, $$ } from "../utils/dom.js";
import { enhanceFilterDropdown } from "../utils/filterDropdown.js";
import { createBulkSelection, mountBulkSelectionControls, selectionCheckbox } from "../utils/bulkSelection.js";
import { escapeHTML, formatDue, normalizePriority, normalizeStatus, validSubjectColor, getErrorMessage } from "../utils/helpers.js";
import { t, getLanguage } from "../utils/i18n.js";

function taskIcon(name) {
  const paths = {
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    check: '<path d="m5 12 4 4L19 6"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path>',
    delete: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"></path>'
  };
  return `<svg class="task-icon task-icon-${name}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hasValidDueDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function getOverdueTasks(tasks, today = localDateKey()) {
  return tasks.filter(task =>
    task.deletedAt == null && task.status !== "completed" &&
    typeof task.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) && task.dueDate < today
  ).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.title).localeCompare(String(b.title), getLanguage() === "kk" ? "kk-KZ" : getLanguage() === "ru" ? "ru-RU" : "en-US"));
}

export function initTasks({ state, onDataChanged, notify }) {
  const pageContent = $(".page-content");
  const globalSearch = $("#global-search");
  const searchResults = $("#global-search-results");
  const topbarSearch = $(".topbar-search");
  const view = document.createElement("section");
  view.id = "tasks-page";
  view.className = "tasks-workspace hidden";
  view.innerHTML = `<div class="tasks-workspace-heading"><div><span class="eyebrow">${t("layout.workspace")}</span><h1>${t("tasks.workspaceTitle")}</h1><p>${t("tasks.workspaceSubtitle")}</p><div class="task-status-tabs" role="tablist" aria-label="${t("tasks.taskViews")}"><button type="button" role="tab" id="tasks-tab-active" aria-controls="task-list" aria-selected="true" data-task-tab="active"><span>${t("tasks.activeTab")}</span><span class="task-tab-count" data-task-tab-count="active">0</span></button><button type="button" role="tab" id="tasks-tab-completed" aria-controls="task-list" aria-selected="false" data-task-tab="completed" tabindex="-1"><span>${t("tasks.completedTab")}</span><span class="task-tab-count" data-task-tab-count="completed">0</span></button></div></div><button type="button" class="primary-button" id="tasks-add-task">${taskIcon("plus")}<span class="tasks-add-label">${t("tasks.add")}</span></button></div><div class="tasks-workspace-toolbar"><label class="tasks-search-field">${taskIcon("search")}<input id="task-workspace-search" type="search" placeholder="${t("layout.search")}" aria-label="${t("layout.searchLabel")}"></label><div class="tasks-filter-field"><span>${t("tasks.subject")}</span><select id="task-subject-filter" aria-label="${t("tasks.subjectFilter")}"></select></div><div class="tasks-filter-field"><span>${t("tasks.status")}</span><select id="task-status-filter" aria-label="${t("tasks.statusFilter")}"></select></div><div class="tasks-filter-field"><span>${t("tasks.priority")}</span><select id="task-priority-filter" aria-label="${t("tasks.priorityFilter")}"></select></div><label class="tasks-filter-field"><span>${t("tasks.sortLabel")}</span><select id="task-sort-order" aria-label="${t("tasks.sortLabel")}"></select></label></div><section class="panel tasks-workspace-list-panel"><div class="tasks-result-heading"><h2>${t("tasks.workspaceListTitle")}</h2><span id="tasks-result-count"></span></div><div class="task-list" id="task-list" role="tabpanel" aria-labelledby="tasks-tab-active" tabindex="0"></div><div class="empty-state hidden" id="empty-state" aria-live="polite"></div></section>`;
  pageContent.append(view);
  const list = $("#task-list", view);
  const overdueView = document.createElement("section");
  overdueView.id = "overdue-page";
  overdueView.className = "tasks-workspace overdue-workspace hidden";
  overdueView.innerHTML = `<div class="tasks-workspace-heading"><div><span class="eyebrow">${t("layout.workspace")}</span><h1>${t("overdue.title")}</h1><p>${t("overdue.subtitle")}</p></div></div><div class="tasks-workspace-toolbar"><label class="tasks-search-field">${taskIcon("search")}<input id="overdue-search" type="search" placeholder="${t("overdue.searchPlaceholder")}" aria-label="${t("overdue.searchLabel")}"></label><div class="tasks-filter-field"><span>${t("overdue.subject")}</span><select id="overdue-subject-filter" aria-label="${t("tasks.subjectFilter")}"></select></div><div class="tasks-filter-field"><span>${t("overdue.priority")}</span><select id="overdue-priority-filter" aria-label="${t("tasks.priorityFilter")}"></select></div></div><section class="panel tasks-workspace-list-panel"><div class="tasks-result-heading"><h2>${t("overdue.listTitle")}</h2><span id="overdue-result-count"></span></div><div class="task-list" id="overdue-task-list"></div><div class="empty-state hidden" id="overdue-empty-state" aria-live="polite"></div></section>`;
  pageContent.append(overdueView);
  const overdueList = $("#overdue-task-list", overdueView);
  const overdueSearch = $("#overdue-search", overdueView);
  const overdueSubjectFilter = $("#overdue-subject-filter", overdueView);
  const overduePriorityFilter = $("#overdue-priority-filter", overdueView);
  const overdueEmpty = $("#overdue-empty-state", overdueView);
  const overdueResultCount = $("#overdue-result-count", overdueView);
  const taskBulkControls = mountBulkSelectionControls($(".tasks-result-heading", view));
  const overdueBulkControls = mountBulkSelectionControls($(".tasks-result-heading", overdueView));
  const taskBulk = createBulkSelection({ root: view, list, ...taskBulkControls });
  const overdueBulk = createBulkSelection({ root: overdueView, list: overdueList, ...overdueBulkControls });
  const subjectDropdown = enhanceFilterDropdown($("#task-subject-filter", view), {
    variant: "subject",
    getMeta: value => { const subject = state.subjects.find(item => String(item.id) === value); return subject ? { color: validSubjectColor(subject.color) } : value === "none" ? { color: "#ffffff", className: "no-subject" } : null; }
  });
  const statusDropdown = enhanceFilterDropdown($("#task-status-filter", view), { variant: "status", getMeta: value => ({ className: value }) });
  const priorityDropdown = enhanceFilterDropdown($("#task-priority-filter", view), { variant: "priority", getMeta: value => ({ className: value }) });
  const overdueSubjectDropdown = enhanceFilterDropdown(overdueSubjectFilter, {
    variant: "subject",
    getMeta: value => { const subject = state.subjects.find(item => String(item.id) === value); return subject ? { color: validSubjectColor(subject.color) } : value === "none" ? { color: "#ffffff", className: "no-subject" } : null; }
  });
  const overduePriorityDropdown = enhanceFilterDropdown(overduePriorityFilter, { variant: "priority", getMeta: value => ({ className: value }) });
  let visibleTaskIds = [];
  let visibleOverdueIds = [];
  let taskTab = "active";
  let taskSortOrder = "due-earliest";
  let overdueSubject = "all";
  let overduePriority = "all";
  let tasksLoading = false;
  let tasksLoadError = null;
  const dialog = $("#task-dialog");
  const form = $("#task-form");
  let editingTaskId = null;
  let busy = false;

  function mapRow(row) {
    const subject = state.subjects.find(item => String(item.id) === String(row.subject_id));
    return {
      id: row.id,
      title: row.title,
      description: row.description || "",
      subjectId: row.subject_id,
      subject: subject?.name || null,
      dueDate: row.due_date,
      createdAt: row.created_at,
      priority: normalizePriority(row.priority),
      status: normalizeStatus(row.status),
      deletedAt: row.deleted_at || null
    };
  }

  function syncSubjectNames({ renderAfter = true } = {}) {
    const subjectsById = new Map(state.subjects.map(subject => [String(subject.id), subject.name]));
    state.tasks.forEach(task => { task.subject = subjectsById.get(String(task.subjectId)) || null; });
    if (renderAfter) render();
  }

  function applyRow(row, isNew = false) {
    const task = mapRow(row);
    const index = state.tasks.findIndex(item => String(item.id) === String(task.id));
    if (index >= 0) state.tasks[index] = task;
    else if (isNew) state.tasks.unshift(task);
    return task;
  }

  function populateSubjectSelect(selectedId = "") {
    const select = $("#task-subject");
    select.innerHTML = `<option value="">${t("tasks.noSubject")}</option>` + state.subjects
      .map(subject => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join("");
    select.value = selectedId == null ? "" : String(selectedId);
  }

  function populateFilters() {
    const subjectFilter = $("#task-subject-filter", view);
    const selectedSubject = state.taskSubjectFilter || "all";
    subjectFilter.innerHTML = `<option value="all">${t("tasks.allSubjects")}</option><option value="none">${t("tasks.noSubject")}</option>` + state.subjects
      .map(subject => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join("");
    const subjectExists = selectedSubject === "all" || selectedSubject === "none" || state.subjects.some(subject => String(subject.id) === selectedSubject);
    if (!subjectExists) state.taskSubjectFilter = "all";
    subjectFilter.value = state.taskSubjectFilter || "all";
    const statusFilter = $("#task-status-filter", view);
    const statusOptions = taskTab === "completed" ? [["completed", t("tasks.completed")]] : [["todo", t("tasks.toDo")], ["progress", t("tasks.inProgress")]];
    if (state.activeFilter !== "all" && !statusOptions.some(([value]) => value === state.activeFilter)) state.activeFilter = "all";
    statusFilter.innerHTML = `<option value="all">${t("tasks.allStatuses")}</option>` + statusOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    statusFilter.value = state.activeFilter || "all";
    const priorityFilter = $("#task-priority-filter", view);
    priorityFilter.innerHTML = `<option value="all">${t("tasks.allPriorities")}</option><option value="Low">${t("tasks.low")}</option><option value="Medium">${t("tasks.medium")}</option><option value="High">${t("tasks.high")}</option>`;
    priorityFilter.value = state.taskPriorityFilter || "all";
    subjectDropdown.refresh();
    statusDropdown.refresh();
    priorityDropdown.refresh();
    populateSortOptions();
  }

  function populateSortOptions() {
    const select = $("#task-sort-order", view);
    const value = taskSortOrder;
    select.innerHTML = `<option value="due-earliest">${t("tasks.sortDueEarliest")}</option><option value="due-latest">${t("tasks.sortDueLatest")}</option><option value="created-recent">${t("tasks.sortRecentlyCreated")}</option><option value="created-oldest">${t("tasks.sortOldestCreated")}</option>`;
    select.value = value;
  }

  function sortTaskResults(tasks) {
    const dueOrder = taskSortOrder === "due-latest" ? -1 : 1;
    const createdOrder = taskSortOrder === "created-oldest" ? 1 : -1;
    return tasks.map((task, index) => ({ task, index })).sort((a, b) => {
      let comparison = 0;
      if (taskSortOrder === "due-earliest" || taskSortOrder === "due-latest") {
        const aHasDate = hasValidDueDate(a.task.dueDate);
        const bHasDate = hasValidDueDate(b.task.dueDate);
        if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
        if (aHasDate) comparison = String(a.task.dueDate).localeCompare(String(b.task.dueDate)) * dueOrder;
        if (comparison === 0 && aHasDate) {
          const priorityOrder = { High: 0, Medium: 1, Low: 2 };
          comparison = priorityOrder[a.task.priority] - priorityOrder[b.task.priority];
        }
      } else {
        const aCreated = Date.parse(a.task.createdAt || "") || 0;
        const bCreated = Date.parse(b.task.createdAt || "") || 0;
        comparison = (aCreated - bCreated) * createdOrder;
      }
      return comparison || a.index - b.index;
    }).map(item => item.task);
  }

  function populateOverdueFilters() {
    const selectedSubject = overdueSubject;
    overdueSubjectFilter.innerHTML = `<option value="all">${t("overdue.allSubjects")}</option><option value="none">${t("tasks.noSubject")}</option>` + state.subjects
      .map(subject => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join("");
    overdueSubject = selectedSubject === "all" || selectedSubject === "none" || state.subjects.some(subject => String(subject.id) === selectedSubject) ? selectedSubject : "all";
    overdueSubjectFilter.value = overdueSubject;
    overduePriorityFilter.innerHTML = `<option value="all">${t("overdue.allPriorities")}</option><option value="Low">${t("tasks.low")}</option><option value="Medium">${t("tasks.medium")}</option><option value="High">${t("tasks.high")}</option>`;
    overduePriorityFilter.value = overduePriority;
    overdueSubjectDropdown.refresh();
    overduePriorityDropdown.refresh();
  }

  function renderTaskRows(tasks) {
    return tasks.map(task => {
      const subject = state.subjects.find(item => String(item.id) === String(task.subjectId));
      const subjectColor = subject ? validSubjectColor(subject.color) : "#ffffff";
      const whiteSubjectColor = Boolean(subject && subjectColor.toLowerCase() === "#ffffff");
      const statusKey = task.status === "completed" ? "tasks.completed" : task.status === "progress" ? "tasks.inProgress" : "tasks.toDo";
      return `
      <article class="task-row task-workspace-row ${task.status === "completed" ? "task-completed" : ""} ${hasValidDueDate(task.dueDate) ? "task-has-deadline" : ""}">
        ${selectionCheckbox(task.id, task.title)}
        <div class="task-main"><button type="button" class="task-title task-open-button" data-open-task="${escapeHTML(task.id)}" aria-label="${escapeHTML(t("tasks.openTask", { title: task.title }))}">${escapeHTML(task.title)}</button>${task.description ? `<span class="task-description-preview">${escapeHTML(task.description)}</span>` : ""}<div class="task-meta"><i class="subject-dot ${subject ? whiteSubjectColor ? "is-white-subject-dot" : "" : "is-no-subject-dot"}" style="background-color:${subjectColor}"></i><span class="task-subject-name ${subject ? "" : "task-no-subject"}">${escapeHTML(subject?.name || t("tasks.noSubject"))}</span><span class="task-meta-divider" aria-hidden="true">·</span><span class="task-due-date">${escapeHTML(hasValidDueDate(task.dueDate) ? formatDue(task.dueDate, getLanguage()) : t("tasks.noDate"))}</span></div></div>
        <div class="task-right"><span class="priority ${escapeHTML(task.priority)}">${t(`tasks.${task.priority.toLowerCase()}`)}</span><select class="status-select status-${escapeHTML(task.status)}" data-status="${escapeHTML(task.id)}" aria-label="${t("tasks.status")}"><option value="todo" ${task.status === "todo" ? "selected" : ""}>${t("tasks.toDo")}</option><option value="progress" ${task.status === "progress" ? "selected" : ""}>${t("tasks.inProgress")}</option><option value="completed" ${task.status === "completed" ? "selected" : ""}>${t("tasks.completed")}</option></select><div class="task-actions"><button type="button" class="task-action" data-edit="${escapeHTML(task.id)}">${taskIcon("edit")}<span>${t("tasks.edit")}</span></button><button type="button" class="task-action delete" data-delete="${escapeHTML(task.id)}">${taskIcon("delete")}<span>${t("tasks.delete")}</span></button></div><span class="task-status-label">${t(statusKey)}</span></div>
      </article>`;
    }).join("");
  }

  function renderOverdue() {
    populateOverdueFilters();
    if (tasksLoading) {
      overdueList.innerHTML = "";
      visibleOverdueIds = [];
      overdueBulk.sync(visibleOverdueIds);
      overdueEmpty.textContent = t("overdue.loading");
      overdueEmpty.classList.remove("hidden");
      overdueResultCount.textContent = t("overdue.resultCount", { count: 0 });
      return;
    }
    if (tasksLoadError) {
      overdueList.innerHTML = "";
      visibleOverdueIds = [];
      overdueBulk.sync(visibleOverdueIds);
      overdueEmpty.textContent = t("overdue.error", { error: tasksLoadError });
      overdueEmpty.classList.remove("hidden");
      overdueResultCount.textContent = t("overdue.resultCount", { count: 0 });
      return;
    }
    const overdueTasks = getOverdueTasks(state.tasks);
    const query = overdueSearch.value.trim().toLocaleLowerCase();
    const filtered = overdueTasks.filter(task =>
      (overdueSubject === "all" || (overdueSubject === "none" ? task.subjectId == null : String(task.subjectId) === overdueSubject)) &&
      (overduePriority === "all" || task.priority === overduePriority) &&
      `${task.title} ${task.subject || t("tasks.noSubject")}`.toLocaleLowerCase().includes(query)
    );
    overdueList.innerHTML = renderTaskRows(filtered);
    visibleOverdueIds = filtered.map(task => String(task.id));
    overdueBulk.sync(visibleOverdueIds);
    overdueEmpty.textContent = overdueTasks.length ? t("overdue.noMatches") : t("overdue.empty");
    overdueEmpty.classList.toggle("hidden", filtered.length > 0);
    overdueResultCount.textContent = t("overdue.resultCount", { count: filtered.length });
  }

  function renderSearchResults(value = globalSearch.value) {
    const query = String(value || "").trim().toLocaleLowerCase();
    if (!query) {
      searchResults.innerHTML = "";
      searchResults.classList.add("hidden");
      globalSearch.setAttribute("aria-expanded", "false");
      return;
    }
    const matches = state.tasks.filter(task =>
      `${task.title} ${task.subject || t("tasks.noSubject")}`.toLocaleLowerCase().includes(query)
    ).slice(0, 7);
    searchResults.innerHTML = matches.length ? matches.map(task => {
      const subject = task.subject || t("tasks.noSubject");
      const due = task.dueDate ? formatDue(task.dueDate, getLanguage()) : t("tasks.noDate");
      return `<button type="button" class="global-search-result" role="option" data-search-task="${escapeHTML(task.id)}"><strong>${escapeHTML(task.title)}</strong><small>${escapeHTML(subject)} · ${escapeHTML(due)}</small></button>`;
    }).join("") : `<p class="global-search-empty">${t("tasks.noMatch")}</p>`;
    searchResults.classList.remove("hidden");
    globalSearch.setAttribute("aria-expanded", "true");
  }

  function closeSearchResults() {
    searchResults.classList.add("hidden");
    globalSearch.setAttribute("aria-expanded", "false");
  }

  async function load({ reportError = true, renderAfter = true } = {}) {
    if (!state.user) return;
    const userId = state.user.id;
    taskBulk.clear();
    overdueBulk.clear();
    tasksLoading = true;
    tasksLoadError = null;
    list.innerHTML = `<div class="empty-state">${t("tasks.loading")}</div>`;
    renderOverdue();
    try {
      const rows = await loadTasks(userId);
      if (state.user?.id !== userId) return;
      state.tasks = rows.map(mapRow);
      tasksLoading = false;
      tasksLoadError = null;
      populateSubjectSelect($("#task-subject").value);
      populateFilters();
      if (renderAfter) render();
    } catch (error) {
      if (state.user?.id !== userId) return;
      state.tasks = [];
      tasksLoading = false;
      tasksLoadError = getErrorMessage(error);
      if (renderAfter) render();
      if (reportError) notify(t("tasks.loadError", { error: getErrorMessage(error) }), true);
    }
  }

  function render() {
    populateFilters();
    const workspaceSearch = $("#task-workspace-search", view);
    if (workspaceSearch.value !== state.searchTerm) workspaceSearch.value = state.searchTerm;
    const activeCount = state.tasks.filter(task => task.status !== "completed").length;
    const completedCount = state.tasks.filter(task => task.status === "completed").length;
    $("[data-task-tab-count='active']", view).textContent = activeCount;
    $("[data-task-tab-count='completed']", view).textContent = completedCount;
    view.querySelectorAll("[data-task-tab]").forEach(tab => {
      const selected = tab.dataset.taskTab === taskTab;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    list.setAttribute("aria-labelledby", taskTab === "active" ? "tasks-tab-active" : "tasks-tab-completed");
    const completeAction = taskBulkControls.toolbar.querySelector("[data-bulk-complete]");
    if (completeAction) {
      completeAction.textContent = t(taskTab === "completed" ? "tasks.returnSelectedActive" : "bulk.complete");
      completeAction.classList.toggle("bulk-return-button", taskTab === "completed");
    }
    const filtered = sortTaskResults(state.tasks.filter(task =>
      (taskTab === "completed" ? task.status === "completed" : task.status !== "completed") &&
      (state.activeFilter === "all" || task.status === state.activeFilter) &&
      (state.taskSubjectFilter === "all" || (state.taskSubjectFilter === "none" ? task.subjectId == null : String(task.subjectId) === state.taskSubjectFilter)) &&
      (state.taskPriorityFilter === "all" || task.priority === state.taskPriorityFilter) &&
      `${task.title} ${task.subject || t("tasks.noSubject")}`.toLocaleLowerCase().includes(state.searchTerm)
    ));
    list.innerHTML = renderTaskRows(filtered);
    visibleTaskIds = filtered.map(task => String(task.id));
    taskBulk.sync(visibleTaskIds);

    const empty = $("#empty-state", view);
    empty.textContent = filtered.length ? "" : taskTab === "completed"
      ? t(completedCount === 0 ? "tasks.noCompletedTasks" : "tasks.noMatch")
      : !state.tasks.length ? t("tasks.empty")
        : t(activeCount === 0 ? "tasks.noActiveTasks" : "tasks.noMatch");
    empty.classList.toggle("hidden", filtered.length > 0);
    $("#tasks-result-count", view).textContent = t("tasks.resultCount", { count: filtered.length });
    const completed = state.tasks.filter(task => task.status === "completed").length;
    const doing = state.tasks.filter(task => task.status === "progress").length;
    const todo = state.tasks.filter(task => task.status === "todo").length;
    $("#total-tasks").textContent = state.tasks.length;
    $("#completed-tasks").textContent = completed;
    $("#pending-tasks").textContent = doing + todo;
    $("#nav-task-count").textContent = state.tasks.length;
    $("#legend-done").textContent = completed;
    $("#legend-doing").textContent = doing;
    $("#legend-todo").textContent = todo;
    const percent = state.tasks.length ? Math.round(completed / state.tasks.length * 100) : 0;
    $("#progress-percent").textContent = `${percent}%`;
    const donut = $(".donut");
    if (donut) donut.style.background = `conic-gradient(#2e9c73 0 ${percent}%, #8db4e8 ${percent}% ${Math.min(percent + (state.tasks.length ? doing / state.tasks.length * 100 : 0), 100)}%, #e8e9ef 0 100%)`;
    if (!searchResults.classList.contains("hidden")) renderSearchResults(globalSearch.value);
    renderOverdue();
  }

  function openDialog(task = null, { dueToday = false } = {}) {
    form.reset();
    editingTaskId = task ? task.id : null;
    populateSubjectSelect(task?.subjectId ?? "");
    $("#task-title").setCustomValidity("");
    $("#task-dialog-title").textContent = task ? t("tasks.edit") : t("tasks.add");
    $("#task-description").value = task?.description || "";
    if (task) {
      $("#task-title").value = task.title;
      $("#task-date").value = task.dueDate || "";
      $("#task-priority").value = task.priority;
      $("#task-status").value = task.status;
    } else if (dueToday) {
      $("#task-date").value = localDateKey();
    }
    $("#task-form [type=submit]").textContent = task ? t("tasks.save") : t("tasks.create");
    dialog.showModal();
    if (!task) requestAnimationFrame(() => { if (dialog.open && editingTaskId === null) $("#task-title").focus(); });
  }

  function openTaskById(taskId) {
    const task = state.tasks.find(item => String(item.id) === String(taskId));
    if (task) openDialog(task);
  }

  function refreshLanguage() {
    taskBulkControls.refresh();
    overdueBulkControls.refresh();
    const heading = view.querySelector(".tasks-workspace-heading");
    heading.querySelector(".eyebrow").textContent = t("layout.workspace");
    heading.querySelector("h1").textContent = t("tasks.workspaceTitle");
    heading.querySelector("p").textContent = t("tasks.workspaceSubtitle");
    view.querySelector(".task-status-tabs").setAttribute("aria-label", t("tasks.taskViews"));
    view.querySelector("#tasks-tab-active span:first-child").textContent = t("tasks.activeTab");
    view.querySelector("#tasks-tab-completed span:first-child").textContent = t("tasks.completedTab");
    $(".tasks-add-label", view).textContent = t("tasks.add");
    view.querySelector(".tasks-workspace-toolbar .tasks-filter-field:nth-child(2) span").textContent = t("tasks.subject");
    view.querySelector(".tasks-workspace-toolbar .tasks-filter-field:nth-child(3) span").textContent = t("tasks.status");
    view.querySelector(".tasks-workspace-toolbar .tasks-filter-field:nth-child(4) span").textContent = t("tasks.priority");
    view.querySelector(".tasks-workspace-toolbar .tasks-filter-field:nth-child(5) span").textContent = t("tasks.sortLabel");
    $("#task-workspace-search", view).placeholder = t("layout.search");
    $("#task-workspace-search", view).setAttribute("aria-label", t("layout.searchLabel"));
    $("#task-subject-filter", view).setAttribute("aria-label", t("tasks.subjectFilter"));
    $("#task-status-filter", view).setAttribute("aria-label", t("tasks.statusFilter"));
    $("#task-priority-filter", view).setAttribute("aria-label", t("tasks.priorityFilter"));
    $(".tasks-result-heading h2", view).textContent = t("tasks.workspaceListTitle");
    populateSubjectSelect($("#task-subject").value);
    populateFilters();
    $("#task-dialog-title").textContent = editingTaskId === null ? t("tasks.add") : t("tasks.edit");
    $("#task-form [type=submit]").textContent = editingTaskId === null ? t("tasks.create") : t("tasks.save");
    const overdueHeading = overdueView.querySelector(".tasks-workspace-heading");
    overdueHeading.querySelector(".eyebrow").textContent = t("layout.workspace");
    overdueHeading.querySelector("h1").textContent = t("overdue.title");
    overdueHeading.querySelector("p").textContent = t("overdue.subtitle");
    overdueSearch.placeholder = t("overdue.searchPlaceholder");
    overdueSearch.setAttribute("aria-label", t("overdue.searchLabel"));
    overdueView.querySelector(".tasks-workspace-toolbar .tasks-filter-field:nth-child(2) span").textContent = t("overdue.subject");
    overdueView.querySelector(".tasks-workspace-toolbar .tasks-filter-field:nth-child(3) span").textContent = t("overdue.priority");
    overdueSubjectFilter.setAttribute("aria-label", t("tasks.subjectFilter"));
    overduePriorityFilter.setAttribute("aria-label", t("tasks.priorityFilter"));
    overdueView.querySelector(".tasks-result-heading h2").textContent = t("overdue.listTitle");
    render();
    if (!topbarSearch.classList.contains("hidden")) renderSearchResults(globalSearch.value);
  }

  async function save(event) {
    event.preventDefault();
    if (busy || !state.user) return;
    const userId = state.user.id;
    const titleInput = $("#task-title");
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.setCustomValidity(t("tasks.titleRequired"));
      titleInput.reportValidity();
      return;
    }
    titleInput.setCustomValidity("");
    busy = true;
    const submit = $("#task-form [type=submit]");
    submit.disabled = true;
    const editing = editingTaskId !== null;
    try {
      const subject = await resolveTaskSubject(userId, $("#task-subject").value);
      if (state.user?.id !== userId) return;
      if (subject && !state.subjects.some(item => String(item.id) === String(subject.id))) {
        state.subjects.push(subject);
        state.subjects.sort((a, b) => a.name.localeCompare(b.name));
      }
      const task = {
        subject_id: subject?.id ?? null,
        title,
        description: $("#task-description").value.trim(),
        due_date: $("#task-date").value || null,
        status: normalizeStatus($("#task-status").value),
        priority: normalizePriority($("#task-priority").value)
      };
      const row = editing
        ? await updateTask(userId, editingTaskId, task)
        : await createTask(userId, task);
      if (state.user?.id !== userId) return;
      applyRow(row, !editing);
      if (editing) { taskBulk.deselect([row.id]); overdueBulk.deselect([row.id]); }
      dialog.close();
      editingTaskId = null;
      state.activeFilter = "all";
      state.taskSubjectFilter = "all";
      state.taskPriorityFilter = "all";
      await onDataChanged({ type: "tasks" });
      notify(t(editing ? "tasks.updateSuccess" : "tasks.createSuccess"));
    } catch (error) {
      if (state.user?.id !== userId) return;
      notify(t(editing ? "tasks.updateError" : "tasks.createError", { error: getErrorMessage(error) }), true);
    } finally {
      busy = false;
      submit.disabled = false;
    }
  }

  async function changeStatus(id, status, control = null) {
    if (busy || !state.user) return;
    const userId = state.user.id;
    busy = true;
    if (control) control.disabled = true;
    try {
      const row = await updateTaskStatus(userId, id, status);
      if (state.user?.id !== userId) return;
      applyRow(row);
      taskBulk.deselect([id]);
      overdueBulk.deselect([id]);
      await onDataChanged({ type: "tasks" });
      notify(t("tasks.statusSuccess"));
    } catch (error) {
      if (state.user?.id !== userId) return;
      await load({ reportError: false, renderAfter: false });
      if (state.user?.id === userId) await onDataChanged({ type: "tasks" });
      notify(t("tasks.statusError", { error: getErrorMessage(error) }), true);
    } finally { busy = false; if (control) control.disabled = false; }
  }

  async function remove(id) {
    if (busy || !state.user) return;
    const userId = state.user.id;
    const task = state.tasks.find(item => String(item.id) === String(id));
    if (!task || !window.confirm(t("tasks.deleteConfirm", { title: task.title }))) return;
    busy = true;
    const removeButton = [...$$("[data-delete]", list), ...$$("[data-delete]", overdueList)].find(button => button.dataset.delete === String(id));
    if (removeButton) removeButton.disabled = true;
    try {
      const archivedRow = await archiveTask(userId, id);
      if (state.user?.id !== userId) return;
      state.tasks = state.tasks.filter(item => String(item.id) !== String(id));
      await onDataChanged({ type: "taskArchived", row: archivedRow });
      notify(t("tasks.deleteSuccess"));
    } catch (error) {
      if (state.user?.id !== userId) return;
      await load({ reportError: false, renderAfter: false });
      if (state.user?.id === userId) await onDataChanged({ type: "tasks" });
      notify(t("tasks.deleteError", { error: getErrorMessage(error) }), true);
    } finally { busy = false; if (removeButton) removeButton.disabled = false; }
  }

  async function runBulkAction(kind, selection) {
    if (busy || !state.user) return;
    const ids = selection.selectedIds();
    if (!ids.length) return;
    if (kind === "archive" && !window.confirm(t("bulk.confirmArchive", { count: ids.length }))) return;
    const userId = state.user.id;
    busy = true;
    selection.setBusy(true);
    try {
      if (kind === "complete" || kind === "returnActive") {
        const rows = await updateTasksStatus(userId, ids, kind === "complete" ? "completed" : "todo");
        if (state.user?.id !== userId) return;
        rows.forEach(row => applyRow(row));
        const failed = ids.length - rows.length;
        await onDataChanged({ type: "tasks" });
        selection.clear();
        notify(failed ? t("bulk.partial", { succeeded: rows.length, failed }) : t(kind === "complete" ? "bulk.successCompleted" : "tasks.successReturnedActive", { count: rows.length }), failed > 0);
      } else {
        const rows = await archiveTasks(userId, ids);
        if (state.user?.id !== userId) return;
        const archivedIds = new Set(rows.map(row => String(row.id)));
        state.tasks = state.tasks.filter(task => !archivedIds.has(String(task.id)));
        const failed = ids.length - rows.length;
        await onDataChanged({ type: "taskArchivedBatch", rows });
        selection.clear();
        notify(failed ? t("bulk.partial", { succeeded: rows.length, failed }) : t("bulk.successArchived", { count: rows.length }), failed > 0);
      }
    } catch (error) {
      if (state.user?.id === userId) notify(t("bulk.failed", { count: ids.length, error: getErrorMessage(error) }), true);
    } finally {
      busy = false;
      selection.setBusy(false);
      render();
      renderOverdue();
    }
  }

  view.addEventListener("click", event => {
    if (event.target.closest("[data-bulk-complete]")) runBulkAction(taskTab === "completed" ? "returnActive" : "complete", taskBulk);
    else if (event.target.closest("[data-bulk-archive]")) runBulkAction("archive", taskBulk);
  });
  overdueView.addEventListener("click", event => {
    if (event.target.closest("[data-bulk-complete]")) runBulkAction("complete", overdueBulk);
    else if (event.target.closest("[data-bulk-archive]")) runBulkAction("archive", overdueBulk);
  });
  $("#add-task-top").addEventListener("click", () => openDialog(null, { dueToday: true }));
  $("#tasks-add-task", view).addEventListener("click", () => openDialog());
  $("#close-task-dialog").addEventListener("click", () => { editingTaskId = null; dialog.close(); });
  $("#cancel-task").addEventListener("click", () => { editingTaskId = null; dialog.close(); });
  form.addEventListener("input", event => { if (event.target.id === "task-title") event.target.setCustomValidity(""); });
  form.addEventListener("submit", save);
  function handleTaskListClick(event) {
    const open = event.target.closest("[data-open-task]");
    if (open) {
      openTaskById(open.dataset.openTask);
      return;
    }
    const edit = event.target.closest("[data-edit]");
    if (edit) {
      const task = state.tasks.find(item => String(item.id) === edit.dataset.edit);
      if (task) openDialog(task);
      return;
    }
    const removeButton = event.target.closest("[data-delete]");
    if (removeButton) remove(removeButton.dataset.delete);
  }
  function handleTaskListChange(event) {
    const select = event.target.closest("[data-status]");
    if (select) changeStatus(select.dataset.status, normalizeStatus(select.value), select);
  }
  list.addEventListener("click", handleTaskListClick);
  overdueList.addEventListener("click", handleTaskListClick);
  list.addEventListener("change", handleTaskListChange);
  overdueList.addEventListener("change", handleTaskListChange);
  const workspaceSearch = $("#task-workspace-search", view);
  globalSearch.addEventListener("input", event => {
    state.searchTerm = event.target.value.toLowerCase().trim();
    render();
    renderSearchResults(event.target.value);
  });
  globalSearch.addEventListener("focus", () => renderSearchResults(globalSearch.value));
  workspaceSearch.addEventListener("input", event => {
    state.searchTerm = event.target.value.toLocaleLowerCase().trim();
    if (globalSearch.value !== event.target.value) globalSearch.value = event.target.value;
    render();
  });
  view.querySelectorAll("[data-task-tab]").forEach(tab => tab.addEventListener("click", () => {
    if (taskTab === tab.dataset.taskTab) return;
    taskTab = tab.dataset.taskTab;
    state.activeFilter = "all";
    taskBulk.clear();
    render();
  }));
  view.querySelector(".task-status-tabs").addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(view.querySelectorAll("[data-task-tab]"));
    const index = tabs.indexOf(document.activeElement);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  });
  overdueSearch.addEventListener("input", renderOverdue);
  overdueSubjectFilter.addEventListener("change", event => { overdueSubject = event.target.value; renderOverdue(); });
  overduePriorityFilter.addEventListener("change", event => { overduePriority = event.target.value; renderOverdue(); });
  $("#task-subject-filter", view).addEventListener("change", event => { state.taskSubjectFilter = event.target.value; render(); });
  $("#task-status-filter", view).addEventListener("change", event => { state.activeFilter = event.target.value; render(); });
  $("#task-priority-filter", view).addEventListener("change", event => { state.taskPriorityFilter = event.target.value; render(); });
  $("#task-sort-order", view).addEventListener("change", event => { taskSortOrder = event.target.value; render(); });
  searchResults.addEventListener("click", event => {
    const result = event.target.closest("[data-search-task]");
    if (!result) return;
    closeSearchResults();
    openTaskById(result.dataset.searchTask);
  });
  document.addEventListener("click", event => {
    if (!topbarSearch.contains(event.target)) closeSearchResults();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeSearchResults();
  });

  return { view, overdueView, load, render, renderOverdue, refreshLanguage, populateSubjectSelect, openTaskById, openDashboardAddTask: () => openDialog(null, { dueToday: true }), syncSubjectNames, applyRow, closeSearchResults };
}




