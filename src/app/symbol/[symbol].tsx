import { useLocalSearchParams } from 'expo-router';

import SymbolScreen from '@/components/SymbolScreen';

export default function SymbolRoute() {
  const params = useLocalSearchParams<{ symbol: string }>();
  const symbol = (Array.isArray(params.symbol) ? params.symbol[0] : params.symbol ?? '')
    .toUpperCase();

  if (!symbol) return null;
  return <SymbolScreen key={symbol} symbol={symbol} />;
}
