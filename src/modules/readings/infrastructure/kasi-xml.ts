import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { KASI_API_CONFIG } from '../../../config/kasi-api.config.js';

const MAX_RESPONSE_BYTES = 65_536;
const logger = new Logger('KasiApi');

// Only the two fixed KASI endpoints call this helper. No URL or raw provider
// error is logged; adapters normalize transport failures before returning.
export async function fetchKasiXml(
  url: URL,
  timeoutMs: number,
  requestId?: string,
): Promise<unknown> {
  const source =
    url.origin + url.pathname === KASI_API_CONFIG.lunarCalendar
      ? 'lunar_calendar'
      : 'solar_terms';
  const startedAt = performance.now();
  let httpStatus: number | null = null;
  let stage = 'transport';
  const identity = {
    source,
    method: 'GET',
    endpoint:
      source === 'lunar_calendar'
        ? KASI_API_CONFIG.lunarCalendar
        : KASI_API_CONFIG.solarTerms,
    callId: randomUUID(),
    ...(requestId ? { requestId } : {}),
  };
  logger.debug({ event: 'kasi_request_started', ...identity });
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
      headers: { Accept: 'application/xml' },
    });
    httpStatus = response.status;
    stage = 'http_response';
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('KASI unavailable');
    }
    const reader = response.body.getReader();
    stage = 'response_body';
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES)
          throw new Error('KASI response too large');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const xml = Buffer.concat(chunks).toString('utf8');
    stage = 'xml_parse';
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
      throw new Error('Invalid KASI XML');
    const result: unknown = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      processEntities: false,
      isArray: (_name, path) => path === 'response.body.items.item',
    }).parse(xml) as unknown;
    logger.debug({
      event: 'kasi_request_completed',
      ...identity,
      httpStatus,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch {
    logger.warn({
      event: 'kasi_request_failed',
      ...identity,
      stage,
      httpStatus,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw new Error('KASI unavailable');
  }
}
