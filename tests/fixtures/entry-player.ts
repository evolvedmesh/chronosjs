import * as ChronosPlayer from "../../src/player/index.ts";

(window as unknown as { ChronosPlayer: typeof ChronosPlayer }).ChronosPlayer = ChronosPlayer;
