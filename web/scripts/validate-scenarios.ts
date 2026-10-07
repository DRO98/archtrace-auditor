import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCodeGraph } from "../src/features/canvas/lib/graph";
import { drawnGraph } from "../src/features/simulation/lib/drawnEdges";
import { resolveScenarioRoutes } from "../src/features/simulation/lib/route";
import { parseScenarioFile } from "../src/features/simulation/lib/scenario";

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function main(): void {
  const dir = path.resolve(process.cwd(), "public/scenarios");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  let failed = false;

  for (const name of files) {
    const graphName = name.replace(/\.json$/, "");
    const graphFile = path.resolve(process.cwd(), "public/graphs", name);
    const parsedGraph = parseCodeGraph(readJson(graphFile));
    if (!parsedGraph.ok) {
      console.error(`✗ ${name}: el grafo ${graphName} es inválido\n  ${parsedGraph.errors.join("\n  ")}`);
      failed = true;
      continue;
    }
    // Contra lo que realmente se dibuja: módulos visibles y aristas de layeredFlow.
    const drawn = drawnGraph(parsedGraph.graph);
    const result = parseScenarioFile(readJson(path.join(dir, name)), drawn.graph, drawn.edges);
    if (!result.ok) {
      console.error(`✗ ${name}\n  ${result.errors.join("\n  ")}`);
      failed = true;
      continue;
    }
    // Cada transición debe tener camino: si no, el paquete "salta" sin recorrer ninguna arista.
    for (const scenario of result.file.scenarios) {
      const routes = resolveScenarioRoutes(scenario.steps, drawn.edges);
      routes.forEach((route, index) => {
        if (route !== null) return;
        const from = scenario.steps[index]?.nodeId;
        const to = scenario.steps[index + 1]?.nodeId;
        console.error(`✗ ${name} · ${scenario.id} · paso ${index}: no hay camino de ${from} a ${to}`);
        failed = true;
      });
    }
    if (!failed) console.info(`✓ ${name}: ${result.file.scenarios.length} escenarios`);
  }

  if (failed) process.exit(1);
}

main();
