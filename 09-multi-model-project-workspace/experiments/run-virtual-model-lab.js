import { runVirtualModelExperiment } from "../src/virtual-model-lab.js";

try {
  const report = runVirtualModelExperiment();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
