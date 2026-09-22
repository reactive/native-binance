import { hasNewTrades, holdTape, idleTape, PIN_SLOP } from './holdTape';

const live = [{ a: 2 }, { a: 1 }];
const next = [{ a: 3 }, { a: 2 }, { a: 1 }];

it('follows the live tape while pinned', () => {
  const pinned = holdTape(idleTape, { type: 'scroll', offset: 0, live });
  expect(pinned.held).toBeNull();
  expect(hasNewTrades(pinned.held, live)).toBe(false);
});

it('keeps the same array while scrolled and notices a new head', () => {
  const held = holdTape(idleTape, { type: 'scroll', offset: 220, live });
  expect(held.held).toBe(live);
  const still = holdTape(held, { type: 'scroll', offset: 220, live: next });
  expect(still.held).toBe(live);
  expect(hasNewTrades(held.held, live)).toBe(false);
  expect(hasNewTrades(still.held, next)).toBe(true);
});

it('releases on latest and when the offset returns within the pin slop', () => {
  const held = holdTape(idleTape, { type: 'scroll', offset: 220, live });
  expect(holdTape(held, { type: 'latest' }).held).toBeNull();
  expect(holdTape(held, { type: 'scroll', offset: PIN_SLOP, live: next }).held).toBeNull();
  expect(holdTape(held, { type: 'scroll', offset: PIN_SLOP + 0.1, live: next }).held).toBe(live);
});
