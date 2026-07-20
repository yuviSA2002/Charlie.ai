"use client";

import { useEffect, useState, forwardRef } from "react";

interface DashboardProps {
  visible: boolean;
  exploded?: boolean;
  mediaUrl: string | null;
  tasks: { id: string, text: string }[];
}

interface NewsItem {
  title: string;
  summary: string;
  link: string;
}

const Dashboard = forwardRef<HTMLDivElement, DashboardProps>(({ visible, exploded, mediaUrl, tasks }, ref) => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [weather, setWeather] = useState<string>("Loading weather...");
  const [loadingNews, setLoadingNews] = useState(true);

  useEffect(() => {
    async function fetchWeather() {
      try {
        const res = await fetch("https://wttr.in/?format=%c+%t+%C");
        const text = await res.text();
        if (text.includes("<style>") || text.includes("<html>") || text.includes("color:")) {
          setWeather("Weather unavailable (API Error)");
        } else {
          setWeather(text);
        }
      } catch {
        setWeather("Weather unavailable");
      }
    }
    fetchWeather();
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
    <div ref={ref} className={`dashboard-cube ${visible ? 'visible' : ''} ${exploded ? 'exploded' : ''}`}>
      
      {/* FRONT FACE: Status & Logo */}
      <div className="cube-face front">
        <div className="panel-header">C.H.A.R.L.I.E. System</div>
        <div className="panel-content" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '100px', textShadow: '0 0 30px #0af' }}>🪬</div>
          <h1 style={{ letterSpacing: '8px', margin: '20px 0', textShadow: '0 0 10px #0af' }}>ONLINE</h1>
          <div className="weather-text" style={{ marginTop: '30px' }}>{weather}</div>
        </div>
      </div>

      {/* RIGHT FACE: Arxiv & Jobs */}
      <div className="cube-face right">
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

      {/* BACK FACE: TBD */}
      <div className="cube-face back">
        <div className="panel-header">Auxiliary Module</div>
        <div className="panel-content" style={{ alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
          <p>Awaiting Module Assignment...</p>
        </div>
      </div>

      {/* TOP FACE: Media Player */}
      <div className="cube-face top">
        <div className="panel-header">Media Stream</div>
        <div className="panel-content">
          {mediaUrl ? (
            <div className="media-container">
              <iframe src={mediaUrl} allow="autoplay; encrypted-media" />
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
