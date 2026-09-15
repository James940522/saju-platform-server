import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
} from '@nestjs/common';
import { z } from 'zod';

// Only fixed diagnostic values may reach logs; never retain provider text,
// validation messages, generated fortunes, or request data in an exception.
const WealthRankingFailureDiagnosticSchema = z.strictObject({
  stage: z.enum([
    'pipeline_timeout',
    'provider_http',
    'provider_transport',
    'provider_timeout',
    'provider_empty_body',
    'provider_response_size',
    'provider_response_json',
    'provider_completion',
    'model_output_json',
    'model_output_schema',
    'model_participants',
    'model_equivalent_order',
    'model_evidence',
    'model_references',
    'result_schema',
  ]),
  upstreamStatus: z.number().int().min(100).max(599).optional(),
});
export type WealthRankingFailureStage = z.infer<
  typeof WealthRankingFailureDiagnosticSchema
>['stage'];

function failureReason(stage: WealthRankingFailureStage) {
  if (stage === 'provider_timeout' || stage === 'pipeline_timeout')
    return 'READING_TIMEOUT';
  if (stage === 'provider_http' || stage === 'provider_transport')
    return 'READING_PROVIDER_FAILED';
  return 'READING_OUTPUT_INVALID';
}

export function wealthRankingFailure(
  stage: WealthRankingFailureStage,
  upstreamStatus?: number,
) {
  const cause = WealthRankingFailureDiagnosticSchema.parse({
    stage,
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
  });
  const Exception =
    stage === 'provider_timeout' || stage === 'pipeline_timeout'
      ? GatewayTimeoutException
      : BadGatewayException;
  return new Exception({ reason: failureReason(stage) }, { cause });
}

export function getWealthRankingFailureDiagnostic(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const parsed = WealthRankingFailureDiagnosticSchema.safeParse(error.cause);
  return parsed.success
    ? {
        reason: failureReason(parsed.data.stage),
        status: error.getStatus(),
        ...parsed.data,
      }
    : null;
}
