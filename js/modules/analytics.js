import { $ } from "../utils/dom.js";
import { escapeHTML, validSubjectColor } from "../utils/helpers.js";
import { t, getLanguage } from "../utils/i18n.js";

export function initAnalytics({ state }) {
  const pageContent = $(".page-content");
  const view = document.createElement("section");
  view.id = "analytics-page";
  view.className = "analytics-page hidden";
  view.innerHTML = `<div class="analytics-heading"><div><h1>${t("analytics.title")}</h1><p>${t("analytics.subtitle")}</p></div></div><div id="analytics-empty" class="analytics-empty hidden"><div class="analytics-empty-mark">↗</div><h2>${t("analytics.emptyTitle")}</h2><p>${t("analytics.empty")}</p></div><div id="analytics-content" class="analytics-content hidden"><div class="analytics-overview" id="analytics-overview"></div><div class="analytics-chart-grid"><section class="analytics-card"><div class="analytics-card-heading"><h2>${t("analytics.status")}</h2><p>${t("analytics.distribution")}</p></div><div class="analytics-chart-wrap"><canvas id="analytics-status-chart" aria-label="Doughnut chart of tasks by status"></canvas></div></section><section class="analytics-card"><div class="analytics-card-heading"><h2>${t("analytics.priorityChart")}</h2><p>${t("analytics.distribution")}</p></div><div class="analytics-chart-wrap"><canvas id="analytics-priority-chart" aria-label="Bar chart of tasks by priority"></canvas></div></section></div><div class="analytics-lower-grid"><section class="analytics-card analytics-subject-card"><div class="analytics-card-heading"><h2>${t("analytics.subjectBreakdown")}</h2><p>${t("analytics.subjectTotals")}</p></div><div id="analytics-subjects" class="analytics-subject-list"></div></section><section class="analytics-card"><div class="analytics-card-heading"><h2>${t("analytics.deadlines")}</h2><p>${t("analytics.localCalendar")}</p></div><div id="analytics-deadlines" class="analytics-deadline-grid"></div></section></div><p class="analytics-chart-note hidden" id="analytics-chart-note" role="status"></p></div>`;
  pageContent.append(view);

  const content = $("#analytics-content", view);
  const empty = $("#analytics-empty", view);
  const overview = $("#analytics-overview", view);
  const subjectsList = $("#analytics-subjects", view);
  const deadlines = $("#analytics-deadlines", view);
  const chartNote = $("#analytics-chart-note", view);
  let statusChart = null;
  let priorityChart = null;
  let lastRenderSignature = null;
  let lastChartSignature = null;

  function parseDueDate(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
  }

  function localDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function destroyCharts() {
    if (statusChart) {
      statusChart.destroy();
      statusChart = null;
    }
    if (priorityChart) {
      priorityChart.destroy();
      priorityChart = null;
    }
  }

  function renderOverview(counts, completionRate) {
    const cards = [
      [t("analytics.total"), counts.total, t("analytics.totalDetail"), "purple"],
      [t("analytics.completed"), counts.completed, t("analytics.completedDetail"), "green"],
      [t("analytics.inProgress"), counts.progress, t("analytics.progressDetail"), "blue"],
      [t("analytics.toDo"), counts.todo, t("analytics.todoDetail"), "orange"],
      ["Completion rate", `${completionRate}%`, "Completed Г· total tasks", "purple"]
    ];
    overview.innerHTML = cards.map(([label, value, detail, tone]) => `<article class="analytics-stat-card"><span class="analytics-stat-label">${label}</span><strong class="${tone}">${value}</strong><small>${detail}</small></article>`).join("");
  }

  function getDeadlineCounts() {
    const today = localDay(new Date());
    const mondayOffset = (today.getDay() + 6) % 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const openTasks = state.tasks.filter(task => task.status !== "completed");
    let overdue = 0;
    let dueToday = 0;
    let dueThisWeek = 0;
    for (const task of openTasks) {
      const due = parseDueDate(task.dueDate);
      if (!due) continue;
      const day = localDay(due);
      if (day < today) overdue += 1;
      if (day.getTime() === today.getTime()) dueToday += 1;
      if (day >= today && day >= weekStart && day <= weekEnd) dueThisWeek += 1;
    }
    return { overdue, dueToday, dueThisWeek, noDate: state.tasks.filter(task => !parseDueDate(task.dueDate)).length };
  }

  function renderDeadlines() {
    const counts = getDeadlineCounts();
    const cards = [
      [t("analytics.overdue"), counts.overdue, t("analytics.unfinishedBefore"), "overdue"],
      [t("analytics.dueToday"), counts.dueToday, t("analytics.unfinished"), "today"],
      [t("analytics.dueWeek"), counts.dueThisWeek, t("analytics.mondaySunday"), "week"],
      [t("analytics.noDueDate"), counts.noDate, t("analytics.allTasks"), "no-date"]
    ];
    deadlines.innerHTML = cards.map(([label, value, note, key]) => `<article class="analytics-deadline ${key}"><strong>${value}</strong><span>${label}</span><small>${note}</small></article>`).join("");
  }

  function renderSubjectBreakdown() {
    const byId = new Map();
    state.subjects.forEach(subject => byId.set(String(subject.id), {
      id: String(subject.id), name: subject.name, color: validSubjectColor(subject.color), count: 0
    }));
    let unassignedCount = 0;
    for (const task of state.tasks) {
      const key = task.subjectId == null ? null : String(task.subjectId);
      if (key && byId.has(key)) byId.get(key).count += 1;
      else unassignedCount += 1;
    }
    const rows = Array.from(byId.values());
    if (unassignedCount) rows.push({ id: "unassigned", name: t("tasks.noSubject"), color: "#ffffff", count: unassignedCount });
    const maxCount = Math.max(1, ...rows.map(item => item.count));
    subjectsList.innerHTML = rows.length ? rows.map(subject => `<div class="analytics-subject-row ${subject.id === "unassigned" ? "is-no-subject" : ""}"><span class="analytics-subject-color ${subject.id === "unassigned" ? "is-no-subject-dot" : subject.color.toLowerCase() === "#ffffff" ? "is-white-subject-dot" : ""}" style="background-color:${subject.color}"></span><div class="analytics-subject-info"><div><strong>${escapeHTML(subject.name)}</strong><span>${subject.count}</span></div><div class="analytics-subject-track"><i style="width:${Math.round(subject.count / maxCount * 100)}%;background-color:${subject.id === "unassigned" ? "#d8dbe5" : subject.color}"></i></div></div></div>`).join("") : `<p class="analytics-no-subjects">${t("analytics.noSubjects")}</p>`;
  }

  function renderCharts(counts, signature) {
    if (signature === lastChartSignature && statusChart && priorityChart) return;
    destroyCharts();
    lastChartSignature = signature;
    const ChartConstructor = window.Chart;
    if (typeof ChartConstructor !== "function") {
      chartNote.textContent = t("analytics.chartError");
      chartNote.classList.remove("hidden");
      return;
    }
    chartNote.classList.add("hidden");
    statusChart = new ChartConstructor($("#analytics-status-chart", view), {
      type: "doughnut",
      data: {
        labels: [t("analytics.toDo"), t("analytics.inProgress"), t("analytics.completed")],
        datasets: [{ data: [counts.todo, counts.progress, counts.completed], backgroundColor: ["#e8e9ef", "#8db4e8", "#2e9c73"], borderWidth: 0, hoverOffset: 5 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 18, font: { family: "DM Sans", size: 11 } } } }
      }
    });
    priorityChart = new ChartConstructor($("#analytics-priority-chart", view), {
      type: "bar",
      data: {
        labels: [t("analytics.low"), t("analytics.medium"), t("analytics.high")],
        datasets: [{
          label: t("analytics.tasks"),
          data: [counts.low, counts.medium, counts.high],
          backgroundColor: ["#8db7e6", "#f0bd79", "#e79088"],
          borderRadius: 7,
          maxBarThickness: 54
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1, color: "#9295a8" }, grid: { color: "#f0f1f6" }, border: { display: false } },
          x: { ticks: { color: "#77798e" }, grid: { display: false }, border: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  function render() {
    const signature = JSON.stringify({
      language: getLanguage(),
      tasks: state.tasks.map(task => [task.id, task.status, task.priority, task.subjectId, task.dueDate]),
      subjects: state.subjects.map(subject => [subject.id, subject.name, subject.color])
    });
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    const hasTasks = state.tasks.length > 0;
    empty.classList.toggle("hidden", hasTasks);
    content.classList.toggle("hidden", !hasTasks);
    if (!hasTasks) {
      destroyCharts();
      lastChartSignature = null;
      return;
    }

    const counts = { total: state.tasks.length, todo: 0, progress: 0, completed: 0, low: 0, medium: 0, high: 0 };
    state.tasks.forEach(task => {
      if (task.status === "todo") counts.todo += 1;
      else if (task.status === "progress") counts.progress += 1;
      else if (task.status === "completed") counts.completed += 1;
      const priority = String(task.priority || "").toLowerCase();
      if (priority === "low") counts.low += 1;
      else if (priority === "medium") counts.medium += 1;
      else if (priority === "high") counts.high += 1;
    });
    const completionRate = Math.round(counts.completed / counts.total * 100);
    renderOverview(counts, completionRate);
    renderSubjectBreakdown();
    renderDeadlines();
    const chartSignature = JSON.stringify({
      language: getLanguage(),
      counts: [counts.todo, counts.progress, counts.completed, counts.low, counts.medium, counts.high]
    });
    renderCharts(counts, chartSignature);
  }

  function refreshLanguage() {
    const heading = view.querySelector(".analytics-heading");
    heading.querySelector("h1").textContent = t("analytics.title");
    heading.querySelector("p").textContent = t("analytics.subtitle");
    empty.querySelector("h2").textContent = t("analytics.emptyTitle");
    empty.querySelector("p").textContent = t("analytics.empty");
    const cards = view.querySelectorAll(".analytics-card-heading");
    const titles = ["analytics.status", "analytics.priorityChart", "analytics.subjectBreakdown", "analytics.deadlines"];
    const details = ["analytics.distribution", "analytics.distribution", "analytics.subjectTotals", "analytics.localCalendar"];
    cards.forEach((card, index) => {
      card.querySelector("h2").textContent = t(titles[index]);
      card.querySelector("p").textContent = t(details[index]);
    });
    $("#analytics-status-chart", view).setAttribute("aria-label", t("analytics.statusChartAria"));
    $("#analytics-priority-chart", view).setAttribute("aria-label", t("analytics.priorityChartAria"));
    render();
  }

  function destroy() {
    destroyCharts();
    lastRenderSignature = null;
    lastChartSignature = null;
  }

  return { view, render, refreshLanguage, destroy };
}

