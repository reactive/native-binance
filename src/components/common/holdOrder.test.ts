import { holdOrder, idleHold } from './holdOrder';

const first = ['BTCUSDT', 'ETHUSDT'];
const next = ['ETHUSDT', 'BTCUSDT'];

it('commits volume order once, then keeps it', () => {
  const ready = holdOrder(idleHold, { type: 'ready', ids: first });
  expect(ready.committed).toEqual(first);
  expect(holdOrder(ready, { type: 'ready', ids: next }).committed).toEqual(first);
});

it('holds that order while a finger is down and applies it on release', () => {
  const ready = holdOrder(idleHold, { type: 'ready', ids: first });
  const down = holdOrder(ready, { type: 'down', ids: next });
  expect(down.committed).toEqual(first);
  expect(holdOrder(down, { type: 'ready', ids: next }).committed).toEqual(first);
  expect(holdOrder(down, { type: 'up', ids: next }).committed).toEqual(next);
});

it('freezes the rows on screen when volumes arrive under a finger', () => {
  const down = holdOrder(idleHold, { type: 'down', ids: first });
  expect(down.committed).toEqual(first);
  const during = holdOrder(down, { type: 'ready', ids: next });
  expect(during.committed).toEqual(first);
  expect(during.ready).toBe(true);
  expect(holdOrder(during, { type: 'up', ids: next }).committed).toEqual(next);
});

it('drops a pre-volume snapshot when the finger lifts before quotes arrive', () => {
  const down = holdOrder(idleHold, { type: 'down', ids: first });
  const up = holdOrder(down, { type: 'up', ids: next });
  expect(up.holding).toBe(false);
  expect(up.committed).toBeNull();
});

it('applies a new sort immediately, including while a finger is down', () => {
  const ready = holdOrder(idleHold, { type: 'ready', ids: first });
  const down = holdOrder(ready, { type: 'down', ids: first });
  const resorted = holdOrder(down, { type: 'args', ids: next, ready: true });
  expect(resorted.holding).toBe(false);
  expect(resorted.committed).toEqual(next);
});
