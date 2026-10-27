import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const WASM_CDN = "/wasm";
const MODEL_URL = "/models/hand_landmarker.task";

// Landmark indices (MediaPipe hand model)
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

// Pinch hysteresis: thumb–index distance relative to hand size
const PINCH_ON = 0.32;
const PINCH_OFF = 0.45;

// How strongly hand movement rotates the orb (radians per normalized unit)
const ROTATE_SPEED = Math.PI * 2; // Matches exact sensitivity of OrbitControls (360 degrees per full screen drag)
// Smoothing factor for grab-point tracking (0..1, higher = snappier)
const SMOOTHING = 0.4;

export type GestureMode = "idle" | "spin" | "zoom" | "open_palm" | "hold_palm" | "explode_ready" | "wave";

export interface TrackerStatus {
  hands: number;
  mode: "idle" | "spin" | "zoom" | "hold_palm" | "explode_ready";
}

export interface HandTrackerCallbacks {
  /** Called when Left Hand pinches and drags. dx, dy are screen-normalized deltas. isNewGrab is true on the first frame of a grab to stop momentum. */
  onRotate(dx: number, dy: number, isNewGrab?: boolean): void;
  /** Called when both hands pinch and spread/close: multiply camera distance by factor. */
  onZoom(factor: number): void;
  /** Called when the physical Right Hand moves. x,y are 0-1 normalized screen coords */
  onCursorMove(x: number | null, y: number | null, isPinched: boolean): void;
  /** Called when the physical Right Hand pinches */
  onClick(x: number, y: number): void;
  onStatus(status: TrackerStatus): void;
  onExplodeToggle?(explode: boolean): void;
}

interface Point {
  x: number;
  y: number;
}

interface HandState {
  pinching: boolean;
  openPalm: boolean;
  isFist: boolean;
  grab: Point; // smoothed pinch midpoint, mirrored
  openPalmStartTime: number | null;
  lastSeenOpenPalm: number | null;
  hasTriggeredHold: boolean;
  lastCursorPt: Point | null;
  positionHistory: Point[];
}

export class HandTracker {
  private video: HTMLVideoElement;
  private overlay: HTMLCanvasElement;
  private callbacks: HandTrackerCallbacks;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private running = false;
  private lastVideoTime = -1;

  // keyed by handedness label so state survives re-ordering between frames
  private handStates = new Map<string, HandState>();
  private prevMode: GestureMode = "idle";
  private prevSpinGrab: Point | null = null;
  private prevZoomDist: number | null = null;
  public lastStatus: TrackerStatus = { hands: 0, mode: "idle" };
  private lastExplodeState: boolean = false;
  private explodeTriggerTime = 0;
  private lastExplodeToggleTime = 0;

  constructor(
    video: HTMLVideoElement,
    overlay: HTMLCanvasElement,
    callbacks: HandTrackerCallbacks,
  ) {
    this.video = video;
    this.overlay = overlay;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" as const },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    };
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
    } catch {
      // Some browsers/GPUs reject the GPU delegate — fall back to CPU
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
      });
    }

    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.landmarker?.close();
    this.landmarker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.handStates.clear();
    this.prevMode = "idle";
    this.prevSpinGrab = null;
    this.prevZoomDist = null;
    const ctx = this.overlay.getContext("2d");
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.emitStatus({ hands: 0, mode: "idle" });
  }

  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    this.processHands(result.landmarks, result.handedness.map((h) => h[0]?.categoryName ?? "?"));
    this.drawOverlay(result.landmarks);
  };

  private dist3d(p1: any, p2: any): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.hypot(dx, dy, dz);
  }

  private isHandFullyOpen(lm: any): boolean {
    const refDist = this.dist3d(lm[0], lm[9]); // Wrist to middle MCP
    let openFingers = 0;
    for (const tip of [8, 12, 16, 20]) {
      const d = this.dist3d(lm[0], lm[tip]); // Wrist to Tip
      // Lower threshold to 1.25 to make it very easy to trigger while moving hands apart
      if (d > refDist * 1.25) openFingers++;
    }
    return openFingers >= 3;
  }

  private isHandClosed(lm: any): boolean {
    const refDist = this.dist3d(lm[0], lm[9]); // Wrist to middle MCP
    
    // In a pinch, the index tip (8) is usually extended outward to meet the thumb.
    // If the distance from wrist to index tip is large, it's not a tight fist.
    if (this.dist3d(lm[0], lm[8]) > refDist * 1.1) {
      return false;
    }

    for (const tip of [8, 12, 16, 20]) {
      const d = this.dist3d(lm[0], lm[tip]); // Wrist to Tip
      if (d > refDist * 1.25) {
        return false;
      }
    }
    return true;
  }

  private processHands(
    landmarks: NormalizedLandmark[][],
    labels: string[],
  ): void {
    const pinchedGrabs: Point[] = [];
    const seen = new Set<string>();

    landmarks.forEach((lm, i) => {
      const label = labels[i];
      seen.add(label);

      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      if (handScale < 1e-6) return;
      const pinchRatio = dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / handScale;

      const raw: Point = {
        x: 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
        y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
      };

      const physicalHand = label; 

      const openPalm = this.isHandFullyOpen(lm);
      let isFist = this.isHandClosed(lm);

      let state = this.handStates.get(label);
      if (!state) {
        state = { 
          pinching: false, openPalm: false, isFist: false, grab: raw,
          openPalmStartTime: null,
          lastSeenOpenPalm: null,
          hasTriggeredHold: false,
          lastCursorPt: null,
          positionHistory: []
        };
        this.handStates.set(label, state);
      }

      let newlyPinched = false;
      
      if (isFist) {
        state.pinching = false;
      } else {
        if (state.pinching && pinchRatio > PINCH_OFF) state.pinching = false;
        else if (!state.pinching && pinchRatio < PINCH_ON) {
          state.pinching = true;
          newlyPinched = true;
        }
      }
      
      state.isFist = isFist;

      const now = performance.now();
      
      if (state.pinching) {
        state.openPalmStartTime = null;
        state.lastSeenOpenPalm = null;
        state.hasTriggeredHold = false;
      } else if (openPalm) {
        state.lastSeenOpenPalm = now;
        if (!state.openPalmStartTime) {
          state.openPalmStartTime = now;
        }
      } else {
        if (state.lastSeenOpenPalm && (now - state.lastSeenOpenPalm > 400)) {
          state.openPalmStartTime = null;
          state.hasTriggeredHold = false;
        }
      }
      
      state.openPalm = openPalm;

      state.grab = {
        x: state.grab.x + (raw.x - state.grab.x) * SMOOTHING,
        y: state.grab.y + (raw.y - state.grab.y) * SMOOTHING,
      };

      if (physicalHand === "Right") {
        const rawCursorPt: Point = {
          x: 1 - lm[MIDDLE_MCP].x,
          y: lm[MIDDLE_MCP].y,
        };

        state.positionHistory.push(rawCursorPt);
        if (state.positionHistory.length > 7) {
          state.positionHistory.shift();
        }

        let emitPt = rawCursorPt;
        
        if (newlyPinched && state.positionHistory.length > 0) {
          emitPt = state.positionHistory[0];
          state.lastCursorPt = emitPt;
        } else if (state.lastCursorPt) {
          const dx = rawCursorPt.x - state.lastCursorPt.x;
          const dy = rawCursorPt.y - state.lastCursorPt.y;
          const dist = Math.hypot(dx, dy);

          if (dist < 0.003) {
            emitPt = state.lastCursorPt;
          } else {
            emitPt = {
              x: state.lastCursorPt.x + dx * 0.5,
              y: state.lastCursorPt.y + dy * 0.5,
            };
            state.lastCursorPt = emitPt;
          }
        } else {
          state.lastCursorPt = emitPt;
        }

        if (label === "Right") {
          this.callbacks.onCursorMove(emitPt.x, emitPt.y, state.pinching);
        }
        
        if (newlyPinched) {
          this.callbacks.onClick(emitPt.x, emitPt.y);
        }
      }

      if (state.pinching) pinchedGrabs.push(state.grab);
    });

    if (landmarks.length === 2) {
      const hand1 = landmarks[0];
      const hand2 = landmarks[1];
      const dist = Math.abs(hand1[WRIST].x - hand2[WRIST].x);
      
      const isFist1 = this.isHandClosed(hand1);
      const isFist2 = this.isHandClosed(hand2);
      
      const isOpen1 = this.isHandFullyOpen(hand1);
      const isOpen2 = this.isHandFullyOpen(hand2);
      const now = performance.now();

      if (!this.lastExplodeState) {
        if (isFist1 && isFist2 && dist < 0.35) {
          this.explodeTriggerTime = now;
        } else if (dist > 0.45 && this.explodeTriggerTime > 0 && now - this.explodeTriggerTime < 1500) {
          if (now - this.lastExplodeToggleTime > 1500) {
            this.lastExplodeState = true;
            this.callbacks.onExplodeToggle?.(true);
            this.lastExplodeToggleTime = now;
          }
          this.explodeTriggerTime = 0;
        }
      } else {
        if (dist > 0.4) {
          this.explodeTriggerTime = now;
        } else if (isFist1 && isFist2 && dist < 0.35 && this.explodeTriggerTime > 0 && now - this.explodeTriggerTime < 1500) {
          if (now - this.lastExplodeToggleTime > 1500) {
            this.lastExplodeState = false;
            this.callbacks.onExplodeToggle?.(false);
            this.lastExplodeToggleTime = now;
          }
          this.explodeTriggerTime = 0;
        }
      }
    }

    let rightHandPresent = false;
    for (const key of this.handStates.keys()) {
      if (!seen.has(key)) {
        this.handStates.delete(key);
      } else {
        if (key === "Right") rightHandPresent = true;
      }
    }
    
    if (!rightHandPresent) {
      this.callbacks.onCursorMove(null, null, false);
    }
    // Determine mode
    let mode: "idle" | "spin" | "zoom" | "hold_palm" | "explode_ready" = "idle";
    
    let anyOpenPalm = false;
    let holdPalmTriggered = false;
    let fistHands = 0;
    
    let openPalmCount = 0;
    for (const state of this.handStates.values()) {
        if (state.openPalm) openPalmCount++;
        if (state.isFist) fistHands++;
    }

    for (const [key, state] of this.handStates.entries()) {
        const physicalHand = key; // "Left" or "Right"
        // Only allow Left hand to trigger the dashboard toggle (hold_palm) if it's the ONLY open hand
        if (physicalHand === "Left") {
            // Increased threshold to 1500ms so quick rowing doesn't trigger it!
            if (!state.hasTriggeredHold && state.openPalm && state.openPalmStartTime && (performance.now() - state.openPalmStartTime > 1500)) {
                if (openPalmCount === 1) {
                    holdPalmTriggered = true;
                }
                // We still mark it triggered so that if they drop their right hand, it doesn't instantly toggle
                state.hasTriggeredHold = true; 
            }
            if (state.openPalm && !state.pinching) anyOpenPalm = true;
        }
    }

    if (fistHands === 2) mode = "explode_ready";
    else if (pinchedGrabs.length >= 2) mode = "zoom";
    else if (pinchedGrabs.length === 1) {
      // If only Right Hand is pinching, it's a click/drag, DO NOT spin!
      // If Left Hand is pinching, it's a spin.
      let leftHandPinching = false;
      for (const [key, state] of this.handStates.entries()) {
        const physicalHand = key;
        if (state.pinching && physicalHand === "Left") {
          leftHandPinching = true;
        }
      }
      if (leftHandPinching) mode = "spin";
    }
    else if (holdPalmTriggered) mode = "hold_palm";

    // Reset reference points on any mode change to avoid jumps
    if (mode !== this.prevMode) {
      this.prevSpinGrab = null;
      this.prevZoomDist = null;
      this.prevMode = mode;
    }

    if (mode === "spin") {
      const grab = pinchedGrabs[0];
      if (this.prevSpinGrab) {
        const dx = grab.x - this.prevSpinGrab.x;
        const dy = grab.y - this.prevSpinGrab.y;
        this.callbacks.onRotate(dx * ROTATE_SPEED, dy * ROTATE_SPEED, false);
      } else {
        // Just started spinning! Send a signal to kill existing momentum.
        this.callbacks.onRotate(0, 0, true);
      }
      this.prevSpinGrab = grab;
    } else if (mode === "zoom") {
      this.prevSpinGrab = null;
      const g1 = pinchedGrabs[0];
      const g2 = pinchedGrabs[1];
      const dist = Math.hypot(g1.x - g2.x, g1.y - g2.y);
      if (this.prevZoomDist !== null) {
        const factor = this.prevZoomDist / dist;
        if (Math.abs(1 - factor) > 0.01) {
          this.callbacks.onZoom(factor);
        }
      } else {
        // Just started zooming! Send a signal to kill existing spin momentum.
        this.callbacks.onRotate(0, 0, true);
      }
      this.prevZoomDist = dist;
    }

    this.emitStatus({ hands: landmarks.length, mode });
  }

  private emitStatus(status: TrackerStatus): void {
    if (
      status.hands !== this.lastStatus.hands ||
      status.mode !== this.lastStatus.mode
    ) {
      this.lastStatus = status;
      this.callbacks.onStatus(status);
    }
  }

  private drawOverlay(landmarks: NormalizedLandmark[][]): void {
    const ctx = this.overlay.getContext("2d");
    if (!ctx) return;
    const { width, height } = this.overlay;
    ctx.clearRect(0, 0, width, height);

    // MediaPipe Hand connections (Skeletal joints)
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [5, 9], [9, 10], [10, 11], [11, 12], // Middle
      [9, 13], [13, 14], [14, 15], [15, 16], // Ring
      [13, 17], [0, 17], [17, 18], [18, 19], [19, 20] // Pinky & Palm base
    ];

    for (const lm of landmarks) {
      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      const pinched =
        handScale > 1e-6 && dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / handScale < PINCH_ON;

      const color = pinched ? "#ffcc66" : "rgba(48, 170, 255, 0.6)"; // Blue theme by default

      // Draw lines
      ctx.strokeStyle = color;
      ctx.lineWidth = pinched ? 2 : 1;
      
      for (const [startIdx, endIdx] of connections) {
        const p1 = lm[startIdx];
        const p2 = lm[endIdx];
        
        ctx.beginPath();
        ctx.moveTo((1 - p1.x) * width, p1.y * height);
        ctx.lineTo((1 - p2.x) * width, p2.y * height);
        ctx.stroke();
      }

      // Draw joints (dots)
      ctx.fillStyle = pinched ? "#ffcc66" : "rgba(48, 170, 255, 0.8)";
      for (let i = 0; i < lm.length; i++) {
        const point = lm[i];
        const isTip = [4, 8, 12, 16, 20].includes(i);
        
        ctx.beginPath();
        ctx.arc((1 - point.x) * width, point.y * height, isTip ? (pinched ? 4 : 3) : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Keep the specific pinch indicator line (Thicker line between thumb and index)
      if (pinched) {
          ctx.strokeStyle = "#ff3333"; // Red indicator for active pinch grab
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo((1 - lm[THUMB_TIP].x) * width, lm[THUMB_TIP].y * height);
          ctx.lineTo((1 - lm[INDEX_TIP].x) * width, lm[INDEX_TIP].y * height);
          ctx.stroke();
      }
    }
  }
}

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
