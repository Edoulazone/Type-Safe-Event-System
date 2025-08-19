import { Event, EventNames, EventRegistry } from '../core/types';

// INTERFACE DE BASE
export interface Middleware {
	name?: string;
	process?(event: Event<any>): Promise<Event<any>> | Event<any>;
	onError?(error: Error): Promise<void> | void;
}

// LOGGING
export class LoggingMiddleware implements Middleware {
	name = 'logging';
	
	constructor(
		private logger: Logger = console,
		private options: LoggingOptions = {}
	) {
		this.options = {
			includePayload: true,
			logLevel: 'info',
			...options
		};
	}

	process(event: Event<any>): Event<any> {
		const message = this.formatEventMessage(event);
		this.log('info', message);
		return event;
	}

	onError(error: Error): void {
		this.log('error', `Middleware error: ${error.message}`);
	}

	private formatEventMessage(event: Event<any>): string {
		const timestamp = new Date().toISOString();
		const baseMessage = `[${timestamp}] ${event.type} (${event.id})`;
		
		if (this.options.includePayload) {
			const payload = this.options.sanitizePayload 
				? this.options.sanitizePayload(event.payload)
				: event.payload;
			return `${baseMessage} | ${JSON.stringify(payload)}`;
		}
		
		return baseMessage;
	}

	private log(level: LogLevel, message: string): void {
		if (this.shouldLog(level)) {
			switch (level) {
				case 'error':
					this.logger.error(message);
					break;
				case 'warn':
					this.logger.warn(message);
					break;
				case 'info':
					this.logger.info(message);
					break;
				case 'debug':
					this.logger.debug?.(message);
					break;
			}
		}
	}

	private shouldLog(level: LogLevel): boolean {
		const levels: Record<LogLevel, number> = {
			error: 0, warn: 1, info: 2, debug: 3
		};
		const currentLevel = levels[this.options.logLevel || 'info'];
		const messageLevel = levels[level];
		return messageLevel <= currentLevel;
	}
}

// VALIDATION
export class ValidationMiddleware implements Middleware {
	name = 'validation';
	private validators = new Map<EventNames, EventValidator<any>>();

	addValidator<T extends EventNames>(
		eventType: T,
		validator: EventValidator<EventRegistry[T]>
	): void {
		this.validators.set(eventType, validator);
	}

	process(event: Event<any>): Event<any> {
		const validator = this.validators.get(event.type);
		
		if (validator) {
			const result = validator.validate(event.payload);
			
			if (!result.isValid) {
				throw new ValidationError(
					event.type,
					result.errors,
					event
				);
			}
		}
		
		return event;
	}

	hasValidator(eventType: EventNames): boolean {
		return this.validators.has(eventType);
	}

	removeValidator(eventType: EventNames): void {
		this.validators.delete(eventType);
	}
}

// RATE LIMITING
export class RateLimitMiddleware implements Middleware {
	name = 'rate-limit';
	private eventCounts = new Map<string, EventCountInfo>();
	private cleanupInterval: ReturnType<typeof setInterval>;

	constructor(private config: RateLimitConfig) {
		// Nettoyer les compteurs expirés
		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, 60000);
	}

	process(event: Event<any>): Event<any> {
		const key = this.getKey(event);
		const now = Date.now();
		const countInfo = this.eventCounts.get(key) || {
			count: 0,
			windowStart: now,
			lastEvent: 0
		};

		// Vérifier si on est dans une nouvelle fenêtre de temps
		if (now - countInfo.windowStart >= this.config.windowMs) {
			countInfo.count = 0;
			countInfo.windowStart = now;
		}

		// Vérifier la limite
		if (countInfo.count >= this.config.maxEvents) {
			throw new RateLimitError(
				event.type,
				this.config.maxEvents,
				this.config.windowMs,
				key
			);
		}

		// Vérifier le délai minimum entre événements (si configuré)
		if (this.config.minInterval && 
			countInfo.lastEvent && 
			now - countInfo.lastEvent < this.config.minInterval) {
			throw new RateLimitError(
				event.type,
				this.config.maxEvents,
				this.config.windowMs,
				key,
				'Minimum interval not respected'
			);
		}

		// Incrémenter le compteur
		countInfo.count++;
		countInfo.lastEvent = now;
		this.eventCounts.set(key, countInfo);

		return event;
	}

	private getKey(event: Event<any>): string {
		if (this.config.keyExtractor) {
			return this.config.keyExtractor(event);
		}
		
		// Clé par défaut : type d'événement
		return event.type;
	}

	private cleanup(): void {
		const now = Date.now();
		const expiredKeys: string[] = [];

		for (const [key, countInfo] of this.eventCounts) {
			if (now - countInfo.windowStart >= this.config.windowMs * 2) {
				expiredKeys.push(key);
			}
		}

		expiredKeys.forEach(key => this.eventCounts.delete(key));
	}

	getStats(): RateLimitStats {
		const now = Date.now();
		const activeKeys = new Map<string, number>();

		for (const [key, countInfo] of this.eventCounts) {
			if (now - countInfo.windowStart < this.config.windowMs) {
				activeKeys.set(key, countInfo.count);
			}
		}

		return {
			activeKeys,
			totalKeys: this.eventCounts.size,
			windowMs: this.config.windowMs,
			maxEvents: this.config.maxEvents
		};
	}

	reset(): void {
		this.eventCounts.clear();
	}

	dispose(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		this.eventCounts.clear();
	}
}

// PERFORMANCE MONITORING
export class PerformanceMiddleware implements Middleware {
	name = 'performance';
	private metrics = new Map<EventNames, PerformanceMetric>();

	process(event: Event<any>): Event<any> {
		const startTime = performance.now();
		
		// Ajouter un hook de fin de traitement
		setImmediate(() => {
			const duration = performance.now() - startTime;
			this.recordMetric(event.type, duration);
		});

		return event;
	}

	private recordMetric(eventType: EventNames, duration: number): void {
		const current = this.metrics.get(eventType) || {
			count: 0,
			totalDuration: 0,
			minDuration: Infinity,
			maxDuration: 0,
			avgDuration: 0
		};

		current.count++;
		current.totalDuration += duration;
		current.minDuration = Math.min(current.minDuration, duration);
		current.maxDuration = Math.max(current.maxDuration, duration);
		current.avgDuration = current.totalDuration / current.count;

		this.metrics.set(eventType, current);
	}

	getMetrics(): Map<EventNames, PerformanceMetric> {
		return new Map(this.metrics);
	}

	getMetricsForEvent(eventType: EventNames): PerformanceMetric | undefined {
		return this.metrics.get(eventType);
	}

	reset(): void {
		this.metrics.clear();
	}
}

// INTERFACES ET TYPES
export interface Logger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	debug?(message: string): void;
}

export interface LoggingOptions {
	includePayload?: boolean;
	logLevel?: LogLevel;
	sanitizePayload?: (payload: any) => any;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface EventValidator<T> {
	validate(payload: T): ValidationResult;
}

export interface ValidationResult {
	isValid: boolean;
	errors: string[];
}

export interface RateLimitConfig {
	maxEvents: number;
	windowMs: number;
	keyExtractor?: (event: Event<any>) => string;
	minInterval?: number;
}

interface EventCountInfo {
	count: number;
	windowStart: number;
	lastEvent: number;
}

export interface RateLimitStats {
	activeKeys: Map<string, number>;
	totalKeys: number;
	windowMs: number;
	maxEvents: number;
}

export interface PerformanceMetric {
	count: number;
	totalDuration: number;
	minDuration: number;
	maxDuration: number;
	avgDuration: number;
}

// ERREURS PERSONNALISÉES
export class ValidationError extends Error {
	constructor(
		public eventType: EventNames,
		public validationErrors: string[],
		public event: Event<any>
	) {
		super(`Validation failed for event ${eventType}: ${validationErrors.join(', ')}`);
		this.name = 'ValidationError';
	}
}

export class RateLimitError extends Error {
	constructor(
		public eventType: EventNames,
		public limit: number,
		public windowMs: number,
		public key: string,
		public reason: string = 'Rate limit exceeded'
	) {
		super(`${reason} for ${eventType} (key: ${key}): ${limit} events per ${windowMs}ms`);
		this.name = 'RateLimitError';
	}
}

// VALIDATEURS PRÊTS À L'EMPLOI
export const userLoginValidator: EventValidator<EventRegistry['user:login']> = {
	validate: (payload) => {
		const errors: string[] = [];

		if (!payload.userId || typeof payload.userId !== 'string') {
			errors.push('userId is required and must be a string');
		} else if (payload.userId.length < 3) {
			errors.push('userId must be at least 3 characters long');
		}

		if (!payload.timestamp || !(payload.timestamp instanceof Date)) {
			errors.push('timestamp is required and must be a Date');
		}

		if (payload.ip && typeof payload.ip !== 'string') {
			errors.push('ip must be a string if provided');
		}

		return {
			isValid: errors.length === 0,
			errors
		};
	}
};

export const orderCreatedValidator: EventValidator<EventRegistry['order:created']> = {
	validate: (payload) => {
		const errors: string[] = [];

		if (!payload.orderId || typeof payload.orderId !== 'string') {
			errors.push('orderId is required and must be a string');
		}

		if (!payload.userId || typeof payload.userId !== 'string') {
			errors.push('userId is required and must be a string');
		}

		if (typeof payload.amount !== 'number' || payload.amount <= 0) {
			errors.push('amount must be a positive number');
		}

		if (!Array.isArray(payload.items) || payload.items.length === 0) {
			errors.push('items must be a non-empty array');
		}

		return {
			isValid: errors.length === 0,
			errors
		};
	}
};