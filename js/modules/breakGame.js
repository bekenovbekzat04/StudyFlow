export function startBreakGame(container) {
  if (!container) return;

  if (container._breakGameCleanup) {
    container._breakGameRunning = true;
    return;
  }

  container.innerHTML = `
    <div class="break-game-heading">
      <span class="break-game-indicator">BREAK</span>
      <span class="break-game-score">Score <strong>0</strong></span>
    </div>
    <canvas class="break-game-canvas" width="320" height="220" tabindex="0" aria-label="Break flying game"></canvas>
    <div class="break-game-over hidden" role="status">
      <strong>Game Over</strong>
      <button type="button" class="break-game-restart">Restart</button>
    </div>
    <p class="break-game-instruction">Space / Tap</p>`;

  const canvas = container.querySelector(".break-game-canvas");
  const context = canvas.getContext("2d");
  const scoreElement = container.querySelector(".break-game-score strong");
  const gameOverElement = container.querySelector(".break-game-over");
  const restartButton = container.querySelector(".break-game-restart");

  let width = 320;
  let height = 220;
  let frameId = null;
  let lastTime = 0;
  let running = true;
  let over = false;
  let score = 0;
  let bird;
  let gates = [];
  let gateTimer = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(280, Math.round(rect.width || 320));
    height = 220;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function reset() {
    score = 0;
    scoreElement.textContent = "0";
    bird = { x: width * 0.24, y: height * 0.48, velocity: -70, radius: 12 };
    gates = [];
    gateTimer = 0.2;
    over = false;
    running = true;
    gameOverElement.classList.add("hidden");
  }

  function flap() {
    if (!running) return;
    bird.velocity = -310;
  }

  function addGate() {
    const gap = 82;
    const margin = 42;
    const gapTop = margin + Math.random() * (height - gap - margin * 2);
    gates.push({ x: width + 40, width: 46, gapTop, gapBottom: gapTop + gap, passed: false });
  }

  function roundedRect(x, y, w, h, radius) {
    context.beginPath();
    context.roundRect(x, y, w, h, radius);
  }

  function drawBird() {
    context.save();
    context.translate(bird.x, bird.y);
    const tilt = Math.max(-0.35, Math.min(0.5, bird.velocity / 600));
    context.rotate(tilt);

    context.fillStyle = "#7765e9";
    context.beginPath();
    context.ellipse(0, 0, 15, 12, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#9b8cf1";
    context.beginPath();
    context.ellipse(-4, 4, 8, 5, -0.35, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(6, -4, 4.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#414258";
    context.beginPath();
    context.arc(7, -4, 1.8, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#e9b35f";
    context.beginPath();
    context.moveTo(14, -1);
    context.lineTo(21, 3);
    context.lineTo(14, 6);
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawGate(gate) {
    context.fillStyle = "#dedaf3";
    context.strokeStyle = "#cbc5e8";
    context.lineWidth = 1;

    roundedRect(gate.x, -8, gate.width, gate.gapTop + 8, 12);
    context.fill();
    context.stroke();

    roundedRect(gate.x, gate.gapBottom, gate.width, height - gate.gapBottom + 8, 12);
    context.fill();
    context.stroke();

    context.fillStyle = "#efedfa";
    context.beginPath();
    context.arc(gate.x + gate.width * 0.5, gate.gapTop - 4, 5, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(gate.x + gate.width * 0.5, gate.gapBottom + 4, 5, 0, Math.PI * 2);
    context.fill();
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fbfaff";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "#f1eff8";
    context.lineWidth = 1;
    for (let y = 35; y < height; y += 35) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    gates.forEach(drawGate);
    drawBird();
  }

  function gameOver() {
    if (over) return;
    over = true;
    running = false;
    gameOverElement.classList.remove("hidden");
  }

  function update(delta) {
    if (!running) return;
    bird.velocity += 760 * delta;
    bird.y += bird.velocity * delta;

    gateTimer -= delta;
    if (gateTimer <= 0) {
      addGate();
      gateTimer = 1.55;
    }

    gates.forEach(gate => {
      gate.x -= 118 * delta;
      if (!gate.passed && gate.x + gate.width < bird.x) {
        gate.passed = true;
        score += 1;
        scoreElement.textContent = String(score);
      }

      if (bird.x + bird.radius > gate.x && bird.x - bird.radius < gate.x + gate.width &&
          (bird.y - bird.radius < gate.gapTop || bird.y + bird.radius > gate.gapBottom)) {
        gameOver();
      }
    });
    gates = gates.filter(gate => gate.x + gate.width > -10);

    if (bird.y - bird.radius < 0 || bird.y + bird.radius > height) gameOver();
  }

  function loop(time) {
    if (!running) {
      draw();
      frameId = null;
      return;
    }
    const delta = Math.min(0.032, (time - lastTime) / 1000 || 0);
    lastTime = time;
    update(delta);
    draw();
    if (running) frameId = window.requestAnimationFrame(loop);
  }

  function onKeyDown(event) {
    if (event.code !== "Space") return;
    const active = document.activeElement;
    if (active !== canvas && active !== container && active !== document.body) return;
    event.preventDefault();
    if (over) return;
    flap();
  }

  function onPointerDown(event) {
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    if (!over) flap();
  }

  function onRestart() {
    reset();
    lastTime = performance.now();
    frameId = window.requestAnimationFrame(loop);
  }

  function cleanup() {
    running = false;
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    document.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("pointerdown", onPointerDown);
    restartButton.removeEventListener("click", onRestart);
  }

  document.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("pointerdown", onPointerDown);
  restartButton.addEventListener("click", onRestart);

  resize();
  reset();
  addGate();
  lastTime = performance.now();
  frameId = window.requestAnimationFrame(loop);

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  if (resizeObserver) resizeObserver.observe(canvas);

  container._breakGameRunning = true;
  container._breakGameCleanup = () => {
    cleanup();
    if (resizeObserver) resizeObserver.disconnect();
    container._breakGameRunning = false;
    container.innerHTML = "";
  };
}

export function stopBreakGame(container) {
  if (!container) return;
  if (container._breakGameCleanup) container._breakGameCleanup();
  container._breakGameCleanup = null;
  container._breakGameRunning = false;
  container.innerHTML = "";
}
