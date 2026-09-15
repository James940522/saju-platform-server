import type { ConsoleLoggerOptions, LogLevel } from '@nestjs/common';
import type { EnvironmentVariables } from './environment.schema.js';

export function loggingOptions(
  environment: Pick<EnvironmentVariables, 'NODE_ENV' | 'LOG_LEVEL'>,
): ConsoleLoggerOptions {
  const levels: Record<
    NonNullable<EnvironmentVariables['LOG_LEVEL']>,
    LogLevel[]
  > = {
    error: ['fatal', 'error'],
    warn: ['fatal', 'error', 'warn'],
    info: ['fatal', 'error', 'warn', 'log'],
    debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  };
  const isProduction = environment.NODE_ENV === 'production';
  return {
    logLevels:
      levels[environment.LOG_LEVEL ?? (isProduction ? 'info' : 'debug')],
    json: isProduction,
    compact: true,
  };
}
