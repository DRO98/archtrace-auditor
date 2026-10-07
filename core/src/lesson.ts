export interface CodeRef {
  filePath: string;
  startLine: number;
  endLine: number;
}

/** What the model must emit (validated, never trusted). */
export interface LessonStepModelOutput {
  stepNumber: number;
  title: string;
  summary: string;
  symbol: string;
  codeRef: CodeRef;
  connectionReason: string;
}

export type LessonCoverage = "full" | "partial" | "not_found";

export interface LessonModelOutput {
  title: string;
  overview: string;
  coverage: LessonCoverage;
  caveats: string[];
  steps: LessonStepModelOutput[];
}

/** What the UI consumes (after validation and snapping). */
export interface LessonStep {
  id: string;
  stepNumber: number;
  title: string;
  summary: string;
  codeRef: CodeRef;
  connectionReason: string;
  symbolId: string;
  repaired: boolean;
}

export interface Lesson {
  id: string;
  goal: string;
  createdAt: string;
  mapRevision: string;
  provider: string;
  model: string;
  title: string;
  overview: string;
  coverage: LessonCoverage;
  caveats: string[];
  steps: LessonStep[];
}
