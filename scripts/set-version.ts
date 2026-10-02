// Writes a release version into package.json: `bun scripts/set-version.ts <semver>`. semantic-release runs it
// (.releaserc.json) before committing `ci(release): X.Y.Z`; the build stamps that version into the telemetry tag.
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: bun scripts/set-version.ts <semver>");
  process.exit(1);
}
const file = new URL("../package.json", import.meta.url).pathname;
const manifest = await Bun.file(file).json();
manifest.version = version;
await Bun.write(file, `${JSON.stringify(manifest, null, 2)}\n`);
