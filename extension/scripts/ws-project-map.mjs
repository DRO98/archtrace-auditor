import WebSocket from "ws";

const requestId = `scan-${Date.now()}`;
const socket = new WebSocket("ws://127.0.0.1:8080");
let settled = false;

const timer = setTimeout(() => {
  console.error("timed out waiting for PROJECT_MAP");
  process.exit(1);
}, 10_000);

socket.on("open", () => {
  socket.send(
    JSON.stringify({
      protocol: "TEACHER_CANVAS_v1",
      action: "REQUEST_PROJECT_MAP",
      payload: { requestId: "bad id" },
    }),
  );
  socket.send(
    JSON.stringify({
      protocol: "TEACHER_CANVAS_v1",
      action: "REQUEST_PROJECT_MAP",
      payload: { requestId },
    }),
  );
});

socket.on("message", (data) => {
  const message = JSON.parse(String(data));
  if (message.action !== "PROJECT_MAP") return;
  if (message.payload?.requestId !== requestId) {
    console.error("unexpected requestId");
    process.exit(1);
  }
  settled = true;
  clearTimeout(timer);
  socket.close();
  process.exit(0);
});

socket.on("close", () => {
  if (!settled) process.exit(1);
});

socket.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
