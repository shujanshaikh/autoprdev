import { readFile } from "node:fs/promises";
import { analyzeAgentUsage } from "../src/lib/agent-usage-analysis";

const [logPath, taskPath] = process.argv.slice(2);
if (!logPath || !taskPath) throw new Error("Usage: tsx scripts/analyze-agent-usage.ts events.jsonl tasks.json");
const events = (await readFile(logPath, "utf8")).split("\n").filter((line) => line.trim()).map((line): unknown => JSON.parse(line));
const tasks: unknown = JSON.parse(await readFile(taskPath, "utf8"));
console.log(JSON.stringify(analyzeAgentUsage(events, tasks), null, 2));
