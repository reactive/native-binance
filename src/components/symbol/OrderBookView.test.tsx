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

it('renders only the levels that fit its height, best next to the spread', () => {
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
  // 28px axis, then 300px a side: nine full 32px rows and one clipped.
  act(() => {
    tree.root
      .findByProps({ testID: 'book-depth' })
      .props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 628 } } });
  });

  const asks = rows(tree, 'asks');
  const bids = rows(tree, 'bids');
  expect(asks).toHaveLength(10);
  expect(bids).toHaveLength(10);
  expect(asks[0]).toBe('Ask 101, size 1');
  expect(bids[0]).toBe('Bid 100, size 1');
  expect(bids[9]).toBe('Bid 91, size 1');
});
