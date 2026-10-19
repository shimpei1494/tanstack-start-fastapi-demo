import { noop } from "@tanstack/react-query";
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
    // Swallow rejection here; the page reads the error. Do not await: the page shell can render now.
    void context.queryClient.query(reportOptions(deps.scenario)).catch(noop);
  },
  component: ReportPage,
});
