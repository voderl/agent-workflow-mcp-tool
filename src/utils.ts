import type { ZodType } from "zod";
import z from "zod";

export function wrapText(text: string) {
  return [
    {
      type: "text" as const,
      text: trimText(text),
    },
  ];
}

export function trimText(text: string) {
  if (!text) return "";
  return text.trim().replace(/\n+/g, "\n");
}

export function formatToJsonSchema(schema: ZodType) {
  const jsonSchema = z.toJSONSchema(schema);
  if ("$schema" in jsonSchema) delete jsonSchema["$schema"];
  return jsonSchema;
}

export function formatError(error: any) {
  // 处理非错误对象的情况
  if (error == null) {
    return String(error);
  }

  // 如果是字符串，直接返回
  if (typeof error === "string") return error;

  // 如果是普通对象，尝试序列化
  if (typeof error === "object" && !(error instanceof Error)) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return error.message || error.toString();
}

export function formatToString(data: any) {
  // 处理非错误对象的情况
  if (data === null || data === undefined) return String(data);

  // 如果是字符串，直接返回
  if (typeof data === "string") return `"${data}"`;

  if (typeof data === "number") return `${data}`;

  return JSON.stringify(data);
}
