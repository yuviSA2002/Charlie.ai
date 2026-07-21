"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus, type GestureMode } from "@/lib/handTracker";
import { io, Socket } from "socket.io-client";
import Dashboard from "./Dashboard";

type CameraState = "off" | "starting" | "on" | "error";

const MODE_LABEL: Record<GestureMode, string> = {
  idle: "STANDBY",
  spin: "ROTATING",
  zoom: "ZOOMING",
  open_palm: "DASHBOARD PREP",
  hold_palm: "DASHBOARD TOGGLED",
  explode_ready: "EXPLODE PRIMED",
  wave: "WAVE",
};

export default function CharlieOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({ hands: 0, mode: "idle" });
  const [error, setError] = useState<string | null>(null);

  // Charlie state
  const [charlieState, setCharlieState] = useState<string>("idle");
  const [charlieTranscript, setCharlieTranscript] = useState<string>("");
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const socketRef = useRef<Socket | null>(null);

  // Dashboard state
  const [dashboardVisible, setDashboardVisible] = useState(false);
  const [dashboardExploded, setDashboardExploded] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  
  const dashboardExplodedRef = useRef(false);
  useEffect(() => {
    dashboardExplodedRef.current = dashboardExploded;
    
    // Dynamic Layout Calculation for Exploded Grid
    if (dashboardExploded) {
      const updateExplodeLayout = () => {
        // Read current distance from scene to scale the grid correctly
        const distance = sceneRef.current ? sceneRef.current.getCameraRadius() : 5.5;

        // Calculate the physical size of the screen in CSS3DObject coordinates
        const vFov = (55 * Math.PI) / 180;
        const visibleHeightUnits = 2 * Math.tan(vFov / 2) * distance; 
        const cssHeight = visibleHeightUnits / 0.0025; // CSS3D scale is 0.0025
        const cssWidth = cssHeight * (window.innerWidth / window.innerHeight);

        const gap = cssHeight * 0.02; // Clean 2% gap
        // Make it fill the absolute maximum space (0.98 allows a tiny 1% edge margin)
        const availableW = cssWidth * 0.98 - gap * 4;
        const availableH = cssHeight * 0.98 - gap * 3;
        
        const faceW = availableW / 3;
        const faceH = availableH / 2;
        
        const size = Math.min(faceW, faceH); // 800 is native, we scale relative to that
        const scale = size / 800;
        
        document.documentElement.style.setProperty('--explode-scale', scale.toString());
        document.documentElement.style.setProperty('--explode-x', `${size + gap}px`);
        document.documentElement.style.setProperty('--explode-y', `${size / 2 + gap / 2}px`);
      };
      
      updateExplodeLayout();
      window.addEventListener('resize', updateExplodeLayout);
      return () => window.removeEventListener('resize', updateExplodeLayout);
    }
  }, [dashboardExploded]);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{ query: string, results: any[] } | null>(null);
  const [youtubeResults, setYoutubeResults] = useState<{ query: string, results: any[] } | null>(null);
  const [tasks, setTasks] = useState<{ id: string, text: string }[]>([
    { id: '1', text: 'Initialize System Subroutines' }
  ]);
  const [hudOpen, setHudOpen] = useState(false);

  // Virtual Cursor state
  const [cursorPos, setCursorPos] = useState<{ x: number, y: number } | null>(null);
  const [cursorVisible, setCursorVisible] = useState(false);
  const [cursorRed, setCursorRed] = useState(false);
  const cursorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastClickTimeRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef<HTMLElement | null>(null);
  const lastCursorPosRef = useRef<{ x: number, y: number } | null>(null);
  
  // Toggle dashboard on hold_palm gesture
  useEffect(() => {
    if (status.mode === "hold_palm") {
      if (!dashboardExplodedRef.current) {
        setDashboardVisible(prev => !prev);
      }
    }
  }, [status.mode]);

  // Handle zooming when dashboard toggles
  useEffect(() => {
    if (sceneRef.current) {
      if (dashboardExplodedRef.current) return; // Never run zoom effects when grid is active
      sceneRef.current.zoomToCore(dashboardVisible);
    }
  }, [dashboardVisible]);

  useEffect(() => {
    const socket: Socket = io("http://localhost:5000");
    socketRef.current = socket;

    socket.on("state_change", (data: { state: string; message: string }) => {
      setCharlieState(data.state);
    });

    socket.on("transcript", (data: { text: string }) => {
      setCharlieTranscript(data.text);
    });

    socket.on("play_media", (data: { url: string }) => {
      setDashboardVisible(true);
      setDashboardExploded(false);
      setMediaUrl(`https://www.youtube.com/embed/${data.url}?autoplay=1&controls=1&enablejsapi=1`);
      setIframeUrl(null);
      setSearchResults(null);
      setYoutubeResults(null);
      if (sceneRef.current) {
        sceneRef.current.lookAtRightFace();
      }
    });

    socket.on("render_url", (data: { url: string }) => {
      setDashboardVisible(true);
      setDashboardExploded(false);
      if (sceneRef.current) {
        sceneRef.current.lookAtBackFace();
      }
      setIframeUrl(data.url);
      setSearchResults(null);
      setYoutubeResults(null);
    });

    socket.on("render_search", (data: { query: string, results: any[] }) => {
      setDashboardVisible(true);
      setDashboardExploded(false);
      if (sceneRef.current) {
        sceneRef.current.lookAtBackFace();
      }
      setSearchResults(data);
      setIframeUrl(null);
      setYoutubeResults(null);
    });

    socket.on("render_youtube", (data: { query: string, results: any[] }) => {
      setDashboardVisible(true);
      setDashboardExploded(false);
      if (sceneRef.current) {
        sceneRef.current.lookAtBackFace();
      }
      setYoutubeResults(data);
      setIframeUrl(null);
      setSearchResults(null);
    });

    socket.on("add_task", (data: { task: string }) => {
      setTasks(prev => [...prev, { id: Math.random().toString(), text: data.task }]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createOrbScene(container, dashboardRef.current);
    sceneRef.current = scene;
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setError(null);

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp, isNewGrab) => {
        if (dashboardExplodedRef.current) return;
        sceneRef.current?.rotateBy(dt, dp, isNewGrab);
      },
      onZoom: (factor) => {
        if (dashboardExplodedRef.current) return;
        sceneRef.current?.zoomBy(factor);
      },
      onCursorMove: (x, y, isPinched) => {
        const mode = trackerRef.current?.lastStatus.mode;
        // Do not show pointer if zooming (both hands pinched)
        if (mode === "zoom") {
          setCursorVisible(false);
          return;
        }

        if (x !== null && y !== null && isPinched) {
          setCursorPos({ x, y });
          setCursorVisible(true);
          
          if (isDraggingRef.current && dragTargetRef.current && lastCursorPosRef.current) {
            const dx = x - lastCursorPosRef.current.x;
            const dy = y - lastCursorPosRef.current.y;
            
            // Multiply by a factor to make scrolling feel responsive
            const pxX = dx * window.innerWidth * 3;
            const pxY = dy * window.innerHeight * 3;
            
            dragTargetRef.current.dispatchEvent(new WheelEvent('wheel', {
              deltaX: pxX,
              deltaY: pxY,
              bubbles: true,
              cancelable: true
            }));
          }
          
          lastCursorPosRef.current = { x, y };
          
          if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
          cursorTimerRef.current = setTimeout(() => {
            setCursorVisible(false);
          }, 2500);
        } else {
          if (isDraggingRef.current) {
            isDraggingRef.current = false;
            dragTargetRef.current = null;
            // Hold the red cursor for 250ms so the user can see the \"click\" flash
            // even if they released the second pinch immediately.
            setTimeout(() => {
              setCursorRed(false);
              setCursorVisible(false);
            }, 250);
          } else {
            setCursorVisible(false);
          }
          lastCursorPosRef.current = null;
        }
      },
      onClick: (x, y) => {
        const mode = trackerRef.current?.lastStatus.mode;
        if (mode === "zoom") return;

        const now = performance.now();
        if (now - lastClickTimeRef.current < 500) { // Double Pinch!
          setCursorRed(true);
          
          const screenX = x * window.innerWidth;
          const screenY = y * window.innerHeight;
          
          const element = document.elementFromPoint(screenX, screenY) as HTMLElement;
          if (element) {
            element.click();
            
            isDraggingRef.current = true;
            dragTargetRef.current = element;
            
            element.style.transition = 'all 0.1s ease';
            const oldBoxShadow = element.style.boxShadow;
            element.style.boxShadow = '0 0 20px #ff3333, 0 0 40px #ff3333';
            setTimeout(() => {
              if (document.body.contains(element)) {
                element.style.boxShadow = oldBoxShadow;
              }
            }, 150);
          }
          lastClickTimeRef.current = 0; // reset after successful click
        } else {
          lastClickTimeRef.current = now; // first pinch
        }
      },
      onExplodeToggle: (explode) => {
        dashboardExplodedRef.current = explode; // Synchronous update to prevent race conditions
        setDashboardExploded(explode);
        if (explode) {
          setDashboardVisible(true);
        }
        if (sceneRef.current) {
          sceneRef.current.setExploded(explode);
          if (explode) {
            sceneRef.current.resetCamera();
          }
        }
      },
      onStatus: setStatus,
    });
    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
    } catch (err: any) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      const errReason = err?.message || err?.name || String(err);
      
      let finalErrorMsg = `TRACKING INIT FAILED: ${errReason}`;
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        finalErrorMsg = "CAMERA ACCESS DENIED (Check Browser Permissions)";
      } else if (errReason.includes("Could not start video source") || err?.name === "NotReadableError" || err?.name === "TrackStartError") {
        finalErrorMsg = "CAMERA IN USE BY ANOTHER APP (Close Zoom/Teams)";
      } else if (err?.name === "NotFoundError") {
        finalErrorMsg = "NO WEBCAM DETECTED";
      }

      setError(finalErrorMsg);
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "d") {
        setDashboardVisible(prev => !prev);
      } else if (e.key.toLowerCase() === "g") {
        toggleGestures();
      } else if (e.key.toLowerCase() === "t") {
        setTasks(prev => [...prev, { id: Math.random().toString(), text: 'User Manual Task ' + (prev.length + 1) }]);
      } else if (e.key.toLowerCase() === "m") {
        setIsMuted(prev => {
          const next = !prev;
          socketRef.current?.emit('toggle_mute', { muted: next });
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleGestures]);

  const handlePlayVideo = (videoId: string) => {
    setDashboardVisible(true);
    setDashboardExploded(false);
    setMediaUrl(`https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&enablejsapi=1`);
    setIframeUrl(null);
    setSearchResults(null);
    setYoutubeResults(null);
    if (sceneRef.current) {
      sceneRef.current.lookAtRightFace();
    }
  };

  const handleOpenLink = (url: string) => {
    setIframeUrl(url);
    setYoutubeResults(null);
    setSearchResults(null);
    setDashboardExploded(false);
    if (sceneRef.current) {
      sceneRef.current.lookAtBackFace();
    }
  };

  const [enlargedFace, setEnlargedFace] = useState<string | null>(null);

  const playVideo = () => {
    const iframe = document.getElementById('yt-player') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), '*');
    }
  };

  const pauseVideo = () => {
    const iframe = document.getElementById('yt-player') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo' }), '*');
    }
  };

  const toggleEnlarge = () => {
    const isNowEnlarged = enlargedFace !== 'right';
    setEnlargedFace(isNowEnlarged ? 'right' : null);
    
    if (sceneRef.current) {
      if (isNowEnlarged) {
        sceneRef.current.lookAtFrontFace();
      } else {
        sceneRef.current.lookAtRightFace();
      }
    }
  };

  const cameraOn = camera === "on";

  return (
    <>
      <div 
        ref={containerRef} 
        className="orb-root" 
        style={{ zIndex: dashboardExploded ? 100 : 1 }}
      />
      
      {/* Wrapper to protect React sibling indexing from CSS3DObject moving the dashboard node */}
      <div id="dashboard-wrapper">
        <Dashboard 
          ref={dashboardRef} 
          visible={dashboardVisible} 
          exploded={dashboardExploded} 
          enlargedFace={enlargedFace}
          mediaUrl={mediaUrl} 
          tasks={tasks}
          iframeUrl={iframeUrl}
          searchResults={searchResults}
          youtubeResults={youtubeResults}
          onPlayVideo={handlePlayVideo}
          onOpenLink={handleOpenLink}
        />
      </div>

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      {/* HUD Menu Drawer */}
      <div className="hud-menu-btn" onClick={() => setHudOpen(!hudOpen)}>
        ☰
      </div>
      <div className={`hud-drawer ${hudOpen ? 'open' : ''}`}>
        <h3 style={{ marginBottom: 15, color: '#fff' }}>SYSTEM CONTROLS</h3>
        <p style={{ margin: '8px 0' }}><strong>'G'</strong> : Toggle Camera Tracker</p>
        <p style={{ margin: '8px 0' }}><strong>'D'</strong> : Toggle Dashboard Cube</p>
        <p style={{ margin: '8px 0' }}><strong>'T'</strong> : Add Test Task</p>
        <p style={{ margin: '8px 0' }}><strong>'M'</strong> : Toggle Mute</p>
        <hr style={{ border: 'none', borderTop: '1px solid rgba(0, 170, 255, 0.3)', margin: '15px 0' }} />
        <h4 style={{ marginBottom: 10, color: '#0af' }}>GESTURES</h4>
        <p style={{ margin: '8px 0' }}>• <strong>Open Palm (Hold)</strong>: Toggle Dashboard</p>
        <p style={{ margin: '8px 0' }}>• <strong>Pinch & Drag</strong>: Spin Orb</p>
        <p style={{ margin: '8px 0' }}>• <strong>Double Pinch</strong>: Zoom In/Out</p>
      </div>

      <div className="hud hud-title">C.H.A.R.L.I.E.</div>

      {charlieState !== "idle" && (
        <div className="hud hud-state" style={{ position: 'absolute', top: '100px', left: '64px', fontSize: '1.5rem', color: '#ffaa30', fontWeight: 'bold' }}>
          {charlieState.toUpperCase()}
        </div>
      )}
      {isMuted && (
        <div className="hud hud-muted" style={{ position: 'absolute', top: '100px', right: '64px', fontSize: '1.5rem', color: '#ff3030', fontWeight: 'bold' }}>
          VOICE MUTED
        </div>
      )}
      {charlieTranscript && (
        <div className="hud hud-transcript" style={{ position: 'absolute', top: '140px', left: '64px', maxWidth: '400px', fontSize: '1.2rem', color: '#66ccff' }}>
          {charlieTranscript}
        </div>
      )}

      <div className="hud hud-controls">
        <div className={`camera-panel${cameraOn ? " visible" : ""}`}>
          {/* Mirrored preview so it behaves like a mirror */}
          <video ref={videoRef} muted playsInline className="camera-video" />
          <canvas ref={overlayRef} width={208} height={156} className="camera-overlay" />
          <div className="camera-status">
            {status.hands > 0
              ? `${status.hands} HAND${status.hands > 1 ? "S" : ""} · ${MODE_LABEL[status.mode]}`
              : "SHOW HANDS"}
          </div>
        </div>
        {camera === "starting" && (
          <div style={{ color: '#0af', marginBottom: 10, fontFamily: 'monospace' }}>
            INITIALIZING TRACKING...
          </div>
        )}

        {error && <div className="hud-error">{error}</div>}

        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={cameraOn}
            onClick={toggleGestures}
            disabled={camera === "starting"}
          >
            {camera === "starting" ? "INITIALIZING…" : cameraOn ? "GESTURES ON" : "GESTURES OFF"}
          </button>
        </div>
        <div className="hud-row">
          <button type="button" className="hud-btn" onClick={playVideo} aria-label="Play Video" style={{ fontSize: '18px' }}>
            ▶
          </button>
          <button type="button" className="hud-btn" onClick={pauseVideo} aria-label="Pause Video" style={{ fontSize: '18px' }}>
            ⏸
          </button>
          <button type="button" className="hud-btn" onClick={toggleEnlarge} aria-label="Enlarge Media" style={{ fontSize: '20px', marginLeft: '10px' }}>
            🔲
          </button>
        </div>
      </div>
      
      {/* Virtual Cursor Bubble - Moved outside HUD to not be constrained by z-index */}
      <div 
        style={{
          position: 'fixed',
          left: cursorPos ? `${cursorPos.x * 100}vw` : '0px',
          top: cursorPos ? `${cursorPos.y * 100}vh` : '0px',
          display: cursorPos ? 'block' : 'none',
          width: '30px',
          height: '30px',
          borderRadius: '50%',
          backgroundColor: cursorRed ? 'rgba(255, 50, 50, 0.6)' : 'rgba(0, 170, 255, 0.4)',
          border: cursorRed ? '2px solid #ff3333' : '2px solid #0af',
          boxShadow: cursorRed ? '0 0 15px #ff3333, inset 0 0 10px #ff3333' : '0 0 15px #0af, inset 0 0 10px #0af',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: 99999, // Extremely high global z-index
          opacity: cursorVisible ? 1 : 0,
          transition: 'opacity 0.3s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
          backdropFilter: 'blur(2px)'
        }}
      />
    </>
  );
}
