export declare function setEnv(text: string, values: Record<string, string>): string;
export declare function connect(enrolUrl: string, opts: { env: string; appUrl?: string; fetch?: typeof fetch }): Promise<{ name: string; app_url: string | null; written: string[] }>;
