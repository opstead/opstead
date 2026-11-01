export interface Finding {
  level: "error" | "warn" | "ok";
  where: string;
  message: string;
}

export interface Report {
  url: string;
  app?: string;
  /** 0 none, 1 health, 2 shape, 3 knowledge, 4 hands. */
  level: number;
  findings: Finding[];
  metrics?: boolean;
}

export declare const KINDS: string[];
export declare const LEVELS: string[];
export declare const RISKS: string[];
export declare const LEVEL_NAMES: string[];
export declare const NEXT: string[];

export declare function validateHealth(body: unknown): { findings: Finding[]; ids: Set<string> };
export declare function validateManifest(
  body: unknown,
  healthIds: Set<string>,
): { findings: Finding[]; has: { components: boolean; knowledge: boolean; actions: boolean }; errorsAt: { 2: boolean; 3: boolean; 4: boolean } };
export declare function validateRuns(body: unknown): string | null;
export declare function checkApp(url: string, opts?: { token?: string; fetch?: typeof fetch; timeoutMs?: number }): Promise<Report>;
