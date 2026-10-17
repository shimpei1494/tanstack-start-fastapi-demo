import { queryOptions } from "@tanstack/react-query";
import type { ReportScenario } from "@demo/api-contract";
import { getSummaryReport } from "../server/functions/reports";

export const reportOptions = (scenario: ReportScenario) =>
  queryOptions({
    queryKey: ["reports", "summary", scenario],
    queryFn: () => getSummaryReport({ data: scenario }),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
