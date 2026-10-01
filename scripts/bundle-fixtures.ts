// Bundles the recorder and the player as browser scripts for the e2e tests.
const root = new URL("..", import.meta.url).pathname;

for (const [entry, out] of [
  ["tests/fixtures/entry-recorder.ts", "recorder.js"],
  ["tests/fixtures/entry-player.ts", "player.js"],
]) {
  const result = await Bun.build({
    entrypoints: [root + entry],
    format: "iife",
    target: "browser",
    minify: out === "recorder.js",
  });
  if (!result.success) {
    console.error(result.logs);
    process.exit(1);
  }
  const code = await result.outputs[0].text();
  await Bun.write(`${root}tests/fixtures/${out}`, code);
  console.log(
    `${out}: ${(code.length / 1024).toFixed(1)} KB (${(Bun.gzipSync(code).length / 1024).toFixed(1)} KB gzipped)`,
  );
}
