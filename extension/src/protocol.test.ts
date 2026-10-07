import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMessage } from "./protocol.js";

describe("parseMessage", () => {
  it("accepts a valid NAVIGATE_TO_CODE message", () => {
    const message = parseMessage(
      JSON.stringify({
        protocol: "TEACHER_CANVAS_v1",
        action: "NAVIGATE_TO_CODE",
        payload: {
          filePath: "src/rag/vector_store.py",
          range: { startLine: 14, endLine: 45 },
          highlightColor: "rgba(59, 130, 246, 0.3)",
          focusEditor: true,
        },
      }),
    );

    assert.deepEqual(message, {
      protocol: "TEACHER_CANVAS_v1",
      action: "NAVIGATE_TO_CODE",
      payload: {
        filePath: "src/rag/vector_store.py",
        range: { startLine: 14, endLine: 45 },
        highlightColor: "rgba(59, 130, 246, 0.3)",
        focusEditor: true,
      },
    });
  });

  it("accepts a valid CLEAR_HIGHLIGHTS message", () => {
    const message = parseMessage(
      JSON.stringify({
        protocol: "TEACHER_CANVAS_v1",
        action: "CLEAR_HIGHLIGHTS",
        payload: {},
      }),
    );

    assert.deepEqual(message, {
      protocol: "TEACHER_CANVAS_v1",
      action: "CLEAR_HIGHLIGHTS",
      payload: {},
    });
  });

  it("returns null for broken JSON", () => {
    assert.equal(parseMessage("{"), null);
  });

  it("returns null for the wrong protocol", () => {
    assert.equal(
      parseMessage(
        JSON.stringify({
          protocol: "OTHER",
          action: "CLEAR_HIGHLIGHTS",
          payload: {},
        }),
      ),
      null,
    );
  });

  it("returns null for an unknown action", () => {
    assert.equal(
      parseMessage(
        JSON.stringify({
          protocol: "TEACHER_CANVAS_v1",
          action: "UNKNOWN",
          payload: {},
        }),
      ),
      null,
    );
  });

  it("returns null when startLine is 0", () => {
    assert.equal(
      parseMessage(
        JSON.stringify({
          protocol: "TEACHER_CANVAS_v1",
          action: "NAVIGATE_TO_CODE",
          payload: {
            filePath: "src/app.ts",
            range: { startLine: 0, endLine: 2 },
          },
        }),
      ),
      null,
    );
  });

  it("returns null when endLine is before startLine", () => {
    assert.equal(
      parseMessage(
        JSON.stringify({
          protocol: "TEACHER_CANVAS_v1",
          action: "NAVIGATE_TO_CODE",
          payload: {
            filePath: "src/app.ts",
            range: { startLine: 8, endLine: 3 },
          },
        }),
      ),
      null,
    );
  });

  it("returns null when filePath is empty", () => {
    assert.equal(
      parseMessage(
        JSON.stringify({
          protocol: "TEACHER_CANVAS_v1",
          action: "NAVIGATE_TO_CODE",
          payload: {
            filePath: "",
            range: { startLine: 1, endLine: 2 },
          },
        }),
      ),
      null,
    );
  });

  it("accepts REQUEST_PROJECT_MAP and rejects bad request ids", () => {
    assert.deepEqual(
      parseMessage(
        JSON.stringify({
          protocol: "TEACHER_CANVAS_v1",
          action: "REQUEST_PROJECT_MAP",
          payload: { requestId: "scan_1" },
        }),
      ),
      {
        protocol: "TEACHER_CANVAS_v1",
        action: "REQUEST_PROJECT_MAP",
        payload: { requestId: "scan_1" },
      },
    );
    for (const requestId of ["", "bad id", "x".repeat(65)]) {
      assert.equal(
        parseMessage(
          JSON.stringify({
            protocol: "TEACHER_CANVAS_v1",
            action: "REQUEST_PROJECT_MAP",
            payload: { requestId },
          }),
        ),
        null,
      );
    }
  });

  it("accepts REQUEST_GIT_DIFF with safe refs and rejects option-like refs", () => {
    const frame = (payload: unknown) => JSON.stringify({ protocol: "TEACHER_CANVAS_v1", action: "REQUEST_GIT_DIFF", payload });
    assert.deepEqual(parseMessage(frame({ requestId: "r1", base: "main", head: null }))?.payload, { requestId: "r1", base: "main", head: null });
    assert.equal(parseMessage(frame({ requestId: "r1", base: "--output=x", head: null })), null);
    assert.equal(parseMessage(frame({ requestId: "r1", base: "main", head: "-p" })), null);
    assert.equal(parseMessage(frame({ requestId: "r1", base: "main" })), null);
    assert.equal(
      parseMessage(JSON.stringify({ protocol: "TEACHER_CANVAS_v1", action: "REQUEST_GIT_REFS", payload: { requestId: "abc" } }))?.action,
      "REQUEST_GIT_REFS",
    );
  });
});
