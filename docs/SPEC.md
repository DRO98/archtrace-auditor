MVP Specification & Architecture Document
Project Name: ArchTrace (Visual Code Onboarding & Dual-Screen Tutor)
1. Executive Summary & Core Objective
The Problem: Developers and non-developers are generating massive, multi-file codebases using AI agents (Claude, Cursor, Devin). They end up with a "black box" system where they don't understand how components connect, leading to broken mental models and severe technical debt.

The Solution: A dual-screen / multi-monitor AI companion app.

Screen 1 (Primary): Clean IDE (VS Code / Cursor) dedicated purely to code editing.

Screen 2 (Secondary / Companion): A visual "ArchTrace" running in a Web App/PWA. It abstracts code into high-level conceptual blocks (Zoom Semántico), explains logic in human terms on demand, and controls Screen 1 via WebSockets (clicking a node highlights and scrolls to the exact lines of code in the IDE).

Architectural Philosophy: Zero-AI-cost for the creator (BYOK - Bring Your Own Key or Local Ollama). Light local footprint, high UX responsiveness (<10ms UI sync).

2. System Architecture & Component Breakdown
 ┌─────────────────────────────────────────────────────────┐
 │                   SCREEN 1: THE IDE                     │
 │               (VS Code / Cursor Extension)              │
 │                                                         │
 │  ┌──────────────────────┐    ┌──────────────────────┐  │
 │  │ Extension Host       │    │ Local WS Server      │  │
 │  │ - Decorator API      │◄───┤ - Port 8080 / WS     │  │
 │  │ - File Navigator     │    │ - JSON Message Bus   │  │
 │  └──────────────────────┘    └──────────▲───────────┘  │
 └─────────────────────────────────────────┼───────────────┘
                                           │
                           WebSocket Line  │ (Localhost / LAN)
                           <10ms Latency   │
                                           │
 ┌─────────────────────────────────────────┼───────────────┐
 │                                         ▼               │
 │               (React Flow + Next.js App)                │
 │                                                         │
 │  ┌──────────────────────┐    ┌──────────────────────┐  │
 │  │ Canvas Engine        │    │ AI Orchestrator      │  │
 │  │ - React Flow (Nodes) │    │ - BYOK (OpenAI/Ant)  │  │
 │  │ - Semantic Zoom      │    │ - System Prompts     │  │
 │  └──────────────────────┘    └──────────────────────┘  │
 │                   SCREEN 2: THE TEACHER                 │
 └─────────────────────────────────────────────────────────┘
The system is split into three core packages:

A. The VS Code Extension (archtrace-extension)
Role: A lightweight bridge. It runs a local WebSocket server (ws://localhost:8080) inside VS Code.

Key Capabilities:

Listens for navigation commands from the WebApp.

Uses vscode.workspace.openTextDocument to open files instantly.

Uses vscode.window.activeTextEditor.setDecorations to apply temporary line highlights (color coding).

Uses tree-sitter or local file watcher to notify the Canvas when files are modified.

B. The ArchTrace WebApp (archtrace-web)
Role: The interactive "Teacher" dashboard designed for Monitor 2 or iPad/Tablet.

Tech Stack: React / Next.js, React Flow (or Svelte Flow), Tailwind CSS, Lucide Icons, Socket.io-client / Native WebSockets.

Key Capabilities:

Displays macro-level architecture nodes (Layer 0) and micro-level functions (Layer 1).

Manages the BYOK API Keys (stored safely in localStorage).

Triggers background AI requests for node humanization upon click.

C. The Parser & AI Orchestrator (archtrace-core)
Role: Extracts system topology and formats AI system prompts.

Tech Stack: tree-sitter for deterministic syntax parsing + Anthropic/OpenAI SDKs for semantic grouping.

3. The Communication Protocol (WebSocket Schema)
All real-time communication happens over local WebSockets using strict JSON events.

Event 1: Canvas -> IDE (Jump & Highlight Code)
Triggered when the user clicks a component node or line connection in the WebApp.

JSON
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "NAVIGATE_TO_CODE",
  "payload": {
    "filePath": "src/rag/vector_store.py",
    "range": {
      "startLine": 14,
      "endLine": 45
    },
    "highlightColor": "rgba(59, 130, 246, 0.3)",
    "focusEditor": true
  }
}
Event 2: IDE -> Canvas (File Modified / Active Line Changed)
Triggered when the user changes files or edits code in VS Code.

JSON
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "IDE_STATE_CHANGED",
  "payload": {
    "activeFile": "src/rag/vector_store.py",
    "cursorLine": 22,
    "status": "dirty"
  }
}
Event 3: Canvas -> IDE (Clear Highlights)
JSON
{
  "protocol": "TEACHER_CANVAS_v1",
  "action": "CLEAR_HIGHLIGHTS",
  "payload": {}
}
4. Layered UX & Semantic Zoom Workflow
To avoid the "Spaghetti Code" diagram problem, the system enforces strict progressive disclosure:

[ LEVEL 0: MACRO ARCHITECTURE ]  ---> Max 4 to 6 core functional blocks.
       │                              (e.g., API Gateway, RAG Pipeline, DB, Vector Index)
       │ (User clicks on "RAG Pipeline")
       ▼
[ LEVEL 1: MODULE DRILL-DOWN ]   ---> Displays inner files and specific data-flow routes.
       │                              (e.g., embeddings.py, chunker.py, search.py)
       │ (User clicks on "embeddings.py")
       ▼
[ LEVEL 2: HUMAN EXPLANATION ]   ---> Opens the "Teacher Drawer" with layman explanation,
                                      analogy, and triggers VS Code jump to exact lines.
5. AI Prompt Engineering & Humanization Specs
When a user triggers a node explanation, the web client sends a request to the user's configured LLM (via BYOK). The prompt must enforce non-technical, high-level analogies.

System Prompt Template (teacher_system_prompt.txt)
Plaintext
You are an expert Lead Software Architect and Academic Tutor. Your goal is to explain code to someone who may not have written it.

RULES:
1. Speak in plain language. Use real-world analogies (e.g., "This vector DB is like a library with an index based on topics instead of titles").
2. Be concise. Maximum 3 short paragraphs.
3. Structure your response as:
   - 🎯 **What this component actually does** (1-2 sentences)
   - 💡 **Real-world Analogy** (1 sentence)
   - 🔗 **Inputs & Outputs** (What enters here and where does it go next?)
4. Do NOT output raw code unless asked explicitly. Focus on architectural intent.
6. MVP Development Roadmap (Phase-by-Phase)
Deliver this roadmap step-by-step to Cursor or Claude Code:

Phase 1: The WebSocket Bridge 
[ ] Create a VS Code extension project using yo code.

[ ] Implement a Node.js WebSocket server inside extension.ts listening on ws://localhost:8080.

[ ] Add a command in VS Code that accepts a file path + line range and uses vscode.window.showTextDocument and createTextEditorDecorationType to highlight lines.

[ ] Build a barebones HTML file running on localhost:3000 with 2 buttons ("Highlight RAG Code", "Highlight DB Code") to verify that clicking a button in the browser instantly jumps and highlights lines in VS Code.

Phase 2: React Flow Canvas & Mock Nodes 
[ ] Initialize a Next.js app with reactflow installed.

[ ] Create custom Node components: MacroNode (big conceptual box) and SubNode (file/function level).

[ ] Connect React Flow state to the WebSocket client hook.

[ ] Hardcode a mock project JSON structure (macro_rag_project.json) with 4 connected nodes (API, RAG Engine, Vector DB, LLM Service).

[ ] Ensure clicking any React Flow node dispatches the NAVIGATE_TO_CODE WebSocket payload.

Phase 3: BYOK & Automated Topology Parsing
[ ] Implement a settings modal in the WebApp for user API Key input (OpenAI / Anthropic / Ollama Endpoint).

[ ] Write a directory scanner utility in the extension that reads project file structures and generates a initial graph JSON using an LLM macro-pass.

[ ] Integrate the "Teacher Drawer" side-panel: when a node is selected, call the LLM with the teacher_system_prompt and stream the humanized text into the UI.

Phase 4: Polish & Dual-Screen Experience 
[ ] Add "Semantic Zoom" transitions in React Flow (smooth zoom in/out when entering a cluster).

[ ] Implement dark mode layout optimized for OLED/secondary monitors.

[ ] Test latency and edge cases (e.g., missing files, broken WS connection auto-reconnect).

7. Direct Instructions for Prompting Cursor / Claude
Copy and paste the box below into Cursor / Claude as your initial kick-off prompt:

Plaintext
Act as a Principal Full-Stack Engineer and VS Code Extension Expert. We are building "ArchTrace": a dual-screen visual tutor for inspecting complex codebase architectures.

Please review the architectural spec above carefully.

Your immediate task:
Let's begin with PHASE 1. Please write the complete TypeScript code for a minimal VS Code extension (`extension.ts`) that:
1. Starts a local WebSocket server on `ws://localhost:8080` when activated.
2. Listens for incoming JSON messages matching the `NAVIGATE_TO_CODE` schema specified in Section 3.
3. Opens the specified `filePath`, scrolls the active editor to `range.startLine`, and applies a blue background highlight decoration to lines from `startLine` to `endLine`.
4. Handles WebSocket disconnections cleanly without crashing VS Code.

Provide the package.json dependencies required and the step-by-step commands to run and