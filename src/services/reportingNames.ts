import type { getFormReferenceData } from "./referenceDataService";

type ReferenceData = Awaited<ReturnType<typeof getFormReferenceData>>;

export interface ReportNameResolvers {
  sourceName: (id: string | null) => string;
  stageName: (id: string | null) => string;
  serviceName: (id: string | null) => string;
}

/** Shared by the Reports page and the CSV export so both resolve the same IDs to the same labels (FIG-603). */
export function buildReportNameResolvers(referenceData: ReferenceData): ReportNameResolvers {
  return {
    sourceName: (id) =>
      referenceData.leadSources.find((s) => s.id === id)?.name ?? "(unknown)",
    stageName: (id) =>
      referenceData.pipelineStages.find((s) => s.id === id)?.name ?? "(unknown)",
    serviceName: (id) =>
      referenceData.services.find((s) => s.id === id)?.name ?? "(unspecified)",
  };
}
