const { execFileSync } = require('child_process');
const path = require('path');

it('formats a future deadline in America/New_York and a past one without the time', () => {
  const out = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `import { formatDeadline } from './src/components/formatDeadline.ts';
      const NOW = Date.parse('2026-09-23T15:00:00.000Z');
      const got = [
        formatDeadline(new Date('2026-09-24T03:00:00.000Z'), NOW),
        formatDeadline(new Date('2026-09-03T03:00:00.000Z'), NOW),
        formatDeadline(new Date('2025-03-28T03:00:00.000Z'), NOW),
      ];
      process.stdout.write(JSON.stringify(got));`,
    ],
    {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, TZ: 'America/New_York' },
      encoding: 'utf8',
    },
  );
  expect(JSON.parse(out)).toEqual([
    { when: '23 Sep, 23:00', future: true },
    { when: '2 Sep', future: false },
    { when: '27 Mar 2025', future: false },
  ]);
});
