const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * `d MMM` in English, plus the year when it is not the current one.
 * Local fields are the phone zone. `Intl` month names are not used: en-GB writes September as "Sept".
 */
export function formatDay(date: Date, now: number): string {
  const current = new Date(now);
  let when = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  if (date.getFullYear() !== current.getFullYear()) when = `${when} ${date.getFullYear()}`;
  return when;
}

/** `formatDay`, plus `HH:mm` only while the deadline is ahead. */
export function formatDeadline(deadline: Date, now: number): { when: string; future: boolean } {
  const future = deadline.getTime() > now;
  let when = formatDay(deadline, now);
  if (future) when = `${when}, ${pad2(deadline.getHours())}:${pad2(deadline.getMinutes())}`;
  return { when, future };
}
