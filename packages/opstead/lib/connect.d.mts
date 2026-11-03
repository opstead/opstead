export declare const DEPLOY_NAMES: string[];
export declare function setEnv(text: string, values: Record<string, string>): string;
export declare function getEnv(text: string, name: string): string | undefined;
export declare function connect(
  enrolUrl: string,
  opts: { env: string; appUrl?: string; fetch?: typeof fetch },
): Promise<{ name: string; app_url: string | null; written: string[]; /** whether the operator handed out a deploy token */ deploy: boolean }>;
export type Runner = (cmd: string, args: string[], input: string) => { status: number | null; stderr: string; error?: Error };
export declare function setCiSecrets(opts: { env: string; ci: string; repo?: string; run?: Runner }): string[];
