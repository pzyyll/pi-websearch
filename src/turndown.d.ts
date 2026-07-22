// ABOUTME: Minimal ambient types for turndown (package ships without declarations).
// ABOUTME: Used only for typechecking dynamic HTML→markdown extraction imports.

declare module "turndown" {
  interface TurndownOptions {
    headingStyle?: "setext" | "atx";
    codeBlockStyle?: "indented" | "fenced";
    [key: string]: unknown;
  }

  export default class TurndownService {
    constructor(options?: TurndownOptions);
    turndown(html: string): string;
  }
}
