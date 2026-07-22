// ABOUTME: Zero-runtime shared search/provider types for the extension entry.
// ABOUTME: Keeps type-only edges from pulling provider or extract implementations.

export type SearchProvider = "auto" | "openai" | "brave" | "parallel" | "tavily" | "perplexity" | "gemini" | "exa";

export type ResolvedSearchProvider = Exclude<SearchProvider, "auto">;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
  /** Optional full-page extracts when a provider returns inline content. */
  inlineContent?: Array<{
    url: string;
    title: string;
    content: string;
    error: string | null;
    thumbnail?: { data: string; mimeType: string };
    frames?: Array<{ data: string; mimeType: string; timestamp: string }>;
    duration?: number;
  }>;
}

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  signal?: AbortSignal;
}
