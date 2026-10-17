import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createTodoSchema,
  updateTodoSchema,
  filterSchema,
  todoSchema,
  suggestionInputSchema,
  suggestionsSchema,
} from "@demo/api-contract";
import { apiClient, checked } from "../api-client/client.server";

export const listTodos = createServerFn({ method: "GET" })
  .validator(filterSchema)
  .handler(async ({ data }) => {
    try {
      const result = await apiClient().GET("/todos", {
        params: { query: { completed: data === "all" ? undefined : data === "completed" } },
      });
      return checked(z.array(todoSchema), result.data, result.error);
    } catch (error) {
      if (error instanceof TypeError)
        throw new Error("APIへ接続できません。FastAPIの起動を確認してください。");
      throw error;
    }
  });
export const createTodo = createServerFn({ method: "POST" })
  .validator(createTodoSchema)
  .handler(async ({ data }) => {
    const result = await apiClient().POST("/todos", { body: data });
    return checked(todoSchema, result.data, result.error);
  });
export const updateTodo = createServerFn({ method: "POST" })
  .validator(updateTodoSchema)
  .handler(async ({ data: { id, ...body } }) => {
    const result = await apiClient().PATCH("/todos/{todo_id}", {
      params: { path: { todo_id: id } },
      body,
    });
    return checked(todoSchema, result.data, result.error);
  });
export const deleteTodo = createServerFn({ method: "POST" })
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await apiClient().DELETE("/todos/{todo_id}", {
      params: { path: { todo_id: data } },
    });
    if (result.error) checked(z.unknown(), undefined, result.error);
    return { deleted: true };
  });
export const suggestTodos = createServerFn({ method: "POST" })
  .validator(suggestionInputSchema)
  .handler(async ({ data }) => {
    const result = await apiClient().POST("/ai/suggestions", { body: data });
    return checked(suggestionsSchema, result.data, result.error);
  });
