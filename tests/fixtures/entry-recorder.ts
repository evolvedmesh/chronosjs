import * as Chronos from "../../src/index.ts";

(window as unknown as { Chronos: typeof Chronos }).Chronos = Chronos;
