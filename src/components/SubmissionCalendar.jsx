import { useEffect, useMemo, useState } from "react";
import { getLogsForPlayer, getScreenshot } from "../services/storageService.js";
import "../styles/calendar.css";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const EMPTY_SCREENSHOT_KEYS = [];

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isCompleted(log) {
  return Boolean(log?.dm?.passed && log?.range?.passed);
}

function getCurrentStreak(logs, today) {
  const completedDates = new Set(logs.filter(isCompleted).map((log) => log.date));
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let streak = 0;

  while (completedDates.has(toDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function ScreenshotProofs({ screenshotKeys }) {
  const [proofs, setProofs] = useState([]);
  const keys = screenshotKeys || EMPTY_SCREENSHOT_KEYS;

  useEffect(() => {
    let active = true;
    const urls = [];
    setProofs([]);

    async function loadProofs() {
      const loaded = await Promise.all(keys.map(async (key) => {
        try {
          const screenshot = await getScreenshot(key);
          if (!screenshot?.blob) return { key, url: "" };
          const url = URL.createObjectURL(screenshot.blob);
          urls.push(url);
          return { key, url };
        } catch {
          return { key, url: "" };
        }
      }));

      if (active) setProofs(loaded);
      else urls.forEach((url) => URL.revokeObjectURL(url));
    }

    if (keys.length) loadProofs();

    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [keys]);

  if (!keys.length) return <div className="calendar-expired">NO SCREENSHOT SAVED</div>;

  return <div className="calendar-proofs">
    {proofs.map((proof, index) => proof.url
      ? <img key={proof.key} src={proof.url} alt={`Submission proof ${index + 1}`} />
      : <div className="calendar-expired" key={proof.key}>SCREENSHOT UNAVAILABLE</div>)}
  </div>;
}

export default function SubmissionCalendar({ playerName, refreshKey = 0, selectedDate, onSelectDate }) {
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const callsign = playerName.trim();

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(async () => {
      if (!callsign) {
        setLogs([]);
        setLoadError(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(false);
      try {
        const entries = await getLogsForPlayer(callsign);
        if (active) setLogs(entries);
      } catch {
        if (active) {
          setLogs([]);
          setLoadError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [callsign, refreshKey, todayKey]);

  const logsByDate = useMemo(() => new Map(logs.map((log) => [log.date, log])), [logs]);
  const selectedLog = selectedDate ? logsByDate.get(selectedDate) : null;
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const leadingCells = visibleMonth.getDay();
  const cells = Array.from({ length: leadingCells + daysInMonth }, (_, index) => {
    if (index < leadingCells) return null;
    return new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index - leadingCells + 1);
  });

  while (cells.length % 7) cells.push(null);

  const monthPosition = visibleMonth.getFullYear() * 12 + visibleMonth.getMonth();
  const todayPosition = today.getFullYear() * 12 + today.getMonth();
  const eligibleDays = monthPosition < todayPosition ? daysInMonth : monthPosition === todayPosition ? today.getDate() : 0;
  const completedThisMonth = logs.filter((log) => {
    if (!isCompleted(log) || !log.date?.startsWith(`${toDateKey(visibleMonth).slice(0, 7)}-`)) return false;
    return Number(log.date.slice(-2)) <= eligibleDays;
  }).length;

  const changeMonth = (amount) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return <aside className="submission-calendar cut-corner" aria-label="Submission history calendar">
    <div className="calendar-month-bar">
      <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">&#8249;</button>
      <h2>{MONTH_FORMAT.format(visibleMonth).toUpperCase()}</h2>
      <button type="button" onClick={() => changeMonth(1)} aria-label="Next month">&#8250;</button>
    </div>

    <div className="calendar-metrics">
      <strong>CURRENT STREAK: {getCurrentStreak(logs, today)} DAYS</strong>
      <span>{completedThisMonth} / {eligibleDays} DAYS</span>
    </div>

    <div className={`calendar-grid-wrap${callsign ? "" : " is-disabled"}`}>
      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid" key={`${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}`}>
        {cells.map((date, index) => {
          if (!date) return <span className="calendar-day-empty" key={`empty-${index}`} />;

          const dateKey = toDateKey(date);
          const log = logsByDate.get(dateKey);
          const completed = isCompleted(log);
          const partial = Boolean(log && (log.dm?.passed !== log.range?.passed));
          const missed = dateKey < todayKey && !log;
          const future = dateKey > todayKey;
          const stateClass = completed ? "is-completed" : partial ? "is-partial" : log ? "is-recorded" : missed ? "is-missed" : future ? "is-future" : "";

          return <button
            className={`calendar-day ${stateClass}${dateKey === todayKey ? " is-today" : ""}${selectedDate === dateKey ? " is-selected" : ""}`}
            type="button"
            key={dateKey}
            disabled={!callsign || future || (!log && dateKey !== todayKey)}
            onClick={() => onSelectDate(dateKey)}
            style={{ animationDelay: `${index * 12}ms` }}
            aria-label={`${date.toLocaleDateString()}${log ? ", view submission" : ""}`}
          >{date.getDate()}</button>;
        })}
      </div>
      {!callsign && <div className="calendar-callsign-prompt">ENTER CALLSIGN TO LOAD HISTORY</div>}
    </div>

    {loading && <div className="calendar-notice">LOADING HISTORY...</div>}
    {loadError && <div className="calendar-notice is-error">HISTORY UNAVAILABLE</div>}

    {selectedLog && <div className="calendar-details">
      <div className="calendar-details-head">
        <strong>{new Date(`${selectedLog.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }).toUpperCase()}</strong>
        <button type="button" onClick={() => onSelectDate(todayKey)} aria-label="Close submission details">CLOSE</button>
      </div>
      <dl>
        <div><dt>DM PLACEMENTS</dt><dd>{selectedLog.dm?.placements?.join(" / ") || "--"}</dd></div>
        <div><dt>RANGE SCORES</dt><dd>{selectedLog.range?.scores?.join(" / ") || "--"}</dd></div>
        <div><dt>SUBMITTED</dt><dd>{selectedLog.submittedAt ? new Date(selectedLog.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--"}</dd></div>
      </dl>
      <ScreenshotProofs screenshotKeys={selectedLog.screenshotKeys} />
    </div>}
  </aside>;
}
