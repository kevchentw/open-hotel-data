import { writeStageOneOutputs } from "../data-pipeline/1-list/scripts/hilton-brands.mjs";

writeStageOneOutputs().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
