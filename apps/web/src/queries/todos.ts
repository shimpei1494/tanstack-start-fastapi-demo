import { queryOptions } from "@tanstack/react-query";
import type { TodoFilter } from "@demo/api-contract";
import { listTodos } from "../server/functions/todos";
export const todoOptions = (filter: TodoFilter) =>
  queryOptions({
    queryKey: ["todos", filter],
    queryFn: () => listTodos({ data: filter }),
    staleTime: 30_000,
  });
