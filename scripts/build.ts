// Builds dist/ from src/: `bun scripts/build.ts`. Runs as `prepare`, so installing chronosjs from git
// (`github:evolvedmesh/chronosjs#<commit>`, with chronosjs in the app's trustedDependencies) builds it from source on
// the spot: no prebuilt artifact is ever downloaded. The package.json version is stamped into the telemetry tag.
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname;
const { version } = (await Bun.file(`${root}package.json`).json()) as { version: string };

await $`rm -rf dist`.cwd(root);
// Resolved from this package, not PATH: a lifecycle script of an installed dependency doesn't see the app's .bin.
const tsc = `${Bun.fileURLToPath(import.meta.resolve("typescript/package.json")).replace(/package\.json$/, "")}bin/tsc`;
// --noCheck: emit only. chronosjs's own CI type-checks everything (`bun run typecheck`); an install-time build must not
// fail because an app's production install has no @types/react.
await $`${tsc} -p tsconfig.json --noCheck`.cwd(root);

const transport = `${root}dist/transports/appinsights.js`;
const built = await Bun.file(transport).text();
if (!built.includes("chronosjs:0.0.0-development")) throw new Error("sdkVersion placeholder not found");
await Bun.write(transport, built.replace("chronosjs:0.0.0-development", `chronosjs:${version}`));
console.log(`chronosjs ${version} built from source`);
