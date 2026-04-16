/**
 * Thundeeran.dev — Deep Engagement Analytics
 *
 * Privacy-first, cookie-free tracker that captures how visitors
 * engage with interactive essays. Stores events in localStorage
 * and can flush to any analytics backend (Plausible, PostHog, custom).
 *
 * Drop-in: <script src="/analytics/tracker.js"></script>
 *
 * Tracks:
 *   - Scroll depth (25/50/75/100% milestones per section)
 *   - Section visibility & dwell time
 *   - Interactive element engagement (clicks, toggles, simulations)
 *   - Read time (active vs total)
 *   - Session metadata (referrer, viewport, device)
 *   - Exit intent signals
 */

(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────
  const FLUSH_ENDPOINT = null; // Set to your analytics endpoint URL, e.g. 'https://plausible.io/api/event'
  const PLAUSIBLE_DOMAIN = 'thundeeran.dev';
  const BATCH_SIZE = 10;
  const FLUSH_INTERVAL = 30000; // 30s
  const IDLE_THRESHOLD = 30000; // 30s of no interaction = idle
  const SCROLL_DEBOUNCE = 200;
  const DEBUG = window.location.hash === '#analytics-debug';

  // ─── STATE ───────────────────────────────────────────────
  const sessionId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const sessionStart = Date.now();
  let lastActivity = Date.now();
  let activeTime = 0;
  let activeTimerStart = Date.now();
  let isIdle = false;
  let eventQueue = [];
  let scrollMilestones = new Set();
  let sectionMilestones = {};
  let visibleSections = {};
  let sectionDwell = {};
  let maxScrollDepth = 0;
  let interactionCount = 0;

  // ─── UTILITIES ───────────────────────────────────────────
  function log(...args) {
    if (DEBUG) console.log('%c[analytics]', 'color: #34d399; font-weight: bold;', ...args);
  }

  function getPageMeta() {
    return {
      url: window.location.pathname,
      title: document.title,
      referrer: document.referrer || '(direct)',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio || 1,
      device: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1200 ? 'tablet' : 'desktop',
      timestamp: new Date().toISOString(),
      sessionId
    };
  }

  // ─── EVENT RECORDING ────────────────────────────────────
  function record(eventName, props = {}) {
    const event = {
      event: eventName,
      ...getPageMeta(),
      ...props,
      activeTimeMs: getActiveTime(),
      totalTimeMs: Date.now() - sessionStart,
      scrollDepth: maxScrollDepth,
      interactions: interactionCount
    };

    eventQueue.push(event);
    log(eventName, props);

    if (eventQueue.length >= BATCH_SIZE) flush();
  }

  // ─── FLUSH TO BACKEND ───────────────────────────────────
  function flush() {
    if (eventQueue.length === 0) return;

    const batch = [...eventQueue];
    eventQueue = [];

    // Store in sessionStorage as fallback dashboard
    try {
      const existing = JSON.parse(sessionStorage.getItem('td_events') || '[]');
      existing.push(...batch);
      sessionStorage.setItem('td_events', JSON.stringify(existing));
    } catch (e) { /* quota exceeded, ignore */ }

    // Send to Plausible if configured
    if (FLUSH_ENDPOINT) {
      batch.forEach(evt => {
        const payload = {
          name: evt.event,
          url: window.location.href,
          domain: PLAUSIBLE_DOMAIN,
          props: Object.fromEntries(
            Object.entries(evt).filter(([k]) => !['event', 'url', 'title'].includes(k))
          )
        };

        navigator.sendBeacon
          ? navigator.sendBeacon(FLUSH_ENDPOINT, JSON.stringify(payload))
          : fetch(FLUSH_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              keepalive: true
            }).catch(() => {});
      });
    }

    log(`Flushed ${batch.length} events`);
  }

  // ─── ACTIVE TIME TRACKING ──────────────────────────────
  function getActiveTime() {
    if (!isIdle) {
      activeTime += Date.now() - activeTimerStart;
      activeTimerStart = Date.now();
    }
    return activeTime;
  }

  function markActive() {
    lastActivity = Date.now();
    if (isIdle) {
      isIdle = false;
      activeTimerStart = Date.now();
      log('User returned from idle');
    }
  }

  function checkIdle() {
    if (!isIdle && Date.now() - lastActivity > IDLE_THRESHOLD) {
      isIdle = true;
      activeTime += Date.now() - activeTimerStart;
      log('User went idle');
    }
  }

  setInterval(checkIdle, 5000);

  // ─── SCROLL DEPTH ──────────────────────────────────────
  function getScrollPercent() {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return 100;
    return Math.round((window.scrollY / docHeight) * 100);
  }

  let scrollTimer = null;
  function onScroll() {
    markActive();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const pct = getScrollPercent();
      if (pct > maxScrollDepth) maxScrollDepth = pct;

      [25, 50, 75, 90, 100].forEach(milestone => {
        if (pct >= milestone && !scrollMilestones.has(milestone)) {
          scrollMilestones.add(milestone);
          record('scroll_milestone', { milestone: `${milestone}%` });
        }
      });

      checkSectionVisibility();
    }, SCROLL_DEBOUNCE);
  }

  // ─── SECTION VISIBILITY & DWELL ────────────────────────
  function checkSectionVisibility() {
    const sections = document.querySelectorAll('section[data-track], [data-section]');
    const viewportHeight = window.innerHeight;

    sections.forEach(section => {
      const rect = section.getBoundingClientRect();
      const sectionName = section.dataset.track || section.dataset.section || section.className.split(' ')[0];
      const isVisible = rect.top < viewportHeight * 0.75 && rect.bottom > viewportHeight * 0.25;

      if (isVisible && !visibleSections[sectionName]) {
        visibleSections[sectionName] = true;
        sectionDwell[sectionName] = Date.now();
        record('section_enter', { section: sectionName });
      } else if (!isVisible && visibleSections[sectionName]) {
        visibleSections[sectionName] = false;
        const dwellTime = Date.now() - (sectionDwell[sectionName] || Date.now());
        record('section_exit', {
          section: sectionName,
          dwellMs: dwellTime,
          dwellSec: Math.round(dwellTime / 1000)
        });
      }

      // Per-section scroll milestones
      if (!sectionMilestones[sectionName]) sectionMilestones[sectionName] = new Set();
      const sectionScroll = Math.max(0, Math.min(1, (viewportHeight - rect.top) / (rect.height || 1)));
      const sectionPct = Math.round(sectionScroll * 100);

      [25, 50, 75, 100].forEach(m => {
        if (sectionPct >= m && !sectionMilestones[sectionName].has(m)) {
          sectionMilestones[sectionName].add(m);
          record('section_scroll', { section: sectionName, milestone: `${m}%` });
        }
      });
    });
  }

  // ─── INTERACTION TRACKING ──────────────────────────────
  // Auto-detect interactive elements
  function setupInteractionTracking() {

    // Track all [data-track-click] elements
    document.querySelectorAll('[data-track-click]').forEach(el => {
      el.addEventListener('click', () => {
        interactionCount++;
        markActive();
        record('click', {
          element: el.dataset.trackClick,
          label: el.textContent.trim().slice(0, 50)
        });
      });
    });

    // Track era selector buttons
    document.querySelectorAll('.era-button').forEach(btn => {
      btn.addEventListener('click', () => {
        interactionCount++;
        markActive();
        record('era_switch', {
          era: btn.dataset.era || btn.textContent.trim(),
          section: 'evolution'
        });
      });
    });

    // Track change type selections (confidence engine)
    document.querySelectorAll('.change-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        interactionCount++;
        markActive();
        record('change_type_select', {
          changeType: btn.textContent.trim().replace(/\s+/g, ' ').slice(0, 40),
          section: 'confidence-engine'
        });
      });
    });

    // Track dispatch/simulation button
    const dispatchBtn = document.getElementById('dispatchBtn');
    if (dispatchBtn) {
      dispatchBtn.addEventListener('click', () => {
        interactionCount++;
        markActive();
        record('simulation_run', {
          section: 'confidence-engine',
          selectedChange: document.querySelector('.change-type-btn.active')?.textContent.trim().split('\n')[0] || 'unknown'
        });
      });
    }

    // Track keyboard navigation (arrow keys for era scrubber)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        interactionCount++;
        markActive();
        record('keyboard_nav', {
          key: e.key,
          section: 'evolution'
        });
      }
    });

    // Track any element with data-track-hover (for deep dives)
    document.querySelectorAll('[data-track-hover]').forEach(el => {
      let hoverStart;
      el.addEventListener('mouseenter', () => {
        hoverStart = Date.now();
      });
      el.addEventListener('mouseleave', () => {
        if (hoverStart) {
          const hoverTime = Date.now() - hoverStart;
          if (hoverTime > 1000) { // Only track hovers > 1s
            record('hover', {
              element: el.dataset.trackHover,
              durationMs: hoverTime
            });
          }
        }
      });
    });

    log('Interaction tracking initialized');
  }

  // ─── SECTION AUTO-TAGGING ──────────────────────────────
  function autoTagSections() {
    document.querySelectorAll('section').forEach((section, idx) => {
      if (!section.dataset.track && !section.dataset.section) {
        const className = section.className.split(' ')[0];
        const heading = section.querySelector('h1, h2, h3');
        section.dataset.track = className || heading?.textContent.trim().slice(0, 30) || `section-${idx}`;
      }
    });
    log('Auto-tagged sections');
  }

  // ─── EXIT TRACKING ─────────────────────────────────────
  function onBeforeUnload() {
    // Final active time calculation
    getActiveTime();

    // Record session end
    record('session_end', {
      totalTimeSec: Math.round((Date.now() - sessionStart) / 1000),
      activeTimeSec: Math.round(activeTime / 1000),
      maxScrollDepth: maxScrollDepth + '%',
      totalInteractions: interactionCount,
      sectionsVisited: Object.keys(visibleSections).filter(k => visibleSections[k] || sectionDwell[k]).length,
      completedRead: scrollMilestones.has(90)
    });

    flush();
  }

  // Visibility change tracking (tab switch = soft exit)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      getActiveTime();
      record('tab_hidden', {
        activeTimeSec: Math.round(activeTime / 1000),
        scrollDepth: maxScrollDepth + '%'
      });
      flush();
    } else {
      markActive();
      record('tab_visible');
    }
  });

  // ─── ENGAGEMENT SCORE ──────────────────────────────────
  // Compute a 0-100 engagement score for the session
  function getEngagementScore() {
    const readTimeFactor = Math.min(1, activeTime / 180000);         // max at 3min
    const scrollFactor = maxScrollDepth / 100;                        // 0 to 1
    const interactionFactor = Math.min(1, interactionCount / 10);     // max at 10 interactions
    const sectionFactor = Math.min(1, Object.keys(sectionDwell).length / 5); // max at 5 sections

    return Math.round(
      (readTimeFactor * 30 + scrollFactor * 25 + interactionFactor * 25 + sectionFactor * 20)
    );
  }

  // ─── DEBUG DASHBOARD ───────────────────────────────────
  function createDebugPanel() {
    if (!DEBUG) return;

    const panel = document.createElement('div');
    panel.id = 'analytics-debug';
    panel.style.cssText = `
      position: fixed; bottom: 16px; right: 16px; z-index: 99999;
      background: rgba(3,3,6,0.95); border: 1px solid #34d399;
      border-radius: 12px; padding: 16px; font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #e8e8f0; min-width: 280px; backdrop-filter: blur(12px);
      box-shadow: 0 0 30px rgba(52,211,153,0.15);
    `;
    panel.innerHTML = `
      <div style="color: #34d399; font-weight: 700; margin-bottom: 8px; font-size: 12px;">
        📊 Analytics Debug
      </div>
      <div id="ad-metrics" style="line-height: 1.8;"></div>
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #1a1a26;">
        <button id="ad-export" style="background: #34d399; color: #030306; border: none;
          padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
          Export Events
        </button>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('ad-export').addEventListener('click', () => {
      const events = JSON.parse(sessionStorage.getItem('td_events') || '[]');
      const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    setInterval(updateDebugPanel, 1000);
  }

  function updateDebugPanel() {
    const el = document.getElementById('ad-metrics');
    if (!el) return;

    getActiveTime();
    const score = getEngagementScore();
    const scoreColor = score > 70 ? '#34d399' : score > 40 ? '#fbbf24' : '#f87171';

    el.innerHTML = `
      <div><span style="color: #6b6b85;">Session:</span> ${((Date.now() - sessionStart) / 1000).toFixed(0)}s total / ${(activeTime / 1000).toFixed(0)}s active</div>
      <div><span style="color: #6b6b85;">Scroll:</span> ${maxScrollDepth}% max</div>
      <div><span style="color: #6b6b85;">Interactions:</span> ${interactionCount}</div>
      <div><span style="color: #6b6b85;">Sections:</span> ${Object.keys(sectionDwell).length} visited</div>
      <div><span style="color: #6b6b85;">Events queued:</span> ${eventQueue.length}</div>
      <div><span style="color: #6b6b85;">Engagement:</span> <span style="color: ${scoreColor}; font-weight: 700;">${score}/100</span></div>
    `;
  }

  // ─── INIT ──────────────────────────────────────────────
  function init() {
    autoTagSections();

    // Record session start
    record('session_start', {
      referrer: document.referrer || '(direct)',
      page: window.location.pathname,
      device: getPageMeta().device,
      viewport: getPageMeta().viewport
    });

    // Scroll tracking
    window.addEventListener('scroll', onScroll, { passive: true });

    // Activity tracking
    ['mousedown', 'mousemove', 'touchstart', 'keydown'].forEach(evt => {
      window.addEventListener(evt, markActive, { passive: true });
    });

    // Exit tracking
    window.addEventListener('beforeunload', onBeforeUnload);

    // Setup interaction tracking (delayed to ensure DOM is ready)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setupInteractionTracking();
        createDebugPanel();
      });
    } else {
      setupInteractionTracking();
      createDebugPanel();
    }

    // Periodic flush
    setInterval(flush, FLUSH_INTERVAL);

    // Check initial section visibility
    setTimeout(checkSectionVisibility, 500);

    log('Tracker initialized', { sessionId, page: window.location.pathname });
  }

  // ─── PUBLIC API ────────────────────────────────────────
  window.tdAnalytics = {
    record,
    flush,
    getEngagementScore,
    getActiveTime: () => getActiveTime(),
    getMaxScroll: () => maxScrollDepth,
    getSessionId: () => sessionId,
    getEvents: () => JSON.parse(sessionStorage.getItem('td_events') || '[]')
  };

  init();

})();
