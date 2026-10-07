import { WebSocket } from "ws";

const socket = new WebSocket("ws://127.0.0.1:8080");
let finished = false;

const fail = (message) => {
  if (finished) {
    return;
  }
  finished = true;
  console.error(message);
  socket.close();
  process.exit(1);
};

socket.on("error", (error) => {
  fail(error instanceof Error ? error.message : String(error));
});

socket.on("close", () => {
  if (!finished) {
    fail("socket closed before the checks finished");
  }
});

socket.on("open", () => {
  socket.send(
    JSON.stringify({
      protocol: "TEACHER_CANVAS_v1",
      action: "NAVIGATE_TO_CODE",
      payload: {
        filePath: "src/example.ts",
        range: { startLine: 1, endLine: 2 },
      },
    }),
  );
  socket.send("{not json");
  socket.send(
    JSON.stringify({
      protocol: "WRONG",
      action: "CLEAR_HIGHLIGHTS",
      payload: {},
    }),
  );

  setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      fail(`socket is not open (readyState ${socket.readyState})`);
      return;
    }
    finished = true;
    console.log("ok");
    socket.close();
    process.exit(0);
  }, 400);
});

setTimeout(() => {
  fail("timed out waiting for the WebSocket server");
}, 5000);
