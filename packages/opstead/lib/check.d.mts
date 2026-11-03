export interface Finding {
  level: "error" | "warn" | "ok";
  where: string;
  message: string;
}

/** What runs now, as /ops/health says it; each field only when present and well-formed. */
export interface Running {
  version?: string;
  commit?: string;
  deployed_at?: string;
}

/** The manifest's `source`: where the code lives. */
export interface Source {
  /** The repository's https address, without query or trailing slash. */
  repo: string;
  /** The app's directory in a monorepo. */
  path?: string;
}

export interface Report {
  url: string;
  app?: string;
  /** 0 none, 1 health, 2 shape, 3 knowledge, 4 hands. */
  level: number;
  findings: Finding[];
  metrics?: boolean;
  /** What to do to reach the level above, naming what is missing when the checker knows it. */
  next?: string;
  /** How many components declare a well-formed `tech`; absent when no manifest was read. */
  tech?: number;
  /** What runs now, from /ops/health (optional fields, no level). */
  running?: Running;
  /** Where the code lives, when the manifest declares a usable `source`. */
  source?: Source;
}

export declare const KINDS: string[];
export declare const LEVELS: string[];
export declare const RISKS: string[];
export declare const PROVIDER_KINDS: string[];
export declare const LEVEL_NAMES: string[];
export declare const NEXT: string[];

export declare function validateHealth(body: unknown, opts?: { now?: number }): { findings: Finding[]; ids: Set<string>; running: Running };
export declare function validateSource(source: unknown, out: Finding[]): Source | undefined;
export declare function validateManifest(
  body: unknown,
  healthIds: Set<string>,
): { findings: Finding[]; has: { components: boolean; hosting: boolean; knowledge: boolean; actions: boolean; tech: number }; errorsAt: { 2: boolean; 3: boolean; 4: boolean }; source?: Source };
export declare function validateRuns(body: unknown): string | null;
export declare function checkApp(url: string, opts?: { token?: string; fetch?: typeof fetch; timeoutMs?: number }): Promise<Report>;
