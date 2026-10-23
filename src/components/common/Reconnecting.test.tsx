import { renderHook, act } from '@data-client/test';

import { useStreamsDown } from '@/components/common/Reconnecting';
import { streamStatus } from '@/resources/streamStatus';

jest.mock('@reactive/silk-native', () => ({
  Text: 'Text',
}));

const listed = 'wss://example.test/listed';
const other = 'wss://example.test/other';

afterEach(() => {
  streamStatus.setDown(listed, false);
  streamStatus.setDown(other, false);
});

it('re-renders when a listed stream goes down and ignores the others', () => {
  let renders = 0;
  const { result } = renderHook(() => {
    renders += 1;
    return useStreamsDown([listed]);
  });
  expect(result.current).toBe(false);
  const settled = renders;

  act(() => {
    streamStatus.setDown(other, true);
  });
  expect(renders).toBe(settled);
  expect(result.current).toBe(false);

  act(() => {
    streamStatus.setDown(listed, true);
  });
  expect(result.current).toBe(true);
  expect(renders).toBe(settled + 1);
});
