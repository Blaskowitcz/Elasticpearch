export const ANALYZE_ENDPOINT = "http://100.74.29.77:8000/analyze-case" as const;

export interface SelectionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnalyzeResponse {
  readonly status: string;
  readonly source_type: string;
  readonly extracted_text: string;
  readonly [key: string]: unknown;
}

export interface BubbleData {
  readonly key: string;
  readonly value: string;
  readonly category: string;
}
