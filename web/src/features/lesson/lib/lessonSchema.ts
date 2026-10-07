export const LESSON_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["title", "overview", "coverage", "caveats", "steps"],
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    coverage: { type: "string", enum: ["full", "partial", "not_found"] },
    caveats: { type: "array", items: { type: "string" } },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stepNumber", "title", "summary", "symbol", "codeRef", "connectionReason"],
        properties: {
          stepNumber: { type: "number" },
          title: { type: "string" },
          summary: { type: "string" },
          symbol: { type: "string" },
          codeRef: {
            type: "object",
            additionalProperties: false,
            required: ["filePath", "startLine", "endLine"],
            properties: {
              filePath: { type: "string" },
              startLine: { type: "number" },
              endLine: { type: "number" },
            },
          },
          connectionReason: { type: "string" },
        },
      },
    },
  },
};

export const SELECTOR_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["files"],
  properties: {
    files: { type: "array", items: { type: "string" } },
  },
};

export const FOLLOW_UP_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["format", "answer", "lessonGoal", "grounding"],
  properties: {
    format: { type: "string", enum: ["text", "lesson"] },
    answer: { type: "string" },
    lessonGoal: { type: "string" },
    grounding: { type: "string", enum: ["project", "theory", "not-in-map"] },
  },
};
