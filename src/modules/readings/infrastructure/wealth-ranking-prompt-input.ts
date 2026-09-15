import type { WealthRankingContext } from '../wealth-ranking-context.js';

// Only the provider projection is compacted. Full native analysis and KASI
// verification remain in the server context for validation and result notices.
export function buildWealthRankingPromptInput(context: WealthRankingContext) {
  return {
    productCode: 'wealth-ranking' as const,
    participants: context.map((participant) => {
      const analysis = participant.fortuneTellerAnalysis;
      const yongSin = analysis.yongSin;
      const { evidenceIds: _monthEvidenceIds, ...monthSupport } =
        analysis.monthSupport;
      return {
        participantKey: participant.participantKey,
        quality: participant.quality,
        dayMaster: participant.dayMaster,
        facts: participant.facts,
        hiddenStemFacts: participant.hiddenStemFacts.map((fact) => ({
          id: fact.id,
          stemKorean: fact.stemKorean,
          elementKorean: fact.elementKorean,
          yinYangKorean: fact.yinYangKorean,
          tenGodKorean: fact.tenGodKorean,
          isPrincipal: fact.isPrincipal,
          seasonalWeight: fact.seasonalWeight,
        })),
        branchRelations: participant.branchRelations,
        elementDistribution: participant.elementDistribution,
        warningCodes: participant.warningCodes,
        fortuneTellerAnalysis: {
          status: analysis.status,
          pillarsUsed: analysis.pillarsUsed,
          tenGodCounts: analysis.tenGodDistribution.counts,
          monthSupport,
          branchRelationships: analysis.branchRelationships,
          dayMasterStrength: analysis.dayMasterStrength,
          gyeokGuk: analysis.gyeokGuk,
          yongSin: yongSin
            ? {
                primaryYongSin: yongSin.primaryYongSin,
                secondaryYongSin: yongSin.secondaryYongSin,
                xiSin: yongSin.xiSin,
                jiSin: yongSin.jiSin,
                chouSin: yongSin.chouSin,
                reasoning: yongSin.reasoning,
                recommendations: {
                  careers: yongSin.recommendations.careers,
                  activities: yongSin.recommendations.activities,
                  cautions: yongSin.recommendations.cautions,
                },
              }
            : null,
          sinSals: analysis.sinSals,
          wealth: {
            summary: analysis.wealth.summary,
            positive: analysis.wealth.positive,
            negative: analysis.wealth.negative,
            advice: analysis.wealth.advice,
          },
          excludedAnalyses: analysis.excludedAnalyses,
        },
      };
    }),
  };
}
