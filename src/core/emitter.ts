import {
	EventRegistry,
	EventNames,
	Event,
	EventListener,
	EventPayload,
	EmitResult,
	EmitError,
	EmitOptions,
	ListenerOptions,
	Subscription,
	EventId,
	createEventId,
	EVENT_CONFIG
} from './types';
import { EventObservable } from './observable';
import { Middleware } from '../middleware/base';

export class TypedEventEmitter {
	// STOCKAGE
	private readonly listeners = new Map<EventNames, Set<ListenerWrapper<any>>>();
	private readonly middlewares: Middleware[] = [];
	private readonly observables = new Map<EventNames, Set<EventObservable<any>>>();
	
	// MÉTRIQUES
	private eventCounter = 0;
	private totalEventsEmitted = 0;
	private readonly startTime = Date.now();

	// CONFIGURATION
	private readonly config = {
		maxListenersPerEvent: EVENT_CONFIG.LIMITS.MAX_LISTENERS_PER_EVENT,
		defaultTimeout: EVENT_CONFIG.TIMEOUTS.DEFAULT,
		enablePerformanceTracking: true
	};

	constructor(options?: EmitterOptions) {
		if (options) {
			Object.assign(this.config, options);
		}
	}

	/**
	 * Enregistre un listener pour un type d'événement spécifique
	 */
	on<T extends EventNames>(
		eventType: T,
		listener: EventListener<T>,
		options: ListenerOptions = {}
	): Subscription {
		this.validateEventType(eventType);
		this.validateListener(listener);

		// Vérifier la limite de listeners
		const existingListeners = this.listeners.get(eventType);
		if (existingListeners && existingListeners.size >= this.config.maxListenersPerEvent) {
			throw new Error(`Maximum listeners (${this.config.maxListenersPerEvent}) exceeded for event ${eventType}`);
		}

		// Créer le wrapper
		const wrapper = new ListenerWrapper(listener, options);

		// Initialiser le Set si nécessaire
		if (!this.listeners.has(eventType)) {
			this.listeners.set(eventType, new Set());
		}

		this.listeners.get(eventType)!.add(wrapper);

		// Retourner subscription
		return new SubscriptionImpl(
			() => this.removeListener(eventType, wrapper),
			eventType,
			wrapper.id
		);
	}

	/**
	 * Écoute un événement une seule fois
	 */
	once<T extends EventNames>(
		eventType: T,
		listener?: EventListener<T>
	): Promise<Event<T>> {
		return new Promise((resolve) => {
			const subscription = this.on(eventType, (event) => {
				subscription.unsubscribe();
				if (listener) listener(event);
				resolve(event);
			}, { once: true });
		});
	}

	/**
	 * Émet un événement avec pipeline de middleware
	 */
	async emit<T extends EventNames>(
		eventType: T,
		payload: EventPayload<T>,
		options: EmitOptions = {}
	): Promise<EmitResult<T>> {
		const startTime = this.config.enablePerformanceTracking ? performance.now() : 0;
		
		// Construire l'événement
		const event = this.createEvent(eventType, payload, options);
		
		try {
			// PHASE 1: Middleware processing
			let processedEvent = event;
			if (!options.skipMiddleware) {
				processedEvent = await this.processMiddlewares(event);
			}

			// PHASE 2: Notification des listeners
			const notificationResult = await this.notifyListeners(processedEvent);

			// PHASE 3: Notification des observables (non-bloquant)
			this.notifyObservables(processedEvent);

			// Métriques
			const duration = this.config.enablePerformanceTracking ? performance.now() - startTime : 0;
			this.totalEventsEmitted++;

			return {
				eventId: event.id,
				type: eventType,
				listenersNotified: notificationResult.successCount,
				errors: notificationResult.errors,
				duration,
				success: notificationResult.errors.length === 0
			};

		} catch (error) {
			const duration = this.config.enablePerformanceTracking ? performance.now() - startTime : 0;
			
			return {
				eventId: event.id,
				type: eventType,
				listenersNotified: 0,
				errors: [{
					listenerId: 'middleware',
					error: error as Error,
					event,
					timestamp: new Date()
				}],
				duration,
				success: false
			};
		}
	}

	/**
	 * Crée un stream observable pour un type d'événement
	 */
	stream<T extends EventNames>(eventType?: T): EventObservable<T> {
		const observable = new EventObservable<T>();
		
		if (eventType) {
			// Stream spécifique à un type
			if (!this.observables.has(eventType)) {
				this.observables.set(eventType, new Set());
			}
			this.observables.get(eventType)!.add(observable);
		} else {
			// Stream global - ajouter à tous les types
			for (const type of this.getActiveEventTypes()) {
				if (!this.observables.has(type)) {
					this.observables.set(type, new Set());
				}
				this.observables.get(type)!.add(observable);
			}
		}

		return observable;
	}

	// MIDDLEWARE MANAGEMENT
	use(middleware: Middleware): void {
		this.middlewares.push(middleware);
	}

	removeMiddleware(nameOrInstance: string | Middleware): boolean {
		const index = typeof nameOrInstance === 'string'
			? this.middlewares.findIndex(m => m.name === nameOrInstance)
			: this.middlewares.indexOf(nameOrInstance);
		
		if (index > -1) {
			this.middlewares.splice(index, 1);
			return true;
		}
		return false;
	}

	// MÉTHODES UTILITAIRES
	listenerCount<T extends EventNames>(eventType: T): number {
		return this.listeners.get(eventType)?.size ?? 0;
	}

	getActiveEventTypes(): EventNames[] {
		return Array.from(this.listeners.keys());
	}

	removeAllListeners<T extends EventNames>(eventType?: T): void {
		if (eventType) {
			this.listeners.delete(eventType);
			this.observables.delete(eventType);
		} else {
			this.listeners.clear();
			this.observables.clear();
		}
	}

	/**
	 * Métriques de performance
	 */
	getMetrics(): EventEmitterMetrics {
		const activeListeners = new Map<EventNames, number>();
		
		for (const [eventType, listenersSet] of this.listeners) {
			activeListeners.set(eventType, listenersSet.size);
		}
		
		const uptime = Date.now() - this.startTime;
		const eventsPerSecond = this.totalEventsEmitted / (uptime / 1000);
		
		return {
			totalEvents: this.totalEventsEmitted,
			activeListeners,
			activeObservables: this.countObservables(),
			uptime,
			eventsPerSecond: Math.round(eventsPerSecond * 100) / 100,
			memoryUsage: this.estimateMemoryUsage()
		};
	}

	/**
	 * Nettoyage complet
	 */
	async dispose(): Promise<void> {
		// Nettoyer les middleware
		await Promise.allSettled(
			this.middlewares.map(async m => {
				if ('dispose' in m && typeof m.dispose === 'function') {
					await m.dispose();
				}
			})
		);

		// Nettoyer les observables
		for (const observableSet of this.observables.values()) {
			observableSet.forEach(obs => obs.complete());
		}

		// Nettoyer les listeners
		for (const listenerSet of this.listeners.values()) {
			listenerSet.forEach(wrapper => wrapper.dispose());
		}

		this.middlewares.length = 0;
		this.listeners.clear();
		this.observables.clear();
		this.eventCounter = 0;
		this.totalEventsEmitted = 0;
	}

	// MÉTHODES PRIVÉES
	private createEvent<T extends EventNames>(
		eventType: T,
		payload: EventPayload<T>,
		options: EmitOptions
	): Event<T> {
		return {
			type: eventType,
			payload,
			id: options.id || this.generateEventId(),
			timestamp: new Date(),
			source: options.source,
			correlationId: options.correlationId,
			metadata: options.metadata
		};
	}

	private generateEventId(): EventId {
		this.eventCounter++;
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 8);
		return `evt_${timestamp}_${this.eventCounter}_${random}`;
	}

	private async processMiddlewares(event: Event<any>): Promise<Event<any>> {
		let processedEvent = event;
		
		for (const middleware of this.middlewares) {
			if (middleware.process) {
				try {
					processedEvent = await middleware.process(processedEvent);
				} catch (error) {
					// Appeler onError si disponible
					if (middleware.onError) {
						await middleware.onError(error as Error);
					}
					throw error;
				}
			}
		}
		
		return processedEvent;
	}

	private async notifyListeners<T extends EventNames>(
		event: Event<T>
	): Promise<NotificationResult> {
		const listenersSet = this.listeners.get(event.type);
		if (!listenersSet || listenersSet.size === 0) {
			return { successCount: 0, errors: [] };
		}

		const listeners = Array.from(listenersSet);
		const errors: EmitError[] = [];
		let successCount = 0;

		// Trier par priorité
		const sortedListeners = listeners.sort((a, b) => b.priority - a.priority);
		
		// Exécution parallèle optimisée
		const results = await Promise.allSettled(
			sortedListeners.map(wrapper => wrapper.execute(event))
		);

		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				successCount++;
			} else {
				errors.push({
					listenerId: sortedListeners[index].id,
					error: result.reason,
					event,
					timestamp: new Date()
				});
			}
		});

		return { successCount, errors };
	}

	private notifyObservables<T extends EventNames>(event: Event<T>): void {
		const observablesSet = this.observables.get(event.type);
		if (observablesSet) {
			// Non-bloquant
			setImmediate(() => {
				observablesSet.forEach(observable => {
					try {
						observable.next(event);
					} catch (error) {
						console.error('Observable notification failed:', error);
					}
				});
			});
		}
	}

	private removeListener<T extends EventNames>(
		eventType: T, 
		wrapper: ListenerWrapper<T>
	): void {
		const listenersSet = this.listeners.get(eventType);
		if (listenersSet) {
			listenersSet.delete(wrapper);
			if (listenersSet.size === 0) {
				this.listeners.delete(eventType);
			}
		}
		wrapper.dispose();
	}

	private validateEventType(eventType: EventNames): void {
		if (!eventType || typeof eventType !== 'string') {
			throw new TypeError('Event type must be a non-empty string');
		}
	}

	private validateListener(listener: EventListener<any>): void {
		if (typeof listener !== 'function') {
			throw new TypeError('Listener must be a function');
		}
	}

	private countObservables(): Map<EventNames, number> {
		const counts = new Map<EventNames, number>();
		for (const [eventType, observableSet] of this.observables) {
			counts.set(eventType, observableSet.size);
		}
		return counts;
	}

	private estimateMemoryUsage(): number {
		let totalListeners = 0;
		let totalObservables = 0;
		
		for (const listenersSet of this.listeners.values()) {
			totalListeners += listenersSet.size;
		}
		
		for (const observableSet of this.observables.values()) {
			totalObservables += observableSet.size;
		}
		
		// Estimation: ~1KB par listener, ~2KB par observable
		return (totalListeners * 1024) + (totalObservables * 2048);
	}
}

// CLASSES HELPER
class ListenerWrapper<T extends EventNames> {
	public readonly id: string;
	public readonly priority: number;
	private callCount = 0;
	private isDisposed = false;
	
	constructor(
		private readonly listener: EventListener<T>,
		private readonly options: ListenerOptions
	) {
		this.id = `listener_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
		this.priority = options.priority || EVENT_CONFIG.PRIORITIES.NORMAL;
	}
	
	async execute(event: Event<T>): Promise<void> {
		if (this.isDisposed) return;
		
		// Vérifications
		if (this.options.maxCalls && this.callCount >= this.options.maxCalls) {
			this.dispose();
			return;
		}
		
		if (this.options.condition && !this.options.condition(event)) {
			return;
		}
		
		this.callCount++;
		
		// Exécution avec timeout si spécifié
		if (this.options.timeout) {
			await this.executeWithTimeout(event, this.options.timeout);
		} else {
			await this.listener(event);
		}
		
		// Auto-dispose si once
		if (this.options.once) {
			this.dispose();
		}
	}
	
	private async executeWithTimeout(event: Event<T>, timeoutMs: number): Promise<void> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
		
		try {
			await Promise.race([
				this.listener(event),
				new Promise<never>((_, reject) => {
					controller.signal.addEventListener('abort', () => {
						reject(new Error(`Listener timeout after ${timeoutMs}ms`));
					});
				})
			]);
		} finally {
			clearTimeout(timeoutId);
		}
	}
	
	dispose(): void {
		this.isDisposed = true;
	}
}

class SubscriptionImpl implements Subscription {
	private _closed = false;
	
	constructor(
		private readonly unsubscribeFn: () => void,
		public readonly eventType: EventNames,
		public readonly listenerId: string
	) {}
	
	unsubscribe(): void {
		if (!this._closed) {
			this.unsubscribeFn();
			this._closed = true;
		}
	}
	
	get closed(): boolean {
		return this._closed;
	}
}

// INTERFACES
export interface EmitterOptions {
	maxListenersPerEvent?: number;
	defaultTimeout?: number;
	enablePerformanceTracking?: boolean;
}

export interface EventEmitterMetrics {
	totalEvents: number;
	activeListeners: Map<EventNames, number>;
	activeObservables: Map<EventNames, number>;
	uptime: number;
	eventsPerSecond: number;
	memoryUsage: number;
}

interface NotificationResult {
	successCount: number;
	errors: EmitError[];
}