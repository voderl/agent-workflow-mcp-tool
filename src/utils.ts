export function wrapText(text: string) {
  return [
    {
      type: "text" as const,
      text: text,
    },
  ];
}

// avoid loop
export function wrapProgress(text: string, progress: string) {
  return `Workflow progress: ${progress}.
${text}`;
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
      return JSON.stringify(error, null, 2);
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

export function* createMockProgressGenerator(): Generator<string> {
  let n = 0;

  while (true) {
    n++;

    const progress = 100 * (n / (n + 4));
    yield `${parseFloat(progress.toFixed(2))}%`;
  }
}
