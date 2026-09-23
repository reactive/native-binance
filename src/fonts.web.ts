/** One family name so `fontWeight` selects the face. Do not register a name per file. */
export const interFonts = [
  {
    fontFamily: 'Inter',
    fontDefinitions: [
      { path: require('../assets/fonts/Inter-Regular.ttf'), weight: 400, display: 'swap' as const },
      { path: require('../assets/fonts/Inter-Medium.ttf'), weight: 500, display: 'swap' as const },
      { path: require('../assets/fonts/Inter-SemiBold.ttf'), weight: 600, display: 'swap' as const },
      { path: require('../assets/fonts/Inter-Bold.ttf'), weight: 700, display: 'swap' as const },
    ],
  },
];
