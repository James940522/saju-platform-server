import { createRequire } from 'node:module';
import { calculateFourPillars, lunarToSolar, solarToLunar } from 'manseryeok';

const require = createRequire(import.meta.url);
const { version } = require('manseryeok/package.json');
// Fixed synthetic input only. This script is not imported by the HTTP API.
const input = {
  year: 1992,
  month: 10,
  day: 24,
  hour: 5,
  minute: 30,
  gender: 'male',
  dayBoundary: 'midnight',
};
const result = calculateFourPillars(input);
const { gender: _gender, ...withoutGender } = input;

console.log(
  JSON.stringify(
    {
      engine: 'manseryeok',
      engineVersion: version,
      input,
      functionKeys: Object.keys(result).filter(
        (key) => typeof result[key] === 'function',
      ),
      serializedResult: result,
      toObject: result.toObject(),
      toHanjaObject: result.toHanjaObject(),
      calendar: {
        solarToLunar: solarToLunar(input.year, input.month, input.day),
        lunarLeapMonthToSolar: {
          input: { year: 2023, month: 2, day: 1, isLeapMonth: true },
          output: lunarToSolar(2023, 2, 1, true),
        },
      },
      withoutGender: {
        hasLuckPillars:
          calculateFourPillars(withoutGender).luckPillars !== undefined,
      },
    },
    null,
    2,
  ),
);
