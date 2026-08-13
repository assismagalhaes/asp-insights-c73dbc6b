import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const expectedWorker = "asp-insights-staging";
const generatedConfig = "dist/server/wrangler.json";
const dryRun = process.argv.includes("--dry-run");

function run(command, args, env = process.env) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("vite", ["build"], { ...process.env, CLOUDFLARE_ENV: "staging" });

const config = JSON.parse(readFileSync(generatedConfig, "utf8"));
if (config.name !== expectedWorker) {
  throw new Error(
    `Refusing Cloudflare deployment target ${JSON.stringify(config.name)}; expected ${expectedWorker}`,
  );
}

const hasCustomDomain = (config.routes ?? []).some(
  (route) => route.pattern === "staging.asp-insights.com.br" && route.custom_domain === true,
);
if (!hasCustomDomain) {
  throw new Error("Generated staging manifest is missing the custom-domain route");
}

const deployEnv = { ...process.env };
delete deployEnv.CLOUDFLARE_ENV;
const deployArgs = ["deploy", "--config", generatedConfig];
if (dryRun) deployArgs.push("--dry-run");
run("wrangler", deployArgs, deployEnv);
