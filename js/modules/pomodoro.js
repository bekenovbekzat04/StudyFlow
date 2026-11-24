import { $ } from "../utils/dom.js";
import { escapeHTML } from "../utils/helpers.js";
import { t } from "../utils/i18n.js";
import { startBreakGame, stopBreakGame } from "./breakGame.js";

const MODES = {
  focus: { minutes: 25 },
  short: { minutes: 5 },
  long: { minutes: 15 }
};

export function initPomodoro({ state }) {
  const pageContent = $(".page-content");
  const view = document.createElement("section");
  view.id = "focus-mode-page";
  view.className = "focus-page hidden";
  view.innerHTML = `<div class="focus-page-heading"><div><h1>Focus Mode</h1><p>A little focused time goes a long way.</p></div></div><div class="focus-layout"><section class="focus-timer-card" aria-label="Pomodoro timer"><div class="focus-mode-tabs" role="group" aria-label="Timer mode"><button type="button" data-pomodoro-mode="focus" class="active">Focus</button><button type="button" data-pomodoro-mode="short">Short Break</button><button type="button" data-pomodoro-mode="long">Long Break</button></div><div class="focus-timer-ring" id="focus-timer-ring"><div class="focus-timer-face"><span id="focus-time">25:00</span><small id="focus-mode-label">Focus</small></div></div><div class="focus-controls"><button type="button" class="primary-button" id="focus-start">Start</button><button type="button" class="secondary-button hidden" id="focus-pause">Pause</button><button type="button" class="primary-button hidden" id="focus-resume">Resume</button><button type="button" class="secondary-button" id="focus-reset">Reset</button></div><p class="focus-status" id="focus-status" role="status" aria-live="polite">Ready when you are.</p></section><aside class="focus-task-card"><div class="focus-task-selection"><span class="eyebrow">YOUR SESSION</span><h2>What are you focusing on?</h2><p>Select one of your current tasks to keep it in view while you work.</p><label class="field-label" for="focus-task-select">Task<select id="focus-task-select"><option value="">${t("focus.noTask")}</option></select></label><div class="focus-selected-task"><span class="focus-selected-mark">✦</span><div><small>Currently selected</small><strong id="focus-task-title">No task selected</strong></div></div></div><div id="break-game-panel" class="break-game-panel hidden" aria-label="Break mini-game"></div></aside></div>`;
  pageContent.append(view);

  const durationSeconds = () => MODES[mode].minutes * 60;
  let mode = "focus";
  let remainingSeconds = MODES[mode].minutes * 60;
  let deadline = null;
  let intervalId = null;
  let paused = false;
  let finished = false;
  let completionPlayed = false;
  let audioContext = null;
  let statusKey = "focus.ready";
  let breakGameAllowed = false;

  const timeDisplay = $("#focus-time", view);
  const modeLabel = $("#focus-mode-label", view);
  const statusDisplay = $("#focus-status", view);
  const ring = $("#focus-timer-ring", view);
  const startButton = $("#focus-start", view);
  const pauseButton = $("#focus-pause", view);
  const resumeButton = $("#focus-resume", view);
  const taskSelect = $("#focus-task-select", view);
  const taskTitle = $("#focus-task-title", view);

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function render() {
    const total = durationSeconds();
    const progress = Math.max(0, Math.min(100, ((total - remainingSeconds) / total) * 100));
    timeDisplay.textContent = formatTime(remainingSeconds);
    modeLabel.textContent = t(`focus.${mode}`);
    statusDisplay.textContent = t(statusKey, { mode: t(`focus.${mode}`) });
    ring.style.setProperty("--focus-progress", `${progress}%`);
    startButton.classList.toggle("hidden", intervalId !== null || paused);
    pauseButton.classList.toggle("hidden", intervalId === null);
    resumeButton.classList.toggle("hidden", !paused);
    view.querySelectorAll("[data-pomodoro-mode]").forEach(button => button.classList.toggle("active", button.dataset.pomodoroMode === mode));
    taskTitle.textContent = state.tasks.find(task => String(task.id) === taskSelect.value)?.title || t("focus.noTask");
    syncBreakGame();
  }

  function syncBreakGame() {
    const taskSelection = view.querySelector(".focus-task-selection");
    const gamePanel = $("#break-game-panel", view);
    const isBreak = mode === "short" || mode === "long";
    const isBreakActive = isBreak && breakGameAllowed && intervalId !== null && !finished && !view.classList.contains("hidden");
    taskSelection.classList.toggle("hidden", isBreakActive);
    gamePanel.classList.toggle("hidden", !isBreakActive);

    if (isBreakActive) {
      startBreakGame(gamePanel);
    } else {
      stopBreakGame(gamePanel);
    }
  }

  function clearTimer() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    deadline = null;
  }

  function playCompletionSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext ||= new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
      const now = audioContext.currentTime;
      [660, 880].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const startAt = now + index * 0.16;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.24);
      });
    } catch (_) { /* Audio may be unavailable or blocked; timer completion still works. */ }
  }

  function complete() {
    if (finished) return;
    clearTimer();
    breakGameAllowed = false;
    stopBreakGame($("#break-game-panel", view));
    remainingSeconds = 0;
    paused = false;
    finished = true;
    statusKey = "focus.completed";
    if (!completionPlayed) {
      completionPlayed = true;
      playCompletionSound();
    }
  }

  function tick() {
    if (deadline === null) return;
    remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remainingSeconds === 0) {
      complete();
    }
    render();
  }

  function start() {
    if (intervalId !== null) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioContext ||= new AudioContextClass();
        if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
      }
    } catch (_) { /* Continue timer without audio when unavailable. */ }
    if (finished || remainingSeconds <= 0) remainingSeconds = durationSeconds();
    paused = false;
    finished = false;
    completionPlayed = false;
    statusKey = "focus.inProgress";
    deadline = Date.now() + remainingSeconds * 1000;
    intervalId = window.setInterval(tick, 1000);
    breakGameAllowed = mode === "short" || mode === "long";
    render();
  }

  function pause() {
    if (intervalId === null) return;
    remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remainingSeconds === 0) {
      complete();
      render();
      return;
    }
    clearTimer();
    breakGameAllowed = false;
    paused = remainingSeconds > 0;
    finished = remainingSeconds === 0;
    statusKey = finished ? "focus.completed" : "focus.paused";
    render();
  }

  function reset() {
    clearTimer();
    breakGameAllowed = false;
    remainingSeconds = durationSeconds();
    paused = false;
    finished = false;
    completionPlayed = false;
    statusKey = "focus.resetMessage";
    render();
  }

  function switchMode(nextMode) {
    if (!MODES[nextMode]) return;
    clearTimer();
    mode = nextMode;
    breakGameAllowed = false;
    if (mode === "focus") stopBreakGame($("#break-game-panel", view));
    remainingSeconds = durationSeconds();
    paused = false;
    finished = false;
    completionPlayed = false;
    statusKey = "focus.modeReady";
    render();
  }

  function refreshTasks() {
    const selectedId = taskSelect.value;
    const activeTasks = state.tasks.filter(task => task.status !== "completed");
    taskSelect.innerHTML = `<option value="">${t("focus.noTask")}</option>` + activeTasks
      .map(task => `<option value="${escapeHTML(task.id)}">${escapeHTML(task.title)}</option>`).join("");
    taskSelect.value = activeTasks.some(task => String(task.id) === selectedId) ? selectedId : "";
    render();
  }

  view.querySelectorAll("[data-pomodoro-mode]").forEach(button => button.addEventListener("click", () => switchMode(button.dataset.pomodoroMode)));
  startButton.addEventListener("click", start);
  pauseButton.addEventListener("click", pause);
  resumeButton.addEventListener("click", start);
  $("#focus-reset", view).addEventListener("click", reset);
  taskSelect.addEventListener("change", render);
  refreshTasks();

  function refreshLanguage() {
    const heading = view.querySelector(".focus-page-heading");
    heading.querySelector("h1").textContent = t("focus.title");
    heading.querySelector("p").textContent = t("focus.subtitle");
    view.querySelector(".focus-timer-card").setAttribute("aria-label", t("focus.title"));
    view.querySelector(".focus-mode-tabs").setAttribute("aria-label", t("focus.title"));
    view.querySelectorAll("[data-pomodoro-mode]").forEach(button => { button.textContent = t(`focus.${button.dataset.pomodoroMode}`); });
    startButton.textContent = t("focus.start");
    pauseButton.textContent = t("focus.pause");
    resumeButton.textContent = t("focus.resume");
    $("#focus-reset", view).textContent = t("focus.reset");
    view.querySelector(".focus-task-card .eyebrow").textContent = t("focus.session");
    view.querySelector(".focus-task-card h2").textContent = t("focus.question");
    view.querySelector(".focus-task-selection > p").textContent = t("focus.description");
    view.querySelector(".focus-task-card label").childNodes[0].textContent = t("focus.task");
    view.querySelector(".focus-selected-task small").textContent = t("focus.selected");
    refreshTasks();
  }
  refreshLanguage();

  return {
    view,
    refreshTasks,
    refreshLanguage,
    stop() {
      clearTimer();
      breakGameAllowed = false;
      stopBreakGame($("#break-game-panel", view));
      paused = false;
      finished = false;
      remainingSeconds = durationSeconds();
      statusKey = "focus.ready";
      completionPlayed = false;
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
      }
      render();
      taskSelect.value = "";
      render();
    },
    destroy() {
      clearTimer();
      breakGameAllowed = false;
      stopBreakGame($("#break-game-panel", view));
      if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
      view.remove();
    }
  };
}

