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
  const down = holdOrder(ready, { type: 'down' });
  expect(holdOrder(down, { type: 'ready', ids: next }).committed).toEqual(first);
  expect(holdOrder(down, { type: 'up', ids: next }).committed).toEqual(next);
});

it('applies a new sort immediately, including while a finger is down', () => {
  const ready = holdOrder(idleHold, { type: 'ready', ids: first });
  const down = holdOrder(ready, { type: 'down' });
  const resorted = holdOrder(down, { type: 'args', ids: next, ready: true });
  expect(resorted.holding).toBe(false);
  expect(resorted.committed).toEqual(next);
});
