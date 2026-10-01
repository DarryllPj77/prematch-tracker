import { useMemo, useState } from "react";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function ManagerAttendanceCalendar({ logs, selectedPlayer, selectedDate, attendanceStartDate, onSelectDate }) {
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const visibleLogs = useMemo(() => selectedPlayer
    ? logs.filter((log) => log.playerName.toLowerCase() === selectedPlayer.toLowerCase())
    : logs, [logs, selectedPlayer]);
  const logsByDate = useMemo(() => visibleLogs.reduce((dates, log) => {
    if (!dates.has(log.date)) dates.set(log.date, []);
    dates.get(log.date).push(log);
    return dates;
  }, new Map()), [visibleLogs]);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: month.getDay() + daysInMonth }, (_, index) => {
    if (index < month.getDay()) return null;
    return new Date(month.getFullYear(), month.getMonth(), index - month.getDay() + 1);
  });

  while (cells.length % 7) cells.push(null);

  const changeMonth = (amount) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return <section className="manager-calendar cut-corner" aria-label="Attendance calendar">
    <div className="manager-calendar-head">
      <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">&#8249;</button>
      <div>
        <span>ATTENDANCE</span>
        <strong>{MONTH_LABEL.format(month).toUpperCase()}</strong>
      </div>
      <button type="button" onClick={() => changeMonth(1)} aria-label="Next month">&#8250;</button>
    </div>
    <div className="manager-calendar-weekdays" aria-hidden="true">
      {WEEKDAYS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
    </div>
    <div className="manager-calendar-grid" key={`${month.getFullYear()}-${month.getMonth()}`}>
      {cells.map((date, index) => {
        if (!date) return <span className="manager-calendar-blank" key={`blank-${index}`} />;

        const dateKey = toDateKey(date);
        const dayLogs = logsByDate.get(dateKey) || [];
        const hasPassed = dayLogs.some((log) => log.passed);
        const hasFailed = dayLogs.some((log) => !log.passed);
        const isFuture = dateKey > todayKey;
        const isMissed = Boolean(selectedPlayer)
          && Boolean(attendanceStartDate)
          && dateKey >= attendanceStartDate
          && dateKey < todayKey
          && dayLogs.length === 0;

        return <button
          type="button"
          className={`manager-calendar-day${dateKey === todayKey ? " is-today" : ""}${isMissed ? " is-missed" : ""}${selectedDate === dateKey ? " is-selected" : ""}`}
          key={dateKey}
          disabled={isFuture}
          onClick={() => onSelectDate(selectedDate === dateKey ? "" : dateKey)}
          aria-label={isMissed
            ? `${date.toLocaleDateString()}, missed`
            : `${date.toLocaleDateString()}, ${dayLogs.length} submission${dayLogs.length === 1 ? "" : "s"}`}
          style={{ animationDelay: `${index * 12}ms` }}
        >
          <span>{date.getDate()}</span>
          <i className="manager-calendar-dots" aria-hidden="true">
            {hasPassed && <b className="calendar-dot-pass" />}
            {hasFailed && <b className="calendar-dot-fail" />}
            {isMissed && <b className="calendar-dot-missed" />}
          </i>
        </button>;
      })}
    </div>
    <div className="manager-calendar-legend">
      <span><i className="calendar-dot-pass" /> PASSED</span>
      <span><i className="calendar-dot-fail" /> FAILED</span>
      <span><i className="calendar-dot-missed" /> MISSED</span>
    </div>
  </section>;
}
