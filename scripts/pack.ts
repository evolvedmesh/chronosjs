// Builds and packs a release: `bun scripts/pack.ts <version>` writes release/chronosjs-<version>.tgz.
// semantic-release runs it (see .releaserc.json) and attaches the tarball to the GitHub release; apps install
// that URL. The version is stamped into package.json here only, never committed: tags carry the version.
import { $ } from "bun";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: bun scripts/pack.ts <semver>");
  process.exit(1);
}

const root = new URL("..", import.meta.url).pathname;
const manifest = await Bun.file(`${root}package.json`).json();
manifest.version = version;
await Bun.write(`${root}package.json`, `${JSON.stringify(manifest, null, 2)}\n`);

await $`bun run build`.cwd(root);
// The telemetry sdkVersion tag names the release.
const transport = `${root}dist/transports/appinsights.js`;
const built = await Bun.file(transport).text();
if (!built.includes("chronosjs:0.0.0-development")) throw new Error("sdkVersion placeholder not found");
await Bun.write(transport, built.replace("chronosjs:0.0.0-development", `chronosjs:${version}`));
await $`rm -rf release && mkdir -p release`.cwd(root);
await $`bun pm pack --destination release`.cwd(root);

const tarball = `${root}release/chronosjs-${version}.tgz`;
if (!(await Bun.file(tarball).exists())) {
  console.error(`expected ${tarball}`);
  process.exit(1);
}
console.log(`packed ${tarball}`);
