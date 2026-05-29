export type { ParsedReport, ParseInput } from "./types.js";
export { ParseError } from "./types.js";

import { isV1Format, parseV1 } from "./v1.js";
import { ParseError } from "./types.js";
import type { ParseInput, ParsedReport } from "./types.js";

export function parseReport(input: ParseInput): ParsedReport {
  if (isV1Format(input.content)) {
    return parseV1(input);
  }
  throw new ParseError(
    "Unknown report format — header does not match any known PASS COMPLETE pattern",
    "header",
  );
}
