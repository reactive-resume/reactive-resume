export type LimitResult = { allowed: boolean; remaining: number; reset: number };
export type LimitRule = { window: number; max: number; rolling?: boolean };

/** Native platform coordination replaces Redis for counters and short-lived run state. */
export type CoordinationService = {
	consume(key: string, rule: LimitRule): Promise<LimitResult>;
	get(key: string): Promise<string | null>;
	set(key: string, value: string, ttl: number): Promise<void>;
	publish(key: string, value: string): Promise<void>;
	subscribe(key: string, signal?: AbortSignal): AsyncIterable<string>;
};

let coordination: CoordinationService | undefined;

export function configureCoordination(service: CoordinationService): void {
	coordination = service;
}

export const getCoordination = () => coordination;
