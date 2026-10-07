import type {
  CanvasToIdeMessage,
  ClearHighlightsPayload,
  NavigateToCodePayload,
  RequestGitDiffPayload,
  RequestProjectMapPayload,
} from "@core/protocol";
import { isSafeRef } from "./gitDiff.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLineNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function readNavigatePayload(payload: unknown): NavigateToCodePayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const filePath = payload.filePath;
  if (typeof filePath !== "string" || filePath.length === 0) {
    return null;
  }

  if (!isRecord(payload.range)) {
    return null;
  }

  const startLine = payload.range.startLine;
  const endLine = payload.range.endLine;
  if (!isLineNumber(startLine) || !isLineNumber(endLine) || endLine < startLine) {
    return null;
  }

  const parsed: NavigateToCodePayload = {
    filePath,
    range: { startLine, endLine },
  };

  if ("highlightColor" in payload) {
    if (typeof payload.highlightColor !== "string") {
      return null;
    }
    parsed.highlightColor = payload.highlightColor;
  }

  if ("focusEditor" in payload) {
    if (typeof payload.focusEditor !== "boolean") {
      return null;
    }
    parsed.focusEditor = payload.focusEditor;
  }

  return parsed;
}

function readClearPayload(payload: unknown): ClearHighlightsPayload | null {
  if (!isRecord(payload) || Object.keys(payload).length !== 0) {
    return null;
  }
  return {};
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function readRequestPayload(payload: unknown): RequestProjectMapPayload | null {
  if (!isRecord(payload) || typeof payload.requestId !== "string" || !REQUEST_ID.test(payload.requestId)) {
    return null;
  }
  return { requestId: payload.requestId };
}

function readGitDiffPayload(payload: unknown): RequestGitDiffPayload | null {
  const request = readRequestPayload(payload);
  if (!request || !isRecord(payload)) return null;
  const { base, head } = payload;
  if (typeof base !== "string" || !isSafeRef(base)) return null;
  if (head !== null && (typeof head !== "string" || !isSafeRef(head))) return null;
  return { requestId: request.requestId, base, head };
}

export function parseMessage(raw: string): CanvasToIdeMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(data) || data.protocol !== "TEACHER_CANVAS_v1") {
    return null;
  }

  if (data.action === "NAVIGATE_TO_CODE") {
    const payload = readNavigatePayload(data.payload);
    if (!payload) {
      return null;
    }
    return {
      protocol: "TEACHER_CANVAS_v1",
      action: "NAVIGATE_TO_CODE",
      payload,
    };
  }

  if (data.action === "CLEAR_HIGHLIGHTS") {
    const payload = readClearPayload(data.payload);
    if (!payload) {
      return null;
    }
    return {
      protocol: "TEACHER_CANVAS_v1",
      action: "CLEAR_HIGHLIGHTS",
      payload,
    };
  }

  if (data.action === "REQUEST_PROJECT_MAP") {
    const payload = readRequestPayload(data.payload);
    if (!payload) return null;
    return { protocol: "TEACHER_CANVAS_v1", action: "REQUEST_PROJECT_MAP", payload };
  }

  if (data.action === "REQUEST_GIT_REFS") {
    const payload = readRequestPayload(data.payload);
    if (!payload) return null;
    return { protocol: "TEACHER_CANVAS_v1", action: "REQUEST_GIT_REFS", payload };
  }

  if (data.action === "REQUEST_GIT_DIFF") {
    const payload = readGitDiffPayload(data.payload);
    if (!payload) return null;
    return { protocol: "TEACHER_CANVAS_v1", action: "REQUEST_GIT_DIFF", payload };
  }

  if (data.action === "REQUEST_LOCAL_SERVICES") {
    const payload = readRequestPayload(data.payload);
    if (!payload) return null;
    return { protocol: "TEACHER_CANVAS_v1", action: "REQUEST_LOCAL_SERVICES", payload };
  }

  return null;
}
