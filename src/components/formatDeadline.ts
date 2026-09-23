const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * `d MMM` in English, year when it is not the current one, `HH:mm` only while the deadline is ahead.
 * Local fields are the phone zone. `Intl` month names are not used: en-GB writes September as "Sept".
 */
export function formatDeadline(deadline: Date, now: number): { when: string; future: boolean } {
  const future = deadline.getTime() > now;
  const current = new Date(now);
  let when = `${deadline.getDate()} ${MONTHS[deadline.getMonth()]}`;
  if (deadline.getFullYear() !== current.getFullYear()) when = `${when} ${deadline.getFullYear()}`;
  if (future) when = `${when}, ${pad2(deadline.getHours())}:${pad2(deadline.getMinutes())}`;
  return { when, future };
}
