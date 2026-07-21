"use client";

import { useEffect, useState, forwardRef } from "react";

interface DashboardProps {
  visible: boolean;
  exploded?: boolean;
  mediaUrl: string | null;
  tasks: { id: string, text: string }[];
  iframeUrl?: string | null;
  searchResults?: { query: string, results: any[] } | null;
  youtubeResults?: { query: string, results: any[] } | null;
  enlargedFace?: string | null;
  onPlayVideo?: (videoId: string) => void;
  onOpenLink?: (url: string) => void;
}

interface NewsItem {
  title: string;
  summary: string;
  link: string;
}

interface WeatherData {
  temp: number;
  code: number;
  windspeed: number;
  precipProb: number;
  locationName: string;
}

const DigitalWeatherIcon = ({ code }: { code: number }) => {
  // Map standard WMO codes to our digital icons
  let type = "cloudy";
  if (code === 0 || code === 1) type = "sun";
  else if (code === 2 || code === 3) type = "cloudy";
  else if (code >= 45 && code <= 48) type = "fog";
  else if (code >= 51 && code <= 67) type = "rain";
  else if (code >= 71 && code <= 77) type = "snow";
  else if (code >= 80 && code <= 82) type = "rain";
  else if (code >= 95) type = "thunder";

  return (
    <div className="weather-icon-container">
      {type === "sun" && (
        <svg viewBox="0 0 100 100" className="digital-icon sun">
          <circle cx="50" cy="50" r="20" fill="none" stroke="#ff5533" strokeWidth="6" strokeDasharray="4 4" className="spin-slow" />
          <circle cx="50" cy="50" r="10" fill="#ffaa30" />
          <g className="pulse-rays" stroke="#ff5533" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 6">
            <line x1="50" y1="10" x2="50" y2="20" />
            <line x1="50" y1="80" x2="50" y2="90" />
            <line x1="10" y1="50" x2="20" y2="50" />
            <line x1="80" y1="50" x2="90" y2="50" />
            <line x1="22" y1="22" x2="29" y2="29" />
            <line x1="78" y1="78" x2="71" y2="71" />
            <line x1="22" y1="78" x2="29" y2="71" />
            <line x1="78" y1="22" x2="71" y2="29" />
          </g>
        </svg>
      )}
      
      {type === "cloudy" && (
        <svg viewBox="0 0 100 100" className="digital-icon float">
          <path d="M 30 60 A 20 20 0 0 1 30 20 A 25 25 0 0 1 70 25 A 20 20 0 0 1 75 60 Z" fill="none" stroke="#fff" strokeWidth="5" strokeDasharray="6 6" />
        </svg>
      )}
      
      {type === "rain" && (
        <svg viewBox="0 0 100 100" className="digital-icon float">
          <path d="M 30 50 A 20 20 0 0 1 30 10 A 25 25 0 0 1 70 15 A 20 20 0 0 1 75 50 Z" fill="none" stroke="#fff" strokeWidth="5" strokeDasharray="6 6" />
          <g className="rain-fall" stroke="#0af" strokeWidth="4" strokeLinecap="round" strokeDasharray="0 8">
            <line x1="35" y1="60" x2="35" y2="90" />
            <line x1="50" y1="55" x2="50" y2="95" />
            <line x1="65" y1="60" x2="65" y2="85" />
          </g>
        </svg>
      )}

      {type === "thunder" && (
        <svg viewBox="0 0 100 100" className="digital-icon float-fast">
          <path d="M 30 45 A 20 20 0 0 1 30 5 A 25 25 0 0 1 70 10 A 20 20 0 0 1 75 45 Z" fill="none" stroke="#fff" strokeWidth="5" strokeDasharray="6 6" />
          <path d="M 45 50 L 35 70 L 50 70 L 40 95 L 65 65 L 50 65 Z" fill="#ffea00" className="flash" />
        </svg>
      )}

      {type === "snow" && (
        <svg viewBox="0 0 100 100" className="digital-icon float">
          <path d="M 30 50 A 20 20 0 0 1 30 10 A 25 25 0 0 1 70 15 A 20 20 0 0 1 75 50 Z" fill="none" stroke="#fff" strokeWidth="5" strokeDasharray="6 6" />
          <g className="snow-fall" fill="#fff">
            <circle cx="35" cy="65" r="3" />
            <circle cx="50" cy="75" r="4" />
            <circle cx="65" cy="60" r="3" />
            <circle cx="45" cy="85" r="3" />
          </g>
        </svg>
      )}

      {type === "fog" && (
        <svg viewBox="0 0 100 100" className="digital-icon">
          <g className="fog-drift" stroke="#fff" strokeWidth="5" strokeDasharray="4 8" strokeLinecap="round">
            <line x1="20" y1="30" x2="80" y2="30" />
            <line x1="30" y1="50" x2="70" y2="50" />
            <line x1="10" y1="70" x2="90" y2="70" />
          </g>
        </svg>
      )}
    </div>
  );
};

const Dashboard = forwardRef<HTMLDivElement, DashboardProps>(({ visible, exploded, enlargedFace, mediaUrl, tasks, iframeUrl, searchResults, youtubeResults, onPlayVideo, onOpenLink }, ref) => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [loadingNews, setLoadingNews] = useState(true);

  useEffect(() => {
    async function fetchWeather(lat: number, lon: number, fallbackName?: string) {
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=precipitation_probability_max&timezone=auto`);
        const data = await res.json();
        
        let locName = fallbackName || "Unknown Location";
        if (!fallbackName) {
          try {
            const geoRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
            const geoData = await geoRes.json();
            locName = geoData.city || geoData.locality || geoData.principalSubdivision || locName;
          } catch (e) {
            console.error("Reverse geocoding failed", e);
          }
        }

        if (data.current_weather) {
          setWeatherData({
            temp: data.current_weather.temperature,
            code: data.current_weather.weathercode,
            windspeed: data.current_weather.windspeed,
            precipProb: data.daily?.precipitation_probability_max?.[0] || 0,
            locationName: locName
          });
          setWeatherError(null);
        } else {
          setWeatherError("Weather unavailable");
        }
      } catch {
        setWeatherError("API Error");
      }
    }

    async function attemptGeolocation() {
      // 1. Try HTML5 Geolocation with a 15s timeout
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            fetchWeather(position.coords.latitude, position.coords.longitude);
          },
          async () => {
            // 2. If denied or timeout, try IP fallback
            try {
              const res = await fetch("https://ipapi.co/json/");
              const ipData = await res.json();
              if (ipData.latitude && ipData.longitude) {
                fetchWeather(ipData.latitude, ipData.longitude, ipData.city);
              } else {
                fetchWeather(51.5074, -0.1278, "London"); // London fallback
              }
            } catch {
              fetchWeather(51.5074, -0.1278, "London");
            }
          },
          { timeout: 15000 }
        );
      } else {
        fetchWeather(51.5074, -0.1278, "London");
      }
    }

    attemptGeolocation();
  }, []);

  useEffect(() => {
    async function fetchNews() {
      try {
        const res = await fetch('/api/news');
        const text = await res.text();
        
        // Simple XML parsing since our API route returns raw XML
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "text/xml");
        const entries = Array.from(xml.querySelectorAll("entry"));
        
        const fetchedNews = entries.map(entry => ({
          title: entry.querySelector("title")?.textContent?.replace(/\n/g, ' ') || "No title",
          summary: entry.querySelector("summary")?.textContent?.replace(/\n/g, ' ') || "No summary",
          link: entry.querySelector("id")?.textContent || "#"
        }));
        
        setNews(fetchedNews);
      } catch (err) {
        console.error("Failed to fetch news", err);
      } finally {
        setLoadingNews(false);
      }
    }
    fetchNews();
  }, []);

  const jobLinks = [
    { title: "Bioinformatics Data Scientist - Google", loc: "Remote", link: "https://careers.google.com/jobs/results/" },
    { title: "Single-Cell Genomics Analyst - Broad Institute", loc: "Boston, MA", link: "https://www.broadinstitute.org/careers" },
    { title: "Computational Biologist - 10x Genomics", loc: "Pleasanton, CA", link: "https://www.10xgenomics.com/careers/" }
  ];

  return (
    <div ref={ref} className={`dashboard-cube ${visible ? 'visible' : ''} ${exploded ? 'exploded' : ''} ${enlargedFace ? 'enlarged enlarged-' + enlargedFace : ''}`}>
      
      {/* FRONT FACE: Status & Logo */}
      <div className="cube-face front">
        <div className="panel-header">C.H.A.R.L.I.E. System</div>
        <div className="panel-content" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '100px', textShadow: '0 0 30px #0af' }}>🪬</div>
          <h1 style={{ letterSpacing: '8px', margin: '20px 0', textShadow: '0 0 10px #0af' }}>ONLINE</h1>
          
          <div className="digital-weather-widget" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {weatherError && <div style={{ color: '#ff3333' }}>{weatherError}</div>}
            {!weatherData && !weatherError && <div style={{ color: '#0af', animation: 'pulse 1s infinite' }}>SYNCING METEO...</div>}
            
            {weatherData && (
              <>
                <DigitalWeatherIcon code={weatherData.code} />
                <div style={{ fontSize: '28px', fontWeight: 'bold', textShadow: '0 0 15px #0af', marginTop: '10px' }}>
                  {weatherData.temp}°C
                </div>
                <div style={{ display: 'flex', gap: '15px', marginTop: '10px', fontSize: '12px', color: '#0af' }}>
                  <span>💧 {weatherData.precipProb}%</span>
                  <span>💨 {weatherData.windspeed} km/h</span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '15px', color: '#0af', opacity: 0.8 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="2 3" strokeLinecap="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3" strokeDasharray="none"></circle>
                  </svg>
                  <span style={{ fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>{weatherData.locationName}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* TOP FACE: Arxiv & Jobs */}
      <div className="cube-face top">
        <div className="panel-header">Bioinformatics Feed</div>
        <div className="panel-content">
          {loadingNews ? <p>Syncing databases...</p> : (
            news.map((n, i) => (
              <div key={i} className="news-item" style={{ marginBottom: '15px' }}>
                <a href={n.link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px', lineHeight: '1.2', marginBottom: '4px' }}>
                    {n.title}
                  </div>
                  <div style={{ 
                    color: '#fff', 
                    fontWeight: 'normal', 
                    fontSize: '12px', 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis' 
                  }}>
                    {n.summary}
                  </div>
                </a>
              </div>
            ))
          )}
          <div className="panel-header" style={{ marginTop: '20px' }}>Job Opportunities</div>
          {jobLinks.map((job, i) => (
            <div key={i} className="job-item">
              <a href={job.link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                <strong style={{ color: '#0af' }}>{job.title}</strong>
                <p style={{ color: '#aaa' }}>{job.loc}</p>
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* LEFT FACE: Fitness & Tasks */}
      <div className="cube-face left">
        <div className="panel-header">Fitness & Tasks</div>
        <div className="panel-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '18px' }}>Current Streak</span>
            <span className="flame-streak">🔥 14 Days</span>
          </div>
          
          <div style={{ margin: '20px 0', height: '100px', borderBottom: '1px solid rgba(0, 170, 255, 0.4)', position: 'relative' }}>
            {/* Simple CSS line graph mock */}
            <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline points="0,90 20,70 40,80 60,40 80,50 100,20" fill="none" stroke="#0af" strokeWidth="3" filter="drop-shadow(0 0 5px #0af)" />
            </svg>
            <div style={{ position: 'absolute', bottom: -20, width: '100%', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#66ccff' }}>
              <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
            </div>
          </div>

          <div className="panel-header" style={{ marginTop: '30px' }}>Active Tasks</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {tasks.map(task => (
              <div key={task.id} className="task-item">
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid #0af' }}></div>
                {task.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* BACK FACE: Action Screen */}
      <div className="cube-face back">
        <div className="panel-header">Agentic Action Screen</div>
        <div className="panel-content" style={{ padding: 0, overflow: 'hidden', backgroundColor: '#fff', position: 'relative' }}>
          
          {youtubeResults ? (
            <div style={{ padding: '20px', height: '100%', overflowY: 'auto', backgroundColor: '#0f0f13', color: '#fff' }}>
              <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #333', paddingBottom: '10px' }}>YouTube: {youtubeResults.query}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                {youtubeResults.results.map((r, i) => (
                  <div key={r.id} onClick={() => onPlayVideo?.(r.id)} style={{ backgroundColor: '#1a1a24', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
                      <img src={r.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', bottom: '5px', right: '5px', backgroundColor: 'rgba(0,0,0,0.8)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{r.duration}</div>
                      <div style={{ position: 'absolute', top: '5px', left: '5px', backgroundColor: '#f00', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>#{i+1}</div>
                      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '40px', height: '40px', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 0, height: 0, borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderLeft: '12px solid #fff', marginLeft: '4px' }}></div>
                      </div>
                    </div>
                    <div style={{ padding: '10px' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.title}</div>
                      <div style={{ fontSize: '12px', color: '#aaa' }}>{r.channel}</div>
                      <div style={{ fontSize: '10px', color: '#555', marginTop: '4px' }}>ID: {r.id}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : searchResults ? (
            <div style={{ padding: '20px', height: '100%', overflowY: 'auto', backgroundColor: '#f8f9fa', color: '#333' }}>
              <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #ddd', paddingBottom: '10px' }}>Search: {searchResults.query}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {searchResults.results.map((r, i) => (
                  <div key={i} onClick={() => onOpenLink?.(r.href)} style={{ backgroundColor: '#fff', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', cursor: 'pointer', transition: 'box-shadow 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)'} onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)'}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <span style={{ backgroundColor: '#0af', color: '#fff', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '12px' }}>{i+1}</span>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#1a0dab' }}>{r.title}</div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#006621', marginBottom: '6px' }}>{r.href}</div>
                    <div style={{ fontSize: '14px', color: '#545454', lineHeight: '1.4' }}>{r.body}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : iframeUrl ? (
            <iframe 
              src={iframeUrl} 
              style={{ width: '100%', height: '100%', border: 'none' }}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5, backgroundColor: 'rgba(0,0,0,0.8)' }}>
              <div style={{ fontSize: '40px', color: '#0af', marginBottom: '10px' }}>🌐</div>
              <p>Awaiting Web Task...</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT FACE: Media Player Status */}
      <div className={`cube-face right ${enlargedFace === 'right' ? 'enlarged-active' : ''}`}>
        <div className="panel-header">Media Stream</div>
        <div className="panel-content">
          {mediaUrl ? (
            <div className="media-container" style={{ pointerEvents: 'auto' }}>
              <iframe 
                id="yt-player"
                src={mediaUrl} 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowFullScreen 
                style={{ pointerEvents: 'auto' }}
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', opacity: 0.5 }}>
              <p>No media playing.</p>
              <p>Say "Hey Charlie, play music"</p>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM FACE: System Logs */}
      <div className="cube-face bottom">
        <div className="panel-header">Terminal Logs</div>
        <div className="panel-content" style={{ backgroundColor: 'rgba(0,0,0,0.5)', padding: '15px', borderRadius: '8px' }}>
          <div className="sys-log">[SYSTEM] Initializing 3D Renderer... OK</div>
          <div className="sys-log">[SYSTEM] Establishing Neural Link... OK</div>
          <div className="sys-log">[SYSTEM] Connecting to Arxiv Database... OK</div>
          <div className="sys-log warn">[WARN] Latency detected in sector 4.</div>
          <div className="sys-log">[CORE] All systems nominal.</div>
          <div className="sys-log" style={{ marginTop: '20px', color: '#0af' }}>&gt; _</div>
        </div>
      </div>

    </div>
  );
});

export default Dashboard;
