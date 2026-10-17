import { createFileRoute } from "@tanstack/react-router";
import { reportScenarioSchema } from "@demo/api-contract";
import { reportOptions } from "../queries/reports";
import { ReportPage } from "../features/reports/report-page";

export const Route = createFileRoute("/reports")({
  validateSearch: (search: Record<string, unknown>) => ({
    scenario: reportScenarioSchema.catch("slow").parse(search.scenario),
  }),
  loaderDeps: ({ search }) => ({ scenario: search.scenario }),
  loader: ({ context, deps }) => {
    // prefetchQuery absorbs rejection. Do not await: the page shell can render now.
    void context.queryClient.prefetchQuery(reportOptions(deps.scenario));
  },
  component: ReportPage,
});
