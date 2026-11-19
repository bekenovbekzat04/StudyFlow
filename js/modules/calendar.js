import { $, showMessage } from "../utils/dom.js";
import { escapeHTML, validSubjectColor } from "../utils/helpers.js";
import { t, getLanguage } from "../utils/i18n.js";

function locale() { return getLanguage() === "kk" ? "kk-KZ" : getLanguage() === "ru" ? "ru-RU" : "en-US"; }
function weekdays() { const formatter = new Intl.DateTimeFormat(locale(), { weekday: "short" }); return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2026, 0, 5 + index))); }

export function initCalendar({ state, onOpenTask }) {
  const pageContent = $(".page-content");
  const view = document.createElement("section");
  view.id = "calendar-page";
  view.className = "calendar-page hidden";
  view.innerHTML = `<div class="calendar-toolbar"><div><h1>${t("calendar.title")}</h1><p>${t("calendar.subtitle")}</p></div><div class="calendar-toolbar-actions"><div class="calendar-view-switch" role="group" aria-label="Calendar view"><button type="button" data-calendar-view="month" class="active">${t("calendar.month")}</button><button type="button" data-calendar-view="week">${t("calendar.week")}</button></div></div></div><section class="calendar-panel"><div class="calendar-controls"><div class="calendar-date-controls"><button type="button" class="calendar-today" data-calendar-today>${t("calendar.today")}</button><button type="button" class="calendar-step" data-calendar-step="prev" aria-label="${t("calendar.previous")}">‹</button><button type="button" class="calendar-step" data-calendar-step="next" aria-label="${t("calendar.next")}">›</button><h2 id="calendar-heading"></h2></div><div class="calendar-filters"><label>${t("calendar.subject")}<select id="calendar-subject-filter"><option value="all">${t("calendar.allSubjects")}</option></select></label><label>${t("calendar.status")}<select id="calendar-status-filter"><option value="all">${t("calendar.allStatuses")}</option><option value="todo">${t("tasks.toDo")}</option><option value="progress">${t("tasks.inProgress")}</option><option value="completed">${t("tasks.completed")}</option></select></label></div></div><div id="calendar-loading" class="calendar-empty hidden">Loading calendar…</div><div id="calendar-grid" class="calendar-grid" aria-live="polite"></div><div id="calendar-empty" class="calendar-empty hidden">${t("calendar.empty")}</div><div id="calendar-notice" class="calendar-notice hidden" role="status" aria-live="polite"></div></section>`;
  pageContent.append(view);

  const moreDialog = document.createElement("dialog");
  moreDialog.className = "calendar-more-dialog";
  moreDialog.innerHTML = `<div class="calendar-more-heading"><h2></h2><button type="button" class="close-button" aria-label="${t("layout.close")}">×</button></div><div class="calendar-more-list"></div>`;
  document.body.append(moreDialog);

  let mode = "month";
  try {
    const savedMode = localStorage.getItem("studyflow_calendar_view");
    if (savedMode === "week" || savedMode === "month") mode = savedMode;
  } catch (_) { /* Calendar preference storage may be unavailable. */ }
  view.querySelectorAll("[data-calendar-view]").forEach(button => button.classList.toggle("active", button.dataset.calendarView === mode));
  let cursor = startOfDay(new Date());
  let subjectFilter = "all";
  let statusFilter = "all";
  let loading = false;
  const grid = $("#calendar-grid", view);
  const heading = $("#calendar-heading", view);
  const empty = $("#calendar-empty", view);
  const notice = $("#calendar-notice", view);
  const moreList = moreDialog.querySelector(".calendar-more-list");
  let moreDate = null;
  let moreTasks = [];

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, amount) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + amount);
    return result;
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDueDate(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return result.getFullYear() === Number(match[1]) && result.getMonth() === Number(match[2]) - 1 && result.getDate() === Number(match[3]) ? result : null;
  }

  function mondayOf(date) {
    const offset = (date.getDay() + 6) % 7;
    return addDays(date, -offset);
  }

  function getFilteredDatedTasks() {
    return state.tasks.map(task => ({ task, date: parseDueDate(task.dueDate) }))
      .filter(item => item.date && (subjectFilter === "all" || String(item.task.subjectId) === subjectFilter) && (statusFilter === "all" || item.task.status === statusFilter));
  }

  function syncSubjectFilter() {
    const select = $("#calendar-subject-filter", view);
    const available = new Set(state.subjects.map(subject => String(subject.id)));
    if (subjectFilter !== "all" && !available.has(subjectFilter)) subjectFilter = "all";
    select.innerHTML = `<option value="all">${t("calendar.allSubjects")}</option>` + state.subjects
      .map(subject => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join("");
    select.value = subjectFilter;
  }

  function taskMarkup(task) {
    const subject = state.subjects.find(item => String(item.id) === String(task.subjectId));
    const color = subject ? validSubjectColor(subject.color) : "#ffffff";
    const subjectColorClass = subject ? (color.toLowerCase() === "#ffffff" ? "is-white-subject" : "") : "is-no-subject";
    return `<button type="button" class="calendar-task status-${escapeHTML(task.status)} ${subjectColorClass}" data-calendar-task="${escapeHTML(task.id)}" style="--calendar-task-color:${color}" title="${escapeHTML(task.title)} — ${escapeHTML(subject?.name || t("tasks.noSubject"))}"><span class="calendar-task-dot"></span><span class="calendar-task-title">${escapeHTML(task.title)}</span></button>`;
  }

  function moreTaskMarkup(task) {
    const subject = state.subjects.find(item => String(item.id) === String(task.subjectId));
    const color = subject ? validSubjectColor(subject.color) : "#ffffff";
    const accent = subject ? color : "#d8dbe5";
    const dotClass = subject ? (color.toLowerCase() === "#ffffff" ? "is-white-subject-dot" : "") : "is-no-subject-dot";
    const statusKey = task.status === "completed" ? "tasks.completed" : task.status === "progress" ? "tasks.inProgress" : "tasks.toDo";
    return `<button type="button" class="dashboard-deadline-item calendar-more-task-item ${subject ? "" : "is-no-subject"}" data-calendar-task="${escapeHTML(task.id)}" style="--subject-color:${accent}"><span class="agenda-dot ${dotClass}" style="background-color:${color}"></span><span class="dashboard-deadline-copy"><strong>${escapeHTML(task.title)}</strong><small><span class="task-subject-chip ${subject ? "" : "task-no-subject"}">${escapeHTML(subject?.name || t("tasks.noSubject"))}</span> · ${t(statusKey)} · ${t(`tasks.${String(task.priority || "medium").toLowerCase()}`)}</small></span></button>`;
  }
  function showMore(date, tasks) {
    moreDate = date;
    moreTasks = tasks;
    renderMoreDialog();
    moreDialog.showModal();
  }

  function renderMoreDialog() {
    if (!moreDate) return;
    const label = new Intl.DateTimeFormat(locale(), { dateStyle: "full" }).format(moreDate);
    moreDialog.querySelector("h2").textContent = t("calendar.tasksOnDate", { date: label });
    moreList.innerHTML = moreTasks.map(moreTaskMarkup).join("");
  }

  function render() {
    syncSubjectFilter();
    $("#calendar-loading", view).classList.toggle("hidden", !loading);
    grid.classList.toggle("hidden", loading);
    if (loading) return;

    const dates = [];
    if (mode === "month") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const start = mondayOf(first);
      for (let index = 0; index < 42; index += 1) dates.push(addDays(start, index));
      heading.textContent = `${new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(cursor)}`;
    } else {
      const start = mondayOf(cursor);
      for (let index = 0; index < 7; index += 1) dates.push(addDays(start, index));
      const end = dates[6];
      heading.textContent = new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric", year: "numeric" }).format(start) + " – " + new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric", year: "numeric" }).format(end);
    }

    const byDate = new Map();
    getFilteredDatedTasks().forEach(({ task, date }) => {
      const key = dateKey(date);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(task);
    });

    grid.className = `calendar-grid ${mode === "week" ? "week-view" : "month-view"}`;
    grid.innerHTML = `${weekdays().map(day => `<div class="calendar-weekday">${day}</div>`).join("")}${dates.map(date => {
      const key = dateKey(date);
      const tasks = byDate.get(key) || [];
      const isOutside = mode === "month" && date.getMonth() !== cursor.getMonth();
      const isToday = key === dateKey(startOfDay(new Date()));
      const visibleTasks = tasks.slice(0, 3);
      const extraCount = tasks.length - visibleTasks.length;
      return `<div class="calendar-day ${isOutside ? "outside-month" : ""} ${isToday ? "is-today" : ""}" data-calendar-date="${key}"><span class="calendar-day-number">${date.getDate()}</span><div class="calendar-day-tasks">${visibleTasks.map(taskMarkup).join("")}${extraCount > 0 ? `<button type="button" class="calendar-more-button" data-calendar-more="${key}">${t("calendar.moreTasks", { count: extraCount })}</button>` : ""}</div></div>`;
    }).join("")}`;
    const hasVisibleTasks = dates.some(date => (byDate.get(dateKey(date)) || []).length > 0);
    empty.classList.toggle("hidden", hasVisibleTasks);
  }

  function step(direction) {
    if (mode === "month") {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + (direction === "next" ? 1 : -1), 1);
    } else {
      cursor = addDays(cursor, direction === "next" ? 7 : -7);
    }
    render();
  }

  view.querySelectorAll("[data-calendar-view]").forEach(button => button.addEventListener("click", () => {
    mode = button.dataset.calendarView;
    try { localStorage.setItem("studyflow_calendar_view", mode); } catch (_) { /* Calendar preference storage may be unavailable. */ }
    view.querySelectorAll("[data-calendar-view]").forEach(item => item.classList.toggle("active", item === button));
    render();
  }));
  view.querySelectorAll("[data-calendar-step]").forEach(button => button.addEventListener("click", () => step(button.dataset.calendarStep)));
  $("[data-calendar-today]", view).addEventListener("click", () => { cursor = startOfDay(new Date()); render(); });
  $("#calendar-subject-filter", view).addEventListener("change", event => { subjectFilter = event.target.value; render(); });
  $("#calendar-status-filter", view).addEventListener("change", event => { statusFilter = event.target.value; render(); });
  grid.addEventListener("click", event => {
    const taskButton = event.target.closest("[data-calendar-task]");
    if (taskButton) {
      moreDialog.close();
      onOpenTask(taskButton.dataset.calendarTask);
      return;
    }
    const moreButton = event.target.closest("[data-calendar-more]");
    if (moreButton) {
      const day = parseDueDate(moreButton.dataset.calendarMore);
      if (day) showMore(day, getFilteredDatedTasks().filter(item => dateKey(item.date) === moreButton.dataset.calendarMore).map(item => item.task));
    }
  });
  moreList.addEventListener("click", event => {
    const taskButton = event.target.closest("[data-calendar-task]");
    if (taskButton) {
      moreDialog.close();
      onOpenTask(taskButton.dataset.calendarTask);
    }
  });
  moreDialog.querySelector(".close-button").addEventListener("click", () => moreDialog.close());

  function showLoading() {
    loading = true;
    render();
  }

  function setNotice(message, type = "success") {
    showMessage(notice, message, type);
  }

  function refreshLanguage() {
    const toolbar = view.querySelector(".calendar-toolbar");
    toolbar.querySelector("h1").textContent = t("calendar.title");
    toolbar.querySelector("p").textContent = t("calendar.subtitle");
    view.querySelector(".calendar-view-switch").setAttribute("aria-label", t("calendar.title"));
    view.querySelector('[data-calendar-view="month"]').textContent = t("calendar.month");
    view.querySelector('[data-calendar-view="week"]').textContent = t("calendar.week");
    $("[data-calendar-today]", view).textContent = t("calendar.today");
    view.querySelector('[data-calendar-step="prev"]').setAttribute("aria-label", t("calendar.previous"));
    view.querySelector('[data-calendar-step="next"]').setAttribute("aria-label", t("calendar.next"));
    const labels = view.querySelectorAll(".calendar-filters label");
    labels[0].childNodes[0].textContent = t("calendar.subject");
    labels[1].childNodes[0].textContent = t("calendar.status");
    $("#calendar-status-filter", view).options[0].textContent = t("calendar.allStatuses");
    $("#calendar-status-filter", view).options[1].textContent = t("tasks.toDo");
    $("#calendar-status-filter", view).options[2].textContent = t("tasks.inProgress");
    $("#calendar-status-filter", view).options[3].textContent = t("tasks.completed");
    $("#calendar-loading", view).textContent = t("calendar.loading");
    empty.textContent = t("calendar.empty");
    moreDialog.querySelector(".close-button").setAttribute("aria-label", t("layout.close"));
    if (moreDialog.open) renderMoreDialog();
    render();
  }
  refreshLanguage();

  return { view, render, showLoading, setNotice, refreshLanguage, destroy() { moreDialog.close(); moreDialog.remove(); view.remove(); } };
}



