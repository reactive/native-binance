import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Browser safe-area env values. The web safe-area context is hard-zero in SDK 58. */
function readWebSafeAreaInsets(): EdgeInsets {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return ZERO;
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
  probe.style.paddingRight = 'env(safe-area-inset-right, 0px)';
  probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
  probe.style.paddingLeft = 'env(safe-area-inset-left, 0px)';
  document.documentElement.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

function sameInsets(a: EdgeInsets, b: EdgeInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/**
 * Native uses the safe-area context. Web reads `env()` so chart geometry still
 * gets the phone insets after Expo Router stopped providing them.
 */
export function useScreenInsets(): EdgeInsets {
  const nativeInsets = useSafeAreaInsets();
  const [webInsets, setWebInsets] = useState(readWebSafeAreaInsets);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const update = () => {
      const next = readWebSafeAreaInsets();
      setWebInsets(current => (sameInsets(current, next) ? current : next));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return Platform.OS === 'web' ? webInsets : nativeInsets;
}
