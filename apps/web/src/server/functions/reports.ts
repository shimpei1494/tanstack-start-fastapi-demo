import { createServerFn } from "@tanstack/react-start";
import { reportScenarioSchema, summaryReportSchema } from "@demo/api-contract";
import { apiClient, checked } from "../api-client/client.server";

export const getSummaryReport = createServerFn({ method: "GET" })
  .validator(reportScenarioSchema)
  .handler(async ({ data }) => {
    try {
      const result = await apiClient().GET("/reports/summary", {
        params: { query: { scenario: data } },
      });
      return checked(summaryReportSchema, result.data, result.error);
    } catch (error) {
      if (error instanceof TypeError)
        throw new Error("APIへ接続できません。FastAPIの起動を確認してください。");
      throw error;
    }
  });
