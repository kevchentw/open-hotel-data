import { writeStageOneOutputs } from "../data-pipeline/1-list/scripts/aspire-hotel.mjs";

writeStageOneOutputs().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
