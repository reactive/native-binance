import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';

import { OrderBookView, type Level } from '@/components/symbol/OrderBookView';

jest.mock('@reactive/silk-native', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const tone = { solid: '#000', subtle: '#eee', subtleActive: '#ddd' };
  const theme = {
    semantic: {
      color: { surface: '#fff', tones: { success: tone, danger: tone, neutral: tone } },
    },
  };
  return {
    useTheme: () => ({ theme }),
    Text: ({ children, ...rest }: { children?: React.ReactNode }) =>
      React.createElement(RNText, rest, children),
  };
});

const { act } = TestRenderer;

function side(from: number, step: number): Level[] {
  return Array.from({ length: 100 }, (_, i) => [from + i * step, 1]);
}

function rows(tree: ReactTestRenderer, testID: string): string[] {
  return tree.root
    .findByProps({ testID })
    .findAll(node => typeof node.type === 'string' && node.props.accessible)
    .map(node => node.props.accessibilityLabel);
}

it('mounts a screenful of levels first, best next to the spread', () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <OrderBookView
        symbol="BTCUSDT"
        bids={side(100, -1)}
        asks={side(101, 1)}
        spread={1}
        pricePlaces={0}
        sizePlaces={0}
      />,
    );
  });

  const asks = rows(tree, 'asks');
  const bids = rows(tree, 'bids');
  expect(asks).toHaveLength(12);
  expect(bids).toHaveLength(12);
  expect(asks[0]).toBe('Ask 101, size 1');
  expect(bids[0]).toBe('Bid 100, size 1');
  expect(bids[11]).toBe('Bid 89, size 1');
});
