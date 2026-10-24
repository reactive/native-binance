import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (live) setEnabled(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return enabled;
}
