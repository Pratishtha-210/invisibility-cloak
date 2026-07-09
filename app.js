import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs";

// --- DOM Elements ---
const video = document.getElementById("webcam");
const canvasMain = document.getElementById("canvas-main");
const ctxMain = canvasMain.getContext("2d");

const btnCaptureBg = document.getElementById("btn-capture-bg");
const canvasBgPreview = document.getElementById("canvas-bg-preview");
const ctxBgPreview = canvasBgPreview.getContext("2d");
const bgPreviewPlaceholder = document.getElementById("bg-preview-placeholder");

const countdownOverlay = document.getElementById("countdown-overlay");
const countdownNumber = document.getElementById("countdown-number");
const screenFlash = document.getElementById("screen-flash");

const btnModePose = document.getElementById("btn-mode-pose");
const btnModeSweep = document.getElementById("btn-mode-sweep");
const btnStyleInvisible = document.getElementById("btn-style-invisible");
const btnStylePredator = document.getElementById("btn-style-predator");

const sliderSmoothing = document.getElementById("slider-smoothing");
const valSmoothing = document.getElementById("val-smoothing");
const sliderFeather = document.getElementById("slider-feather");
const valFeather = document.getElementById("val-feather");
const sliderDilation = document.getElementById("slider-dilation");
const valDilation = document.getElementById("val-dilation");
const dilationGroup = document.getElementById("dilation-group");
const sliderTrail = document.getElementById("slider-trail");
const valTrail = document.getElementById("val-trail");

const toggleDebug = document.getElementById("toggle-debug");
const toggleMirror = document.getElementById("toggle-mirror");

const engineStatus = document.getElementById("engine-status");
const cameraStatus = document.getElementById("camera-status");
const statusToast = document.getElementById("status-toast");
const statusToastText = document.getElementById("status-toast-text");
const errorBanner = document.getElementById("error-banner");
const errorMessage = document.getElementById("error-message");
const errorCloseBtn = document.getElementById("error-close-btn");

// --- Offscreen Canvas Layers for Blended Rendering ---
const canvasBg = document.createElement("canvas");
const ctxBg = canvasBg.getContext("2d");

const canvasMask = document.createElement("canvas");
const ctxMask = canvasMask.getContext("2d");

const canvasCloak = document.createElement("canvas");
const ctxCloak = canvasCloak.getContext("2d");

// --- Audio Context for Shutter Sound Synthesis ---
let audioCtx = null;

// --- Application State ---
let handLandmarker = null;
let activeMode = "pose"; // 'pose' or 'sweep'
let cloakStyle = "invisible"; // 'invisible' or 'predator'
let bgCaptured = false;
let isCountingDown = false;
let lastVideoTime = -1;

// Configuration Parameters
let smoothingFrames = 6;
let featherBlur = 25;
let dilationScale = 1.5; // From slider value 15 (1.5x)
let trailLength = 1;
let debugOverlay = false;
let mirrorStream = true;

// Cloak Polygon Trail Buffer
const trailHistory = [];

// Landmarks Smoothing Buffer
// Structure: { Left: [ [21 pts], [21 pts]... ], Right: [ ... ] }
const handHistory = {
  Left: [],
  Right: []
};

// Hand Connections for Debug Skeleton Drawer
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [0, 9], [9, 10], [10, 11], [11, 12],   // Middle
  [0, 13], [13, 14], [14, 15], [15, 16], // Ring
  [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
  [5, 9], [9, 13], [13, 17]             // Palm base
];

// --- Initialize App ---
window.addEventListener("DOMContentLoaded", async () => {
  initUIListeners();
  await initMediaPipe();
  await initCamera();
});

// --- UI Listeners & Control Handlers ---
function initUIListeners() {
  // Mode Selector Buttons
  btnModePose.addEventListener("click", () => setInvisibilityMode("pose"));
  btnModeSweep.addEventListener("click", () => setInvisibilityMode("sweep"));

  // Style Selector Buttons
  btnStyleInvisible.addEventListener("click", () => setCloakStyle("invisible"));
  btnStylePredator.addEventListener("click", () => setCloakStyle("predator"));

  // Background Capture Trigger
  btnCaptureBg.addEventListener("click", startBackgroundCaptureCountdown);

  // Sliders
  sliderSmoothing.addEventListener("input", (e) => {
    smoothingFrames = parseInt(e.target.value);
    valSmoothing.textContent = `${smoothingFrames}f`;
  });

  sliderFeather.addEventListener("input", (e) => {
    featherBlur = parseInt(e.target.value);
    valFeather.textContent = `${featherBlur}px`;
  });

  sliderDilation.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    dilationScale = val / 10;
    valDilation.textContent = `${dilationScale.toFixed(1)}x`;
  });

  sliderTrail.addEventListener("input", (e) => {
    trailLength = parseInt(e.target.value);
    valTrail.textContent = trailLength === 1 ? "1f (None)" : `${trailLength}f`;
  });

  // Toggles
  toggleDebug.addEventListener("change", (e) => {
    debugOverlay = e.target.checked;
  });

  toggleMirror.addEventListener("change", (e) => {
    mirrorStream = e.target.checked;
  });

  // Close Error Banner
  errorCloseBtn.addEventListener("click", () => {
    errorBanner.classList.add("hidden");
  });
}

function setInvisibilityMode(mode) {
  activeMode = mode;
  if (mode === "pose") {
    btnModePose.classList.add("active");
    btnModeSweep.classList.remove("active");
    dilationGroup.classList.add("disabled");
    sliderDilation.disabled = true;
    showToast("Pose mode active: Use both hands to form a frame!", "green");
  } else {
    btnModePose.classList.remove("active");
    btnModeSweep.classList.add("active");
    dilationGroup.classList.remove("disabled");
    sliderDilation.disabled = false;
    showToast("Sweep mode active: Wave hands to turn invisible!", "green");
  }
}

function setCloakStyle(style) {
  cloakStyle = style;
  if (style === "invisible") {
    btnStyleInvisible.classList.add("active");
    btnStylePredator.classList.remove("active");
    if (bgCaptured) {
      showToast("Style: True Invisibility", "green");
    } else {
      showToast("Style: True Invisibility (Refraction fallback: capture background)", "orange");
    }
  } else {
    btnStyleInvisible.classList.remove("active");
    btnStylePredator.classList.add("active");
    showToast("Style: Predator Camouflage", "green");
  }
}

// --- MediaPipe HandLandmarker Setup (GPU to CPU fallback) ---
async function initMediaPipe() {
  setEngineStatus("loading", "Initializing...");
  showToast("Downloading hand-tracking models...", "orange");

  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
    );

    try {
      // Attempt GPU delegate
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2
      });
      setEngineStatus("success", "Active (GPU)");
      showToast("HandLandmarker loaded via GPU!", "green");
    } catch (gpuError) {
      console.warn("GPU delegate unavailable. Attempting CPU fallback...", gpuError);
      
      // Attempt CPU delegate fallback
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numHands: 2
      });
      setEngineStatus("success", "Active (CPU)");
      showToast("GPU fallback: Landmarker loaded on CPU.", "orange");
    }

    checkReadiness();
  } catch (error) {
    console.error("Critical MediaPipe Initialization Error:", error);
    setEngineStatus("error", "Error");
    showError("Could not initialize MediaPipe handlandmarker. Verify web browser compatibility, clear cached files, or check connection.");
  }
}

// --- Camera Setup ---
async function initCamera() {
  setCameraStatus("loading", "Connecting...");
  
  // Verify secure context (required for getUserMedia)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCameraStatus("error", "Secure Context Required");
    showError("webcam access requires a secure context (HTTPS or localhost). Double-clicking index.html directly from file:// will not work.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: false
    });
    
    video.srcObject = stream;
    
    // Wait for video metadata to load so dimensions are available
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        resolve();
      };
    });
    
    // Explicitly play the camera stream to start frame decoding
    await video.play();
    
    setCameraStatus("success", "Connected");
    checkReadiness();
    
    // Start the rendering loop immediately so the user can see themselves
    requestAnimationFrame(renderLoop);
  } catch (error) {
    console.error("Camera connection failed:", error);
    setCameraStatus("error", "Permission Denied");
    showError("Camera connection denied. Enable camera access in your web browser settings and reload.");
  }
}

// Check if both components are ready to enable snapshot calibration
function checkReadiness() {
  if (handLandmarker && video.srcObject) {
    btnCaptureBg.disabled = false;
    showToast("Ready! Stand back and capture the empty room background.", "green");
  }
}

// --- Toast and Notification Helpers ---
function showToast(text, colorClass) {
  statusToastText.textContent = text;
  
  const pulse = statusToast.querySelector(".pulse-indicator");
  pulse.className = "pulse-indicator"; // reset
  if (colorClass === "green") {
    pulse.classList.add("green");
  } else {
    pulse.classList.add("orange");
  }
  
  statusToast.style.animation = "none";
  void statusToast.offsetWidth; // trigger reflow
  statusToast.style.animation = "fadeIn 0.2s ease-out";
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorBanner.classList.remove("hidden");
}

function setEngineStatus(status, text) {
  engineStatus.textContent = text;
  engineStatus.className = `status-val ${status}`;
}

function setCameraStatus(status, text) {
  cameraStatus.textContent = text;
  cameraStatus.className = `status-val ${status}`;
}

// --- Synthesised Web Audio API Beeps ---
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playBeep(frequency, duration) {
  try {
    initAudio();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (err) {
    console.warn("Audio synthesis error:", err);
  }
}

// --- Background Snapshot Capture Countdown Loop ---
function startBackgroundCaptureCountdown() {
  if (isCountingDown) return;
  isCountingDown = true;
  countdownOverlay.classList.remove("hidden");
  btnCaptureBg.disabled = true;

  let secondsLeft = 3;
  countdownNumber.textContent = secondsLeft;
  playBeep(600, 0.1);

  const intervalId = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      countdownNumber.textContent = secondsLeft;
      playBeep(600, 0.1);
    } else {
      clearInterval(intervalId);
      captureBackgroundSnapshot();
    }
  }, 1000);
}

function captureBackgroundSnapshot() {
  // Capture high resolution frame
  const w = video.videoWidth;
  const h = video.videoHeight;

  canvasBg.width = w;
  canvasBg.height = h;
  ctxBg.drawImage(video, 0, 0, w, h);

  // Draw snapshot preview
  canvasBgPreview.width = 160;
  canvasBgPreview.height = 90;
  ctxBgPreview.drawImage(canvasBg, 0, 0, 160, 90);
  
  canvasBgPreview.style.display = "block";
  bgPreviewPlaceholder.style.display = "none";

  // Flash screen
  screenFlash.classList.add("flash-active");
  playBeep(1200, 0.4); // camera shutter beep

  setTimeout(() => {
    screenFlash.classList.remove("flash-active");
    countdownOverlay.classList.add("hidden");
    bgCaptured = true;
    isCountingDown = false;
    btnCaptureBg.disabled = false;
    btnCaptureBg.innerHTML = `<span class="action-icon">🔄</span><span class="action-label">Retake Background</span>`;
    showToast("Background captured! Step back in and frame your hands.", "green");
  }, 600);
}

// --- Coordinate Jitter Smoothing Pipeline ---
const missingFramesCounter = { Left: 999, Right: 999 };
const lastSmoothedLandmarks = { Left: null, Right: null };

function getSmoothedLandmarks(landmarks, handednessLabel) {
  let hist = handHistory[handednessLabel];
  
  // Clone coordinates to avoid reference issues
  hist.push(landmarks.map(p => ({ x: p.x, y: p.y, z: p.z })));
  
  if (hist.length > smoothingFrames) {
    hist.shift();
  }

  const smoothed = [];
  const numPoints = landmarks.length;
  
  for (let i = 0; i < numPoints; i++) {
    let sumX = 0, sumY = 0;
    for (let f = 0; f < hist.length; f++) {
      sumX += hist[f][i].x;
      sumY += hist[f][i].y;
    }
    smoothed.push({
      x: sumX / hist.length,
      y: sumY / hist.length
    });
  }
  return smoothed;
}

// Handedness detector helper
function getHandLabel(results, index) {
  if (results.handedness && results.handedness[index]) {
    const data = results.handedness[index];
    if (Array.isArray(data) && data[0]) {
      return data[0].categoryName || data[0].label;
    } else if (data.categoryName) {
      return data.categoryName;
    }
  }
  return index === 0 ? "Left" : "Right";
}

// --- Geometry Math & Algorithms ---

// Sort 4 coordinates in a clockwise/polar direction around their centroid
function sortPointsClockwise(points) {
  // Centroid
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  return [...points].sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });
}

// Monotone Chain (Graham Scan variant) Convex Hull
function getConvexHull(points) {
  const pts = [...points].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  if (pts.length <= 1) return pts;

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function crossProduct(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// --- Main Render Engine & Loop ---
function renderLoop() {
  const w = video.videoWidth;
  const h = video.videoHeight;

  if (w === 0 || h === 0) {
    requestAnimationFrame(renderLoop);
    return;
  }

  // Sync canvas dimensions
  if (canvasMain.width !== w || canvasMain.height !== h) {
    canvasMain.width = w;
    canvasMain.height = h;
    canvasMask.width = w;
    canvasMask.height = h;
    canvasCloak.width = w;
    canvasCloak.height = h;
  }

  // --- 1. Run Real-Time Hand Landmark Tracking ---
  let results = null;
  if (handLandmarker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    results = handLandmarker.detectForVideo(video, performance.now());
  }

  // --- 2. Hysteresis Hand Tracking & Smoothing ---
  const frameDetectedLabels = [];
  const rawHandLandmarks = { Left: null, Right: null };

  if (results && results.landmarks) {
    for (let index = 0; index < results.landmarks.length; index++) {
      const label = getHandLabel(results, index);
      frameDetectedLabels.push(label);
      rawHandLandmarks[label] = results.landmarks[index];
    }
  }

  // Update tracking state for both hands (with a 6-frame dropout tolerance)
  for (const label of ["Left", "Right"]) {
    if (rawHandLandmarks[label]) {
      missingFramesCounter[label] = 0;
      const smoothed = getSmoothedLandmarks(rawHandLandmarks[label], label);
      lastSmoothedLandmarks[label] = smoothed;
    } else {
      missingFramesCounter[label]++;
      // If the tracking dropout is brief, retain the last known coordinates to prevent flickering
      if (missingFramesCounter[label] > 6) {
        handHistory[label] = []; // Clear smoothing buffer
        lastSmoothedLandmarks[label] = null;
      }
    }
  }

  // Build the list of active hands to draw in this frame
  const processedHands = [];
  for (const label of ["Left", "Right"]) {
    if (lastSmoothedLandmarks[label] !== null) {
      processedHands.push({
        landmarks: lastSmoothedLandmarks[label],
        label: label
      });
    }
  }

  // --- 3. Generate Invisibility Masks ---
  const maskCtx = ctxMask;
  const currentPolygons = [];

  if (processedHands.length > 0) {
    // Mask Generation
    if (activeMode === "pose") {
      // Pose Frame Mode: Quad polygon between index tips (8) and thumbs (4) of 2 hands
      if (processedHands.length >= 2) {
        const hand1 = processedHands[0].landmarks;
        const hand2 = processedHands[1].landmarks;

        // Extract raw coordinates (landmark 4 = Thumb tip, landmark 8 = Index tip)
        const p1 = { x: hand1[4].x * w, y: hand1[4].y * h };
        const p2 = { x: hand1[8].x * w, y: hand1[8].y * h };
        const p3 = { x: hand2[4].x * w, y: hand2[4].y * h };
        const p4 = { x: hand2[8].x * w, y: hand2[8].y * h };

        const quadPoints = sortPointsClockwise([p1, p2, p3, p4]);
        currentPolygons.push(quadPoints);
      }
    } else {
      // Hand Sweep Mode: Dilated convex hulls for each detected hand
      processedHands.forEach(hand => {
        const pts = hand.landmarks.map(p => ({ x: p.x * w, y: p.y * h }));
        const hull = getConvexHull(pts);

        if (hull.length > 0) {
          const hcx = hull.reduce((sum, p) => sum + p.x, 0) / hull.length;
          const hcy = hull.reduce((sum, p) => sum + p.y, 0) / hull.length;

          // Dilate hull outwards from centroid
          const dilatedHull = hull.map(p => ({
            x: hcx + (p.x - hcx) * dilationScale,
            y: hcy + (p.y - hcy) * dilationScale
          }));

          currentPolygons.push(dilatedHull);
        }
      });
    }
  }

  // Push currentPolygons to trailHistory and keep within limits
  trailHistory.push(currentPolygons);
  while (trailHistory.length > trailLength) {
    trailHistory.shift();
  }

  // Draw all historical polygons onto the mask canvas
  maskCtx.clearRect(0, 0, w, h);
  maskCtx.fillStyle = "#ffffff";
  
  trailHistory.forEach(framePolys => {
    framePolys.forEach(polyPoints => {
      if (polyPoints.length > 0) {
        maskCtx.beginPath();
        maskCtx.moveTo(polyPoints[0].x, polyPoints[0].y);
        for (let i = 1; i < polyPoints.length; i++) {
          maskCtx.lineTo(polyPoints[i].x, polyPoints[i].y);
        }
        maskCtx.closePath();
        maskCtx.fill();
      }
    });
  });

  // --- 3. Composite Masked Background Layer ---
  ctxCloak.clearRect(0, 0, w, h);
  
  if (cloakStyle === "invisible" && bgCaptured) {
    // True Invisibility: draw background snapshot
    ctxCloak.drawImage(canvasBg, 0, 0, w, h);
    ctxCloak.globalCompositeOperation = "destination-in";
    ctxCloak.filter = featherBlur > 0 ? `blur(${featherBlur}px)` : "none";
    ctxCloak.drawImage(canvasMask, 0, 0, w, h);
  } else {
    // Refraction Camouflage (Predator Shimmer) - fallback if background not captured or style is 'predator'
    ctxCloak.save();
    
    // Distort the live feed inside the mask by translating and scaling (mag zoom)
    ctxCloak.translate(w / 2, h / 2);
    ctxCloak.scale(1.08, 1.08); // 8% refraction zoom
    ctxCloak.translate(-w / 2 - 5, -h / 2 + 5); // offset coordinates for glass lens displacement
    
    ctxCloak.drawImage(video, 0, 0, w, h);
    ctxCloak.restore();
    
    // Add cool glowing matrix tint inside the camouflage region
    ctxCloak.fillStyle = "rgba(168, 85, 247, 0.12)"; // neon purple transparent tint
    ctxCloak.globalCompositeOperation = "source-atop";
    ctxCloak.fillRect(0, 0, w, h);
    
    // Clip with the blurred mask to get feathered edges
    ctxCloak.globalCompositeOperation = "destination-in";
    ctxCloak.filter = featherBlur > 0 ? `blur(${featherBlur}px)` : "none";
    ctxCloak.drawImage(canvasMask, 0, 0, w, h);
  }
  
  // Restore cloak context states
  ctxCloak.filter = "none";
  ctxCloak.globalCompositeOperation = "source-over";

  // --- 4. Render final composite to Main Viewport Canvas ---
  ctxMain.clearRect(0, 0, w, h);
  ctxMain.save();

  // Apply horizontal mirror effect
  if (mirrorStream) {
    ctxMain.translate(w, 0);
    ctxMain.scale(-1, 1);
  }

  // Draw the raw camera feed (always visible)
  ctxMain.drawImage(video, 0, 0, w, h);

  // Draw the masked cloak layer on top (invisible background or predator shimmer)
  ctxMain.drawImage(canvasCloak, 0, 0, w, h);

  // Draw a shimmering neon stroke outlining the mask area (Only in debug mode!)
  if (debugOverlay && processedHands.length > 0 && featherBlur > 0) {
    ctxMain.save();
    
    // Purple neon for predator, emerald green for true invisibility
    const isPredatorActive = (cloakStyle === "predator" || !bgCaptured);
    ctxMain.strokeStyle = isPredatorActive ? "rgba(168, 85, 247, 0.55)" : "rgba(16, 185, 129, 0.55)";
    ctxMain.lineWidth = 3.5;
    ctxMain.shadowBlur = 12;
    ctxMain.shadowColor = isPredatorActive ? "#a855f7" : "#10b981";
    
    if (activeMode === "pose") {
      if (processedHands.length >= 2) {
        const hand1 = processedHands[0].landmarks;
        const hand2 = processedHands[1].landmarks;

        const p1 = { x: hand1[4].x * w, y: hand1[4].y * h };
        const p2 = { x: hand1[8].x * w, y: hand1[8].y * h };
        const p3 = { x: hand2[4].x * w, y: hand2[4].y * h };
        const p4 = { x: hand2[8].x * w, y: hand2[8].y * h };

        const quadPoints = sortPointsClockwise([p1, p2, p3, p4]);

        ctxMain.beginPath();
        ctxMain.moveTo(quadPoints[0].x, quadPoints[0].y);
        for (let i = 1; i < quadPoints.length; i++) {
          ctxMain.lineTo(quadPoints[i].x, quadPoints[i].y);
        }
        ctxMain.closePath();
        ctxMain.stroke();
      }
    } else {
      processedHands.forEach(hand => {
        const pts = hand.landmarks.map(p => ({ x: p.x * w, y: p.y * h }));
        const hull = getConvexHull(pts);

        if (hull.length > 0) {
          const hcx = hull.reduce((sum, p) => sum + p.x, 0) / hull.length;
          const hcy = hull.reduce((sum, p) => sum + p.y, 0) / hull.length;

          const dilatedHull = hull.map(p => ({
            x: hcx + (p.x - hcx) * dilationScale,
            y: hcy + (p.y - hcy) * dilationScale
          }));

          ctxMain.beginPath();
          ctxMain.moveTo(dilatedHull[0].x, dilatedHull[0].y);
          for (let i = 1; i < dilatedHull.length; i++) {
            ctxMain.lineTo(dilatedHull[i].x, dilatedHull[i].y);
          }
          ctxMain.closePath();
          ctxMain.stroke();
        }
      });
    }
    ctxMain.restore();
  }

  // Render debug overlays if toggled
  if (debugOverlay && processedHands.length > 0) {
    renderDebugOverlay(ctxMain, processedHands, w, h);
  }

  ctxMain.restore();

  requestAnimationFrame(renderLoop);
}

// --- Debug Skeleton Renderer ---
function renderDebugOverlay(ctx, hands, w, h) {
  hands.forEach(hand => {
    const pts = hand.landmarks;

    // Draw wiring connections
    ctx.strokeStyle = "rgba(59, 130, 246, 0.7)"; // neon blue wire
    ctx.lineWidth = 3.5;
    ctx.shadowBlur = 4;
    ctx.shadowColor = "#3b82f6";
    
    HAND_CONNECTIONS.forEach(([start, end]) => {
      ctx.beginPath();
      ctx.moveTo(pts[start].x * w, pts[start].y * h);
      ctx.lineTo(pts[end].x * w, pts[end].y * h);
      ctx.stroke();
    });
    
    ctx.shadowBlur = 0; // reset glow

    // Draw landmark joint nodes
    pts.forEach((p, idx) => {
      const px = p.x * w;
      const py = p.y * h;
      
      // Determine color based on landmark types
      let dotColor = "#a855f7"; // default joint: neon purple
      if (idx === 4 || idx === 8) {
        dotColor = "#10b981"; // tip targets: neon green
      } else if (idx === 0) {
        dotColor = "#3b82f6"; // wrist: neon blue
      }

      ctx.beginPath();
      ctx.arc(px, py, 5, 0, 2 * Math.PI);
      ctx.fillStyle = dotColor;
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    });

    // Draw hand label indicator
    const wrist = pts[0];
    ctx.fillStyle = "rgba(15, 18, 36, 0.85)";
    ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
    ctx.lineWidth = 1;
    
    const text = hand.label;
    ctx.font = "bold 11px Space Grotesk";
    const textWidth = ctx.measureText(text).width;
    const padding = 6;
    
    const bx = wrist.x * w - textWidth / 2 - padding;
    const by = wrist.y * h - 22;
    
    ctx.beginPath();
    ctx.roundRect(bx, by, textWidth + padding * 2, 18, 4);
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = "#f3f4f6";
    ctx.textAlign = "center";
    ctx.fillText(text, wrist.x * w, wrist.y * h - 9);
  });
}
