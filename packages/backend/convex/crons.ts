import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sync active sandbox costs", { minutes: 5 }, internal.sandboxCostActions.batchSyncActiveSandboxCosts);
crons.interval("finalize deleted sandbox costs", { minutes: 1 }, internal.sandboxCostActions.finalizePendingDeletedSandboxCosts);

export default crons;
