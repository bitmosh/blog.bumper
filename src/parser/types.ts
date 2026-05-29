export interface ParsedReport {
  version: string;
  date: string;
  time: string;
  title: string;
  slug: string;
  description: string;
  module: string;
  highlights: string[];
  learnings: string[];
  commit: string;
  // observability only — never written to the post
  tests?: string;
  branch?: string;
}

export interface ParseInput {
  content: string;
  timestamp: string;  // ISO 8601 from the Discord message object
  messageId: string;
  configModule: string;  // fallback when no Project: line
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}
