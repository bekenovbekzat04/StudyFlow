import { supabaseClient } from "./config/supabase.js";
import { initAuth } from "./modules/auth.js";
import { initTasks, getOverdueTasks } from "./modules/tasks.js";
import { initSubjects } from "./modules/subjects.js";
import { initCalendar } from "./modules/calendar.js";
import { initPomodoro } from "./modules/pomodoro.js";
import { initAnalytics } from "./modules/analytics.js";
import { initProfileSettings } from "./modules/profile.js";
import { initArchive } from "./modules/archive.js";
import { savePreferredLanguage } from "./services/auth.service.js";
import { $, $$, showFatal, showToast, clearToasts } from "./utils/dom.js";
import { escapeHTML, formatDue, validSubjectColor, getErrorMessage } from "./utils/helpers.js";
import { getLanguage, setLanguage, hasSavedLanguage, translateDocument, t } from "./utils/i18n.js";

if (window.__studyFlowInitialized) {
  console.warn("StudyFlow has already been initialized.");
} else {
  window.__studyFlowInitialized = true;
  initializeApp();
}

function initializeApp() {
  const hadInitialLanguagePreference = hasSavedLanguage();
  setLanguage(getLanguage(), { persist: hadInitialLanguagePreference });
  const requiredIds = [
    "task-dialog", "task-form", "dashboard-today-tasks", "dashboard-today-empty", "total-tasks", "completed-tasks",
    "pending-tasks", "nav-task-count", "legend-done", "legend-doing", "legend-todo",
    "progress-percent", "global-search", "add-task-top", "cancel-task", "close-task-dialog",
    "task-title", "task-subject", "task-description", "task-dialog-title", "task-date", "task-priority",
    "task-status", "page-breadcrumb", "welcome-title", "language-select", "sidebar-toggle", "global-search-results",
    "dashboard-today-count", "dashboard-overdue-summary", "dashboard-overdue-count", "dashboard-overdue-accessible-count", "nav-overdue-count", "dashboard-week-days", "dashboard-week-label",
    "week-deadline-count", "upcoming-deadlines", "upcoming-empty", "profile-popover", "profile-popover-name",
    "profile-popover-email", "profile-popover-language", "profile-edit", "profile-logout", "app-loading"
  ];
  const missing = requiredIds.filter(id => !document.getElementById(id));
  if (!supabaseClient || !$(".app-shell") || missing.length) {
    showFatal(`StudyFlow could not start.${missing.length ? ` Missing page elements: ${missing.join(", ")}.` : " Supabase is unavailable."}`);
    return;
  }

  const state = { user: null, profile: null, tasks: [], archivedTasks: [], archiveLoadedFor: null, subjects: [], activeFilter: "all", taskSubjectFilter: "all", taskPriorityFilter: "all", searchTerm: "" };
  let authGeneration = 0;
  const languageSelect = $("#language-select");
  languageSelect.value = getLanguage();
  translateDocument();
  const shell = $(".app-shell");
  const startupSplash = $("#app-loading");
  const taskDialog = $("#task-dialog");
  const pageContent = $(".page-content");
  shell.classList.add("hidden");
  taskDialog.classList.add("hidden");

  const dashboardContent = Array.from(pageContent.children);
  const weekMoreDialog = document.createElement("dialog");
  weekMoreDialog.className = "calendar-more-dialog dashboard-week-dialog";
  weekMoreDialog.innerHTML = `<div class="calendar-more-heading"><div><h2></h2><p class="dashboard-week-dialog-subtitle"></p></div><button type="button" class="close-button" aria-label="${t("layout.close")}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button></div><div class="calendar-more-list"></div>`;
  document.body.append(weekMoreDialog);

  function notify(message, isError = false) {
    showToast(message, isError ? "error" : "success");
  }

  function hideStartupSplash() {
    startupSplash.classList.add("hidden");
  }

  function parseTaskDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
  }

  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function dashboardLocale() { return getLanguage() === "kk" ? "kk-KZ" : getLanguage() === "ru" ? "ru-RU" : "en-US"; }
  function currentWeek() {
    const today = startOfDay(new Date());
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { today, monday, sunday };
  }
  function weekTasks() {
    const { monday, sunday } = currentWeek();
    return state.tasks.map(task => ({ task, due: parseTaskDate(task.dueDate) }))
      .filter(item => item.due && item.due >= monday && item.due <= sunday)
      .sort((a, b) => a.due - b.due || String(a.task.title).localeCompare(String(b.task.title), dashboardLocale()));
  }

  function renderDashboardWeek() {
    const { today, monday } = currentWeek();
    const locale = dashboardLocale();
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const rangeFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    const rangeLabel = `${rangeFormat.format(monday)} – ${rangeFormat.format(sunday)}, ${sunday.getFullYear()}`;
    $("#dashboard-week-label").textContent = rangeLabel;

    const scheduled = weekTasks();
    const countsByDate = new Map();
    scheduled.forEach(({ due }) => {
      const key = dateKey(due);
      countsByDate.set(key, (countsByDate.get(key) || 0) + 1);
    });
    const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "short" });
    $("#dashboard-week-days").innerHTML = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const count = countsByDate.get(dateKey(date)) || 0;
      const label = `${weekdayFormat.format(date)} ${date.getDate()}: ${t("dashboard.weekDayTasks", { count })}`;
      return `<div class="${date.getTime() === today.getTime() ? "today" : ""}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}"><small>${escapeHTML(weekdayFormat.format(date).toLocaleUpperCase(locale))}</small><b>${date.getDate()}</b><i class="${count ? "has-tasks" : ""}"></i><span class="week-day-count">${count || ""}</span></div>`;
    }).join("");

    $("#week-deadline-count").textContent = scheduled.length;
    const renderDeadline = ({ task, due }) => {
      const subject = state.subjects.find(item => String(item.id) === String(task.subjectId));
      const color = subject ? validSubjectColor(subject.color) : "#ffffff";
      const accent = subject ? color : "#d8dbe5";
      const statusKey = task.status === "completed" ? "tasks.completed" : task.status === "progress" ? "tasks.inProgress" : "tasks.toDo";
      return `<button type="button" class="agenda-item dashboard-deadline-item ${subject ? "" : "is-no-subject"}" data-dashboard-task="${escapeHTML(task.id)}" style="--subject-color:${accent}"><span class="agenda-time">${escapeHTML(formatDue(dateKey(due), getLanguage()))}</span><span class="agenda-dot ${subject ? (color.toLowerCase() === "#ffffff" ? "is-white-subject-dot" : "") : "is-no-subject-dot"}" style="background-color:${color}"></span><span class="dashboard-deadline-copy"><strong>${escapeHTML(task.title)}</strong><small><span class="task-subject-chip ${subject ? "" : "task-no-subject"}">${escapeHTML(subject?.name || t("tasks.noSubject"))}</span> · ${t(statusKey)} · ${t(`tasks.${String(task.priority || "medium").toLowerCase()}`)}</small></span></button>`;
    };
    const visibleDeadlines = scheduled.slice(0, 3);
    const extraCount = scheduled.length - visibleDeadlines.length;
    $("#upcoming-deadlines").innerHTML = visibleDeadlines.map(renderDeadline).join("") + (extraCount > 0 ? `<button type="button" class="dashboard-week-more" data-dashboard-week-more>${t("calendar.moreTasks", { count: extraCount })}</button>` : "");
    weekMoreDialog.querySelector("h2").textContent = t("dashboard.upcomingWeek");
    weekMoreDialog.querySelector(".dashboard-week-dialog-subtitle").textContent = rangeLabel;
    weekMoreDialog.querySelector(".calendar-more-list").innerHTML = scheduled.map(renderDeadline).join("");
    $("#upcoming-empty").classList.toggle("hidden", scheduled.length > 0);
    $("#upcoming-deadlines").classList.toggle("hidden", scheduled.length === 0);
  }

  function renderDashboardData() {
    const todayKey = dateKey(startOfDay(new Date()));
    const { today } = currentWeek();
    const overdueTasks = getOverdueTasks(state.tasks, dateKey(today));
    const overdueCount = overdueTasks.length;
    const dashboardOverdueSummary = $("#dashboard-overdue-summary");
    dashboardOverdueSummary.classList.toggle("hidden", overdueCount === 0 || currentView !== "dashboard");
    $("#dashboard-overdue-count").textContent = overdueCount;
    const overdueCountKey = overdueCount === 1 ? "overdue.countSingular" : "overdue.countPlural";
    const overdueCountLabel = t(overdueCountKey, { count: overdueCount });
    $("#dashboard-overdue-accessible-count").textContent = overdueCountLabel;
    dashboardOverdueSummary.setAttribute("aria-label", `${t("dashboard.overdueTasks")}: ${overdueCountLabel}`);
    const navOverdueCount = $("#nav-overdue-count");
    navOverdueCount.textContent = overdueCount > 99 ? "99+" : overdueCount;
    navOverdueCount.setAttribute("aria-label", overdueCountLabel);
    navOverdueCount.classList.toggle("hidden", overdueCount === 0);
    const todayTasks = state.tasks.filter(task => {
      const due = parseTaskDate(task.dueDate);
      return due && dateKey(due) === todayKey;
    }).sort((a, b) =>
      ({ High: 0, Medium: 1, Low: 2 }[a.priority] ?? 3) - ({ High: 0, Medium: 1, Low: 2 }[b.priority] ?? 3) ||
      Number(a.status === "completed") - Number(b.status === "completed") ||
      String(a.title).localeCompare(String(b.title), dashboardLocale()));
    $("#dashboard-today-tasks").innerHTML = todayTasks.map(task => {
      const subject = state.subjects.find(item => String(item.id) === String(task.subjectId));
      const color = subject ? validSubjectColor(subject.color) : "#ffffff";
      const dotClass = subject ? (color.toLowerCase() === "#ffffff" ? "is-white-subject-dot" : "") : "is-no-subject-dot";
      const statusKey = task.status === "completed" ? "tasks.completed" : task.status === "progress" ? "tasks.inProgress" : "tasks.toDo";
      return `<button type="button" class="dashboard-today-task ${task.status === "completed" ? "is-completed" : ""}" data-dashboard-task="${escapeHTML(task.id)}"><span class="subject-dot ${dotClass}" style="background-color:${color}"></span><span class="dashboard-today-copy"><strong>${escapeHTML(task.title)}</strong><small><span class="task-subject-chip ${subject ? "" : "task-no-subject"}">${escapeHTML(subject?.name || t("tasks.noSubject"))}</span> · ${t(statusKey)}</small></span><span class="priority ${escapeHTML(task.priority)}">${t(`tasks.${String(task.priority).toLowerCase()}`)}</span></button>`;
    }).join("");
    $("#dashboard-today-count").textContent = t("dashboard.taskCount", { count: todayTasks.length });
    $("#dashboard-today-empty").classList.toggle("hidden", todayTasks.length > 0);
    $("#dashboard-today-tasks").classList.toggle("hidden", todayTasks.length === 0);
    renderDashboardWeek();
  }
  pageContent.addEventListener("click", event => {
    if (event.target.closest("[data-dashboard-add-task]")) {
      tasksModule?.openDashboardAddTask();
      return;
    }
    if (event.target.closest("[data-dashboard-week-more]")) {
      weekMoreDialog.showModal();
      return;
    }
    const task = event.target.closest("[data-dashboard-task]");
    if (task) tasksModule?.openTaskById(task.dataset.dashboardTask);
  });
  weekMoreDialog.querySelector(".close-button").addEventListener("click", () => weekMoreDialog.close());
  weekMoreDialog.addEventListener("click", event => {
    const task = event.target.closest("[data-dashboard-task]");
    if (!task) return;
    weekMoreDialog.close();
    tasksModule?.openTaskById(task.dataset.dashboardTask);
  });

  const sidebarToggle = $("#sidebar-toggle");
  function setSidebarCollapsed(collapsed, persist = true) {
    shell.classList.toggle("sidebar-collapsed", collapsed);
    sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggle.setAttribute("aria-label", t(collapsed ? "layout.expandSidebar" : "layout.collapseSidebar"));
    sidebarToggle.title = t(collapsed ? "layout.expandSidebar" : "layout.collapseSidebar");
    sidebarToggle.querySelector("span").textContent = collapsed ? "›" : "‹";
    $(".profile-button").title = t("layout.profile");
    $$("[data-view]").forEach(item => {
      const key = item.querySelector("[data-i18n]")?.dataset.i18n;
      if (key) item.title = t(key);
    });
    if (persist) {
      try { localStorage.setItem("studyflow_sidebar_collapsed", String(collapsed)); } catch (_) { /* Storage may be unavailable. */ }
    }
  }
  sidebarToggle.addEventListener("click", () => setSidebarCollapsed(!shell.classList.contains("sidebar-collapsed")));
  let sidebarSavedState = null;
  try { sidebarSavedState = localStorage.getItem("studyflow_sidebar_collapsed"); } catch (_) { /* Storage may be unavailable. */ }
  setSidebarCollapsed(sidebarSavedState === "true", false);

  let tasksModule;
  let subjectsModule;
  let calendarModule;
  let pomodoroModule;
  let analyticsModule;
  let profileModule;
  let archiveModule;
  let workspaceInitialized = false;
  let currentView = "dashboard";

  function refreshTranslatedViews() {
    translateDocument();
    languageSelect.value = getLanguage();
    $$(`[data-language-select]`).forEach(select => { select.value = getLanguage(); });
    if (!workspaceInitialized) {
      auth?.refreshLanguage();
      return;
    }
    const locale = getLanguage() === "kk" ? "kk-KZ" : getLanguage() === "ru" ? "ru-RU" : "en-US";
    $("#today-label").textContent = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toLocaleUpperCase(locale);
    tasksModule.refreshLanguage();
    subjectsModule.refreshLanguage();
    calendarModule.refreshLanguage();
    pomodoroModule.refreshLanguage();
    analyticsModule.refreshLanguage();
    profileModule.refreshLanguage();
    archiveModule.refreshLanguage();
    auth.refreshLanguage();
    renderDashboardData();
    setSidebarCollapsed(shell.classList.contains("sidebar-collapsed"), false);
    const activeView = $$("[data-view]").find(item => item.classList.contains("active"))?.dataset.view || "dashboard";
    $("#page-breadcrumb").textContent = t(`nav.${activeView}`);
  }
  async function refreshData() {
    if (!state.user || !workspaceInitialized) return;
    const userId = state.user.id;
    const generation = authGeneration;
    await Promise.all([
      subjectsModule.load({ renderAfter: false }),
      tasksModule.load({ renderAfter: false })
    ]);
    if (generation !== authGeneration || state.user?.id !== userId) return;
    tasksModule.syncSubjectNames({ renderAfter: false });
    renderLoadedViews();
  }

  function renderLoadedViews({ type = "all", row = null, rows = [] } = {}) {
    if (type === "subjects") tasksModule.syncSubjectNames({ renderAfter: false });
    if (type === "taskArchived" && row) archiveModule.onTaskArchived(row);
    if (type === "taskArchivedBatch" && Array.isArray(rows)) archiveModule.onTasksArchived(rows);
    subjectsModule.render();
    tasksModule.render();
    calendarModule.render();
    if (type === "all" || type === "tasks" || type === "taskArchived" || type === "taskArchivedBatch") pomodoroModule.refreshTasks();
    analyticsModule.render();
    renderDashboardData();
    if (type === "all" || type === "subjects" || type === "tasks") archiveModule.render();
  }

  function onSignedOut() {
    authGeneration += 1;
    if (weekMoreDialog.open) weekMoreDialog.close();
    state.user = null;
    state.profile = null;
    state.tasks = [];
    archiveModule?.reset();
    state.subjects = [];
    hideStartupSplash();
    profileModule?.close(true);
    tasksModule?.closeSearchResults();
    $("#global-search-results").classList.add("hidden");
    auth.closeProfilePopover();
    renderDashboardData();
    taskDialog.classList.add("hidden");
    subjectsModule?.dialog.close();
    subjectsModule?.view.classList.add("hidden");
    calendarModule?.view.classList.add("hidden");
    pomodoroModule?.stop();
    pomodoroModule?.view.classList.add("hidden");
    analyticsModule?.view.classList.add("hidden");
    analyticsModule?.render();
    dashboardContent.forEach(node => node.classList.remove("hidden"));
    tasksModule?.view.classList.add("hidden");
    tasksModule?.overdueView.classList.add("hidden");
    $(".topbar-search").classList.remove("hidden");
    $$("[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === "dashboard"));
    $("#page-breadcrumb").textContent = t("nav.dashboard");
    clearToasts();
  }

  const auth = initAuth({
    onAuthenticated: async (user, profile) => {
      state.user = user;
      state.profile = profile;
      initializeWorkspace();
      auth.renderProfile(user, profile);
      taskDialog.classList.remove("hidden");
      await refreshData();
    },
    onSignedOut,
    onWarning: notify
  });

  function initializeWorkspace() {
    if (workspaceInitialized) return;
    workspaceInitialized = true;
    subjectsModule = initSubjects({ state, onDataChanged: renderLoadedViews });
    tasksModule = initTasks({ state, onDataChanged: renderLoadedViews, notify });
    calendarModule = initCalendar({ state, onOpenTask: taskId => tasksModule.openTaskById(taskId) });
    pomodoroModule = initPomodoro({ state });
    analyticsModule = initAnalytics({ state });
    archiveModule = initArchive({ state, onTaskRestored: async value => {
      const rows = Array.isArray(value) ? value : [value];
      rows.forEach(row => tasksModule.applyRow(row, true));
      await renderLoadedViews({ type: "tasks" });
    } });
    profileModule = initProfileSettings({
      state, auth,
      onProfileChanged: (user, profile) => {
        state.user = user;
        state.profile = profile;
        auth.renderProfile(user, profile);
      }
    });
    $$(`[data-view], [data-open-view]`).forEach(button => button.addEventListener("click", onNavigateClick));
    refreshTranslatedViews();
  }

  function navigateTo(view) {
    currentView = view;
    if (view !== "dashboard") $("#dashboard-overdue-summary").classList.add("hidden");
    auth.closeProfilePopover();
    $$("[data-view]").forEach(nav => nav.classList.toggle("active", nav.dataset.view === view));
    $("#page-breadcrumb").textContent = t(`nav.${view}`);
    const showingSubjects = view === "subjects";
    const showingCalendar = view === "calendar";
    const showingFocus = view === "focus";
    const showingAnalytics = view === "analytics";
    const showingArchive = view === "archive";
    const showingTasks = view === "tasks";
    if (showingTasks) tasksModule.closeSearchResults();
    if (view !== "dashboard") tasksModule.closeSearchResults();
    $(".topbar-search").classList.toggle("hidden", view !== "dashboard");
    const showingOverdue = view === "overdue";
    dashboardContent.forEach(node => node.classList.toggle("hidden", showingTasks || showingOverdue || showingSubjects || showingCalendar || showingFocus || showingAnalytics || showingArchive));
    tasksModule.view.classList.toggle("hidden", !showingTasks);
    tasksModule.overdueView.classList.toggle("hidden", !showingOverdue);
    subjectsModule.view.classList.toggle("hidden", !showingSubjects);
    calendarModule.view.classList.toggle("hidden", !showingCalendar);
    pomodoroModule.view.classList.toggle("hidden", !showingFocus);
    analyticsModule.view.classList.toggle("hidden", !showingAnalytics);
    archiveModule.view.classList.toggle("hidden", !showingArchive);
    if (view === "dashboard") renderDashboardData();
    if (showingTasks) {
      tasksModule.render();
    } else if (showingOverdue) {
      tasksModule.renderOverdue();
    } else if (showingSubjects) {
      subjectsModule.setNotice("");
      subjectsModule.render();
    } else if (showingCalendar) {
      calendarModule.render();
    } else if (showingAnalytics) {
      analyticsModule.render();
    } else if (showingArchive) {
      archiveModule.load();
    }
  }

  function onNavigateClick(event) {
    const button = event.currentTarget;
    if (workspaceInitialized) navigateTo(button.dataset.view || button.dataset.openView);
  }

  $$(`[data-language-select], #language-select`).forEach(select => select.addEventListener("change", async event => {
    const language = setLanguage(event.target.value);
    event.target.value = language;
    refreshTranslatedViews();
    if (!state.user || !workspaceInitialized) return;
    try {
      await savePreferredLanguage(state.user, language, state.profile?.full_name);
    } catch (error) {
      notify(t("errors.languageSave", { error: getErrorMessage(error) }), true);
    }
  }));

  (async () => {
    const restoreGeneration = authGeneration;
    try {
      const restored = await auth.restore();
      if (restoreGeneration !== authGeneration) return;
      if (!restored.user) {
        auth.setDashboardVisible(false);
        hideStartupSplash();
        return;
      }
      state.user = restored.user;
      state.profile = restored.profile;
      initializeWorkspace();
      if (!hadInitialLanguagePreference && ["en", "ru", "kk"].includes(restored.profile?.preferred_language)) {
        languageSelect.value = setLanguage(restored.profile.preferred_language);
        refreshTranslatedViews();
      }
      auth.renderProfile(restored.user, restored.profile);
      taskDialog.classList.remove("hidden");
      if (restored.profileError) notify(t("auth.profileError", { error: getErrorMessage(restored.profileError) }), true);
      await refreshData();
      if (restoreGeneration !== authGeneration || !state.user) return;
      auth.setDashboardVisible(true);
      hideStartupSplash();
    } catch (error) {
      if (restoreGeneration !== authGeneration) return;
      const splashSpinner = startupSplash.querySelector(".app-loading-spinner");
      if (splashSpinner) splashSpinner.classList.add("hidden");
      const splashMessage = startupSplash.querySelector("[data-i18n='layout.loading']");
      if (splashMessage) splashMessage.textContent = t("auth.restoreError", { error: getErrorMessage(error) });
    }
  })();
}
