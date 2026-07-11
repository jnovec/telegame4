const size = 8;
const gemTypes = ["◆", "●", "✦", "⬟", "✹", "♥"];
const baseTime = 60;
const minimumTime = 22;
const baseTargetScore = 1600;
const targetStep = 850;
const fireworksSoundFiles = [
  "sounds/explosion0.mp3",
  "sounds/explosion1.mp3",
  "sounds/explosion2.mp3",
];
const rotationSoundFile = "sounds/rotation-whoosh.mp3";

const boardEl = document.querySelector("#board");
const scoreEl = document.querySelector("#score");
const levelEl = document.querySelector("#level");
const timeEl = document.querySelector("#time");
const targetEl = document.querySelector("#target");
const progressEl = document.querySelector("#progress");
const messageEl = document.querySelector("#message");
const newGameBtn = document.querySelector("#newGame");
const toggleMusicBtn = document.querySelector("#toggleMusic");
const toggleSoundBtn = document.querySelector("#toggleSound");
const instructionModalEl = document.querySelector("#instructionModal");
const instructionOkBtn = document.querySelector("#instructionOk");
const adModalEl = document.querySelector("#adModal");
const watchAdBtn = document.querySelector("#watchAd");
const skipAdBtn = document.querySelector("#skipAd");
const fireworksEl = document.querySelector("#fireworks");
const telegramApp = window.Telegram?.WebApp;
let backgroundMusicEl = document.querySelector("#background-music");

let board = [];
let selected = null;
let hintCells = [];
let score = 0;
let totalScore = 0;
let level = 1;
let targetScore = baseTargetScore;
let timeLeft = baseTime;
let locked = false;
let idleTimer = null;
let gameTimer = null;
let audioContext = null;
let fireworks = null;
let fireworksTimer = null;
let fireworksBursts = [];
let finishFireworks = null;
let dragStart = null;
let swapMarks = [];
let activeCell = null;
let draggingCell = null;
let rotationTimer = null;
let boardRotation = 0;
let adContinueUsed = false;
let waitingForInstructions = false;
let suppressNextClick = false;
let soundEnabled = true;
let musicEnabled = true;
let lastControlPointerTime = 0;

targetEl.textContent = targetScore;

function setupTelegram() {
  if (!telegramApp) return;

  telegramApp.ready();
  telegramApp.expand();

  if (telegramApp.disableVerticalSwipes) {
    telegramApp.disableVerticalSwipes();
  }

  document.documentElement.classList.add("telegram-webapp");
  document.body.style.backgroundColor = telegramApp.backgroundColor || "#101824";
}

function updateTelegramViewport() {
  const height = telegramApp?.viewportStableHeight || telegramApp?.viewportHeight || window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

setupTelegram();
updateTelegramViewport();
window.addEventListener("resize", () => {
  updateTelegramViewport();
});

if (telegramApp) {
  telegramApp.onEvent("viewportChanged", () => {
    updateTelegramViewport();
  });
}

function randomGem() {
  return Math.floor(Math.random() * gemTypes.length);
}

function index(row, col) {
  return row * size + col;
}

function position(cellIndex) {
  return {
    row: Math.floor(cellIndex / size),
    col: cellIndex % size,
  };
}

function areNeighbors(a, b) {
  const pa = position(a);
  const pb = position(b);
  return Math.abs(pa.row - pb.row) + Math.abs(pa.col - pb.col) === 1;
}

function createBoard() {
  board = Array.from({ length: size * size }, (_, cell) => {
    let gem = randomGem();
    const { row, col } = position(cell);

    while (
      (col >= 2 && board[index(row, col - 1)] === gem && board[index(row, col - 2)] === gem) ||
      (row >= 2 && board[index(row - 1, col)] === gem && board[index(row - 2, col)] === gem)
    ) {
      gem = randomGem();
    }

    return gem;
  });
}

function render() {
  boardEl.innerHTML = "";

  board.forEach((gem, cell) => {
    const button = document.createElement("button");
    button.className = `gem gem-${gem}`;
    button.type = "button";
    button.dataset.cell = cell;
    button.textContent = gemTypes[gem];
    button.setAttribute("aria-label", `Kamen ${gemTypes[gem]}`);

    if (selected === cell) {
      button.classList.add("selected");
    }

    if (hintCells.includes(cell)) {
      button.classList.add("hinted");
    }

    if (swapMarks.includes(cell)) {
      button.classList.add("swap-mark");
    }

    if (activeCell === cell) {
      button.classList.add("pressed");
    }

    if (draggingCell === cell) {
      button.classList.add("dragging");
    }

    boardEl.append(button);
  });

  renderStatsOnly();
}

function updateInteractionClasses() {
  boardEl.querySelectorAll(".gem").forEach((gem) => {
    const cell = Number(gem.dataset.cell);
    gem.classList.toggle("selected", selected === cell);
    gem.classList.toggle("hinted", hintCells.includes(cell));
    gem.classList.toggle("swap-mark", swapMarks.includes(cell));
    gem.classList.toggle("pressed", activeCell === cell);
    gem.classList.toggle("dragging", draggingCell === cell);
  });
}

function renderCells(cells) {
  cells.forEach((cell) => {
    const gem = boardEl.querySelector(`[data-cell="${cell}"]`);
    if (!gem) return;

    for (let type = 0; type < gemTypes.length; type += 1) {
      gem.classList.remove(`gem-${type}`);
    }

    gem.classList.add(`gem-${board[cell]}`);
    gem.textContent = gemTypes[board[cell]];
    gem.setAttribute("aria-label", `Kamen ${gemTypes[board[cell]]}`);
  });

  updateInteractionClasses();
}

function clearInteractionState() {
  selected = null;
  hintCells = [];
  swapMarks = [];
  activeCell = null;
  draggingCell = null;
  dragStart = null;
}

function findMatches() {
  const matches = new Set();

  for (let row = 0; row < size; row += 1) {
    let runStart = 0;
    for (let col = 1; col <= size; col += 1) {
      const current = col < size ? board[index(row, col)] : null;
      const previous = board[index(row, col - 1)];

      if (current !== previous) {
        if (col - runStart >= 3) {
          for (let matchCol = runStart; matchCol < col; matchCol += 1) {
            matches.add(index(row, matchCol));
          }
        }
        runStart = col;
      }
    }
  }

  for (let col = 0; col < size; col += 1) {
    let runStart = 0;
    for (let row = 1; row <= size; row += 1) {
      const current = row < size ? board[index(row, col)] : null;
      const previous = board[index(row - 1, col)];

      if (current !== previous) {
        if (row - runStart >= 3) {
          for (let matchRow = runStart; matchRow < row; matchRow += 1) {
            matches.add(index(matchRow, col));
          }
        }
        runStart = row;
      }
    }
  }

  return [...matches];
}

function swap(a, b) {
  [board[a], board[b]] = [board[b], board[a]];
}

function rotateBoardData(clockwise) {
  const nextBoard = Array(board.length);

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const from = index(row, col);
      const to = clockwise ? index(col, size - 1 - row) : index(size - 1 - col, row);
      nextBoard[to] = board[from];
    }
  }

  board = nextBoard;
}

function swapWithAnimation(a, b) {
  const first = boardEl.querySelector(`[data-cell="${a}"]`);
  const second = boardEl.querySelector(`[data-cell="${b}"]`);
  if (!first || !second) return;

  first.classList.add("swapping");
  second.classList.add("swapping");
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function showMessage(text) {
  messageEl.textContent = text;
  messageEl.classList.add("show");
  window.setTimeout(() => messageEl.classList.remove("show"), 1400);
}

function playRandomExplosion(volume = 0.75, delay = 0) {
  if (!soundEnabled) return;

  const file = fireworksSoundFiles[Math.floor(Math.random() * fireworksSoundFiles.length)];
  const audio = new Audio(file);
  audio.preload = "auto";
  audio.volume = volume;
  window.setTimeout(() => {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, delay);
}

function playRotationWhoosh() {
  if (!soundEnabled) return;

  const audio = new Audio(rotationSoundFile);
  audio.preload = "auto";
  audio.volume = 0.7;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
}

function playTone(frequency, duration, type = "sine", gain = 0.04, delay = 0) {
  if (!audioContext) return;

  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(volume);
  volume.connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playNoise(duration, gain = 0.05, delay = 0, filterFrequency = 900) {
  if (!audioContext) return;

  const start = audioContext.currentTime + delay;
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);
  const noise = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const volume = audioContext.createGain();

  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFrequency, start);
  filter.Q.setValueAtTime(0.8, start);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.018);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  noise.buffer = buffer;
  noise.connect(filter);
  filter.connect(volume);
  volume.connect(audioContext.destination);
  noise.start(start);
  noise.stop(start + duration + 0.02);
}

function playSound(name, power = 1) {
  if (!soundEnabled) return;

  ensureAudio();

  if (name === "select") {
    playTone(540, 0.08, "triangle", 0.025);
  }

  if (name === "swap") {
    playTone(420, 0.08, "sine", 0.025);
    playTone(620, 0.1, "sine", 0.025, 0.055);
  }

  if (name === "bad") {
    playTone(220, 0.13, "sawtooth", 0.02);
    playTone(160, 0.15, "sawtooth", 0.018, 0.07);
  }

  if (name === "match") {
    const base = Math.min(900, 430 + power * 34);
    playTone(base, 0.09, "triangle", 0.04);
    playTone(base * 1.25, 0.11, "triangle", 0.035, 0.05);
    playTone(base * 1.5, 0.13, "sine", 0.03, 0.1);
  }

  if (name === "win") {
    [523, 659, 784, 1046].forEach((note, step) => {
      playTone(note, 0.16, "triangle", 0.045, step * 0.08);
    });
  }

  if (name === "hint") {
    playTone(760, 0.07, "sine", 0.018);
    playTone(960, 0.1, "sine", 0.016, 0.08);
  }

  if (name === "tick") {
    playTone(280, 0.045, "square", 0.012);
  }

  if (name === "lose") {
    [330, 247, 196].forEach((note, step) => {
      playTone(note, 0.18, "sawtooth", 0.025, step * 0.09);
    });
  }

  if (name === "firework") {
    const pitch = 620 + Math.random() * 320;
    playTone(pitch, 0.18, "sine", 0.018);
    playTone(92, 0.28, "triangle", 0.055, 0.16);
    playNoise(0.34, 0.055, 0.14, 420);

    for (let i = 0; i < 7; i += 1) {
      playTone(900 + Math.random() * 950, 0.045, "triangle", 0.012, 0.24 + i * 0.045);
      playNoise(0.055, 0.015, 0.23 + i * 0.05, 1600 + Math.random() * 1200);
    }
  }
}

function createFireworks() {
  if (fireworks || !window.Fireworks || !fireworksEl) return fireworks;

  fireworks = new Fireworks.default(fireworksEl, {
    autoresize: true,
    opacity: 0.65,
    acceleration: 1.04,
    friction: 0.97,
    gravity: 1.35,
    particles: 82,
    traceLength: 4,
    traceSpeed: 11,
    explosion: 7,
    intensity: 34,
    flickering: 62,
    lineStyle: "round",
    hue: { min: 15, max: 330 },
    delay: { min: 18, max: 38 },
    brightness: { min: 55, max: 88 },
    decay: { min: 0.016, max: 0.028 },
    rocketsPoint: { min: 20, max: 80 },
    lineWidth: {
      explosion: { min: 1, max: 3 },
      trace: { min: 1, max: 2 },
    },
    mouse: {
      click: false,
      move: false,
      max: 1,
    },
    sound: {
      enabled: false,
      files: fireworksSoundFiles,
      volume: { min: 3, max: 8 },
    },
  });

  return fireworks;
}

function stopFireworks() {
  window.clearTimeout(fireworksTimer);
  fireworksBursts.forEach((timer) => window.clearTimeout(timer));
  fireworksBursts = [];
  if (fireworks) {
    fireworks.stop(false);
    fireworks.clear();
  }
  fireworksEl.classList.remove("active");
  if (finishFireworks) {
    finishFireworks();
    finishFireworks = null;
  }
}

function celebrateLevelWin() {
  const show = createFireworks();
  if (!show) return Promise.resolve();

  window.clearTimeout(fireworksTimer);
  fireworksBursts.forEach((timer) => window.clearTimeout(timer));
  fireworksBursts = [];
  fireworksEl.classList.add("active");
  show.start();
  show.launch(16);
  playRandomExplosion(0.85);
  playRandomExplosion(0.55, 180);
  playSound("firework");
  [900, 1800, 2900, 4100, 5400].forEach((delay, burst) => {
    const burstTimer = window.setTimeout(() => {
      show.launch(10 + burst * 2);
      playRandomExplosion(0.78);
      if (burst % 2 === 0) {
        playRandomExplosion(0.48, 160);
      }
      playSound("firework");
    }, delay);
    fireworksBursts.push(burstTimer);
  });

  return new Promise((resolve) => {
    finishFireworks = resolve;
    fireworksTimer = window.setTimeout(() => {
      show.waitStop(false);
      fireworksEl.classList.remove("active");
      fireworksBursts = [];
      finishFireworks = null;
      resolve();
    }, 7000);
  });
}

function addSparkles(cells) {
  cells.forEach((cell) => {
    const gem = boardEl.querySelector(`[data-cell="${cell}"]`);
    if (!gem) return;

    for (let i = 0; i < 4; i += 1) {
      const sparkle = document.createElement("span");
      sparkle.className = "sparkle";
      sparkle.style.setProperty("--x", `${Math.cos(i * 1.57) * 24}px`);
      sparkle.style.setProperty("--y", `${Math.sin(i * 1.57) * 24}px`);
      gem.append(sparkle);
    }
  });
}

async function clearMatches(initialMatches) {
  let matches = initialMatches;
  let chain = 0;

  while (matches.length > 0) {
    selected = null;
    hintCells = [];
    swapMarks = [];
    activeCell = null;
    draggingCell = null;
    updateInteractionClasses();
    chain += 1;
    score += matches.length * 70 * chain;
    playSound("match", matches.length * chain);
    addSparkles(matches);

    matches.forEach((cell) => {
      const gem = boardEl.querySelector(`[data-cell="${cell}"]`);
      if (gem) {
        gem.classList.add("matched");
      }
    });

    renderStatsOnly();
    await wait(320);

    matches.forEach((cell) => {
      board[cell] = null;
    });

    dropGems();
    render();
    await wait(220);
    matches = findMatches();
  }
}

function renderStatsOnly() {
  levelEl.textContent = level;
  scoreEl.textContent = score;
  timeEl.textContent = timeLeft;
  targetEl.textContent = targetScore;
  timeEl.parentElement.classList.toggle("danger", timeLeft <= 10);
  updateLightningSpeed();
  progressEl.style.width = `${Math.min(100, Math.round((score / targetScore) * 100))}%`;
}

function updateLightningSpeed() {
  const total = Math.max(1, levelTime());
  const progress = 1 - Math.max(0, Math.min(1, timeLeft / total));
  const speed = 4.2 - progress * 3.65;
  document.documentElement.style.setProperty("--lightning-speed", `${speed.toFixed(2)}s`);
}

function dropGems() {
  for (let col = 0; col < size; col += 1) {
    const column = [];

    for (let row = size - 1; row >= 0; row -= 1) {
      const value = board[index(row, col)];
      if (value !== null) {
        column.push(value);
      }
    }

    while (column.length < size) {
      column.push(randomGem());
    }

    for (let row = size - 1; row >= 0; row -= 1) {
      board[index(row, col)] = column[size - 1 - row];
    }
  }
}

function levelTime(nextLevel = level) {
  return Math.max(minimumTime, baseTime - (nextLevel - 1) * 5);
}

function levelTarget(nextLevel = level) {
  return baseTargetScore + (nextLevel - 1) * targetStep;
}

function stopGameTimer() {
  window.clearInterval(gameTimer);
  gameTimer = null;
}

function stopRotationTimer() {
  window.clearTimeout(rotationTimer);
  rotationTimer = null;
}

function scheduleBoardRotation() {
  stopRotationTimer();
  if (locked || timeLeft <= 0 || waitingForInstructions) return;

  rotationTimer = window.setTimeout(async () => {
    if (!locked && timeLeft > 0 && !waitingForInstructions) {
      await rotateBoardRandomly();
    }
    scheduleBoardRotation();
  }, 5000 + Math.random() * 5000);
}

function startGameTimer() {
  stopGameTimer();
  gameTimer = window.setInterval(() => {
    if (locked) return;

    timeLeft -= 1;
    renderStatsOnly();

    if (timeLeft <= 10 && timeLeft > 0) {
      playSound("tick");
    }

    if (timeLeft <= 0) {
      finishGame();
    }
  }, 1000);
}

function finishGame() {
  stopGameTimer();
  stopRotationTimer();
  window.clearTimeout(idleTimer);
  stopFireworks();
  locked = true;
  clearInteractionState();
  render();
  newGameBtn.classList.remove("hidden");
  playSound("lose");
  showMessage(`Konec casu. Celkem ${totalScore + score} bodu.`);
  if (!adContinueUsed) {
    adModalEl.classList.add("show");
  }
}

async function advanceLevel() {
  stopGameTimer();
  stopRotationTimer();
  window.clearTimeout(idleTimer);
  locked = true;
  totalScore += score;
  playSound("win");
  showMessage(`Level ${level} hotov!`);
  await celebrateLevelWin();

  level += 1;
  score = 0;
  targetScore = levelTarget();
  timeLeft = levelTime();
  clearInteractionState();

  do {
    createBoard();
  } while (!hasPossibleMove());

  locked = false;
  render();
  showMessage(`Level ${level}: ${timeLeft} sekund, cil ${targetScore}.`);
  startGameTimer();
  scheduleBoardRotation();
  scheduleHint();
}

function hasPossibleMove() {
  return Boolean(findBestMove());
}

function findBestMove() {
  let bestMove = null;

  for (let cell = 0; cell < board.length; cell += 1) {
    const { row, col } = position(cell);
    const neighbors = [];

    if (col < size - 1) neighbors.push(index(row, col + 1));
    if (row < size - 1) neighbors.push(index(row + 1, col));

    for (const neighbor of neighbors) {
      swap(cell, neighbor);
      const matches = findMatches();
      swap(cell, neighbor);
      if (matches.length > 0 && (!bestMove || matches.length > bestMove.matches)) {
        bestMove = { cells: [cell, neighbor], matches: matches.length };
      }
    }
  }

  return bestMove;
}

function findBestMoveForCell(cell) {
  const { row, col } = position(cell);
  const neighbors = [];
  let bestMove = null;

  if (col > 0) neighbors.push(index(row, col - 1));
  if (col < size - 1) neighbors.push(index(row, col + 1));
  if (row > 0) neighbors.push(index(row - 1, col));
  if (row < size - 1) neighbors.push(index(row + 1, col));

  for (const neighbor of neighbors) {
    swap(cell, neighbor);
    const matches = findMatches();
    swap(cell, neighbor);

    if (matches.length > 0 && (!bestMove || matches.length > bestMove.matches)) {
      bestMove = { cells: [cell, neighbor], matches: matches.length };
    }
  }

  return bestMove;
}

function clearHint() {
  hintCells = [];
  updateInteractionClasses();
}

function scheduleHint() {
  window.clearTimeout(idleTimer);

  if (locked || timeLeft <= 0) return;

  idleTimer = window.setTimeout(() => {
    if (locked || timeLeft <= 0 || selected !== null) return;

    const bestMove = findBestMove();
    if (!bestMove) return;

    hintCells = bestMove.cells;
    updateInteractionClasses();
    playSound("hint");
    showMessage("Tady je dobry tah.");
  }, 4500);
}

function markActivity() {
  window.clearTimeout(idleTimer);
  if (hintCells.length > 0) {
    hintCells = [];
    updateInteractionClasses();
  }
}

async function reshuffleIfNeeded() {
  if (hasPossibleMove()) return;

  showMessage("Zadne tahy. Micham pole.");
  do {
    createBoard();
  } while (!hasPossibleMove());
  render();
  await wait(400);
}

async function rotateBoardRandomly() {
  locked = true;
  clearInteractionState();
  updateInteractionClasses();

  const clockwise = Math.random() > 0.5;
  const steps = 1 + Math.floor(Math.random() * 3);
  const degrees = steps * 90 * (clockwise ? 1 : -1);

  boardRotation += degrees;
  boardEl.style.setProperty("--board-rotation", `${boardRotation}deg`);
  boardEl.classList.add("rotating");
  playRotationWhoosh();
  showMessage(`${steps}x ${clockwise ? "doprava" : "doleva"}!`);

  await wait(840);

  for (let step = 0; step < steps; step += 1) {
    rotateBoardData(clockwise);
  }

  boardEl.classList.remove("rotating");
  boardEl.style.transition = "none";
  boardRotation = 0;
  boardEl.style.setProperty("--board-rotation", "0deg");
  render();
  boardEl.offsetHeight;
  boardEl.style.transition = "";

  await clearMatches(findMatches());
  if (score >= targetScore) {
    await advanceLevel();
    return;
  }

  await reshuffleIfNeeded();
  locked = false;
  scheduleHint();
}

async function trySwapCells(first, second) {
  if (locked || timeLeft <= 0 || first === second || !areNeighbors(first, second)) return;

  locked = true;
  selected = null;
  hintCells = [];
  activeCell = null;
  draggingCell = null;
  swapMarks = [first, second];
  updateInteractionClasses();
  await wait(260);
  playSound("swap");
  swap(first, second);
  renderCells([first, second]);
  swapWithAnimation(first, second);
  await wait(240);

  const matches = findMatches();
  if (matches.length === 0) {
    swap(first, second);
    playSound("bad");
    showMessage("Tenhle tah nic nespoji.");
    clearInteractionState();
    renderCells([first, second]);
  } else {
    swapMarks = [];
    activeCell = null;
    draggingCell = null;
    updateInteractionClasses();
    await clearMatches(matches);
    if (score >= targetScore) {
      await advanceLevel();
      return;
    } else {
      await reshuffleIfNeeded();
    }
  }

  locked = false;
  scheduleHint();
}

async function handleCellClick(event) {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  const button = event.target.closest(".gem");
  if (!button || locked || timeLeft <= 0) return;

  ensureAudio();

  const cell = Number(button.dataset.cell);

  if (hintCells.includes(cell) && hintCells.length === 2) {
    const [first, second] = hintCells;
    markActivity();
    await trySwapCells(first, second);
    return;
  }

  markActivity();

  if (selected === null) {
    const autoMove = findBestMoveForCell(cell);
    if (autoMove) {
      showMessage("Dobry tah, menim!");
      await trySwapCells(autoMove.cells[0], autoMove.cells[1]);
      return;
    }

    selected = cell;
    playSound("select");
    updateInteractionClasses();
    scheduleHint();
    return;
  }

  if (selected === cell) {
    selected = null;
    updateInteractionClasses();
    scheduleHint();
    return;
  }

  if (!areNeighbors(selected, cell)) {
    selected = cell;
    playSound("select");
    updateInteractionClasses();
    scheduleHint();
    return;
  }

  const first = selected;
  await trySwapCells(first, cell);
}

function cellFromDragDirection(startCell, deltaX, deltaY) {
  const { row, col } = position(startCell);

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > 0 && col < size - 1) return index(row, col + 1);
    if (deltaX < 0 && col > 0) return index(row, col - 1);
  } else {
    if (deltaY > 0 && row < size - 1) return index(row + 1, col);
    if (deltaY < 0 && row > 0) return index(row - 1, col);
  }

  return null;
}

function handlePointerDown(event) {
  const button = event.target.closest(".gem");
  if (!button || locked || timeLeft <= 0) return;

  ensureAudio();
  activeCell = Number(button.dataset.cell);
  draggingCell = null;
  updateInteractionClasses();

  dragStart = {
    cell: activeCell,
    x: event.clientX,
    y: event.clientY,
    moved: false,
  };
}

async function handlePointerUp(event) {
  if (!dragStart || locked || timeLeft <= 0) {
    clearInteractionState();
    updateInteractionClasses();
    return;
  }

  const deltaX = event.clientX - dragStart.x;
  const deltaY = event.clientY - dragStart.y;
  const distance = Math.hypot(deltaX, deltaY);
  const startCell = dragStart.cell;
  dragStart = null;
  activeCell = null;
  draggingCell = null;
  updateInteractionClasses();

  if (distance < 22) return;

  suppressNextClick = true;
  ensureAudio();
  markActivity();

  const targetCell = cellFromDragDirection(startCell, deltaX, deltaY);
  if (targetCell === null) return;

  await trySwapCells(startCell, targetCell);
}

function handlePointerMove(event) {
  if (!dragStart) return;

  const deltaX = event.clientX - dragStart.x;
  const deltaY = event.clientY - dragStart.y;
  if (Math.hypot(deltaX, deltaY) > 10) {
    if (!dragStart.moved) {
      activeCell = null;
      draggingCell = dragStart.cell;
      updateInteractionClasses();
    }
    dragStart.moved = true;
  }
}

function startGame() {
  window.clearTimeout(idleTimer);
  stopGameTimer();
  stopRotationTimer();
  stopFireworks();
  adModalEl.classList.remove("show");
  newGameBtn.classList.add("hidden");
  level = 1;
  score = 0;
  totalScore = 0;
  adContinueUsed = false;
  waitingForInstructions = true;
  targetScore = levelTarget();
  timeLeft = levelTime();
  clearInteractionState();
  locked = true;

  do {
    createBoard();
  } while (!hasPossibleMove());

  render();
  instructionModalEl.classList.add("show");
  showMessage("Stiskni OK a hra zacne.");
}

function beginGameAfterInstructions() {
  if (!waitingForInstructions) return;

  waitingForInstructions = false;
  instructionModalEl.classList.remove("show");
  locked = false;
  showMessage(`Level ${level}: ${timeLeft} sekund, cil ${targetScore}.`);
  startGameTimer();
  scheduleBoardRotation();
  scheduleHint();
}

function continueAfterAd() {
  adContinueUsed = true;
  adModalEl.classList.remove("show");
  newGameBtn.classList.add("hidden");
  timeLeft = 30;
  locked = false;
  renderStatsOnly();
  showMessage("Pokracujes jeste 30 sekund!");
  startGameTimer();
  scheduleBoardRotation();
  scheduleHint();
}

async function watchAdAndContinue() {
  if (adContinueUsed) return;

  watchAdBtn.disabled = true;
  watchAdBtn.textContent = "Reklama...";
  await wait(2500);
  watchAdBtn.disabled = false;
  watchAdBtn.textContent = "Reklama +30 s";
  continueAfterAd();
}

function playMusic() {
  if (!musicEnabled) return;

  backgroundMusicEl = backgroundMusicEl || document.querySelector("#background-music");
  if (!backgroundMusicEl) return;

  backgroundMusicEl.volume = 0.52;
  backgroundMusicEl.muted = false;
  backgroundMusicEl.play().catch(() => {});
}

function stopMusic() {
  backgroundMusicEl = backgroundMusicEl || document.querySelector("#background-music");
  if (backgroundMusicEl) {
    backgroundMusicEl.pause();
    backgroundMusicEl.muted = true;
  }
}

function unlockExplosionSounds() {
  if (!soundEnabled) return;

  [...fireworksSoundFiles, rotationSoundFile].forEach((file) => {
    const audio = new Audio(file);
    audio.volume = 0;
    audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
      })
      .catch(() => {});
  });
}

function toggleMusic() {
  backgroundMusicEl = backgroundMusicEl || document.querySelector("#background-music");
  if (!backgroundMusicEl) return;

  musicEnabled = !musicEnabled;

  if (musicEnabled) {
    playMusic();
  } else {
    stopMusic();
  }

  toggleMusicBtn.textContent = musicEnabled ? "MUSIC ON" : "MUSIC OFF";
  toggleMusicBtn.classList.toggle("off", !musicEnabled);
}

function markControlPointer(event) {
  lastControlPointerTime = Date.now();
  event.preventDefault();
  event.stopPropagation();
}

function shouldIgnoreFollowupClick() {
  return Date.now() - lastControlPointerTime < 500;
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  toggleSoundBtn.textContent = soundEnabled ? "SOUND ON" : "SOUND OFF";
  toggleSoundBtn.classList.toggle("off", !soundEnabled);
}

function handleControlPointer(event) {
  const musicButton = event.target.closest("#toggleMusic");
  const soundButton = event.target.closest("#toggleSound");
  if (!musicButton && !soundButton) return;

  markControlPointer(event);
  event.stopImmediatePropagation();

  if (musicButton) {
    toggleMusic();
  } else {
    toggleSound();
  }
}

function handleControlClick(event) {
  const musicButton = event.target.closest("#toggleMusic");
  const soundButton = event.target.closest("#toggleSound");
  if (!musicButton && !soundButton) return;

  event.preventDefault();
  event.stopPropagation();
  if (shouldIgnoreFollowupClick()) return;

  if (musicButton) {
    toggleMusic();
  } else {
    toggleSound();
  }
}

boardEl.addEventListener("click", handleCellClick);
boardEl.addEventListener("pointerdown", handlePointerDown);
boardEl.addEventListener("pointermove", handlePointerMove);
boardEl.addEventListener("pointerup", handlePointerUp);
boardEl.addEventListener("pointercancel", () => {
  clearInteractionState();
  updateInteractionClasses();
});
fireworksEl.addEventListener("click", stopFireworks);
fireworksEl.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  stopFireworks();
});

document.addEventListener("pointerdown", handleControlPointer, true);
document.addEventListener("click", handleControlClick, true);

document.body.addEventListener("pointerdown", () => {
  playMusic();
  unlockExplosionSounds();
}, { once: true });
newGameBtn.addEventListener("click", startGame);
instructionOkBtn.addEventListener("click", beginGameAfterInstructions);
watchAdBtn.addEventListener("click", watchAdAndContinue);
skipAdBtn.addEventListener("click", () => {
  adModalEl.classList.remove("show");
});

startGame();
