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
	Subscription
} from './types.js';
import { EventObservable } from './observable.js';
import { Middleware } from '../middleware/base.js';


// CLASSE PRINCIPALE : TypedEventEmitter
export class TypedEventEmitter {

	// STOCKAGE INTERNE
	// Map qui associe chaque type d'événement à ses listeners
	private listeners = new Map<EventNames, Set<ListenerWrapper<any>>>();
	
	// Pipeline de middleware
	private middlewares: Middleware[] = [];
	
	// Compteur pour générer des IDs uniques
	private eventCounter = 0;
	
	// Statistiques
	private totalEventsEmitted = 0;
	private startTime = Date.now();

	// MÉTHODES MIDDLEWARE - Gestion du pipeline
	
	// Ajoute un middleware au pipeline
	// Les middleware sont exécutés dans l'ordre d'ajout
	use(middleware: Middleware): void {
		this.middlewares.push(middleware);
	}

	// Retire un middleware du pipeline
	removeMiddleware(middleware: Middleware): boolean {
		const index = this.middlewares.indexOf(middleware);
		if (index > -1) {
			this.middlewares.splice(index, 1);
			return true;
		}
		return false;
	}

	// Retire un middleware par son nom
	removeMiddlewareByName(name: string): boolean {
		const index = this.middlewares.findIndex(m => m.name === name);
		if (index > -1) {
			this.middlewares.splice(index, 1);
			return true;
		}
		return false;
	}

	// Liste tous les middleware actifs
	getMiddlewares(): Middleware[] {
		return [...this.middlewares];
	}

	// MÉTHODES PRIVÉES : Exécution des middleware
	
	// Exécute les middleware avant émission
	private async runBeforeMiddlewares(event: Event<any>): Promise<Event<any>> {
		let processedEvent = event;
		
		for (const middleware of this.middlewares) {
			if (middleware.before) {
				try {
					processedEvent = await middleware.before(processedEvent);
				} catch (error) {
					// Exécuter les handlers d'erreur des middleware
					await this.runErrorMiddlewares(error as Error, processedEvent);
					throw error; // Re-lancer l'erreur pour arrêter l'émission
				}
			}
		}
		
		return processedEvent;
	}

	// Exécute les middleware après émission
	private async runAfterMiddlewares(event: Event<any>): Promise<void> {
		for (const middleware of this.middlewares) {
			if (middleware.after) {
				try {
					await middleware.after(event);
				} catch (error) {
					// Les erreurs dans les middleware "after" ne doivent pas arrêter l'émission
					await this.runErrorMiddlewares(error as Error, event);
				}
			}
		}
	}

	// Exécute les handlers d'erreur des middleware
	private async runErrorMiddlewares(error: Error, event: Event<any>): Promise<void> {
		for (const middleware of this.middlewares) {
			if (middleware.onError) {
				try {
					await middleware.onError(error, event);
				} catch (middlewareError) {
					// Si un middleware d'erreur plante, juste logger
					console.error('Middleware error handler failed:', middlewareError);
				}
			}
		}
	}

	// MÉTHODE PRINCIPALE : ON - Enregistrer un listener
	on<T extends EventNames>(
		eventType: T,
		listener: EventListener<T>,
		options: ListenerOptions = {}
	): Subscription {
		// Créer un wrapper autour du listener pour ajouter des fonctionnalités
		const wrapper = new ListenerWrapper(listener, options);

		// Si c'est le premier listener pour ce type d'événement, créer le Set
		if (!this.listeners.has(eventType)) {
			this.listeners.set(eventType, new Set());
		}

		// Ajouter le listener à la liste
		this.listeners.get(eventType)!.add(wrapper);

		// Retourner un objet Subscription pour se désabonner
		return {
			unsubscribe: () => {
				const listenersSet = this.listeners.get(eventType);
				if (listenersSet) {
					listenersSet.delete(wrapper);
					
					// Si plus de listeners pour ce type, supprimer la clé
					if (listenersSet.size === 0) {
						this.listeners.delete(eventType);
					}
				}
			},
			closed: false // TODO: implémenter la logique de fermeture
		};
	}

	// MÉTHODE : ONCE - Écouter une seule fois
	once<T extends EventNames>(
		eventType: T,
		listener?: EventListener<T>
	): Promise<Event<T>> {
		return new Promise((resolve) => {
			const subscription = this.on(eventType, (event) => {
				// Se désabonner immédiatement après le premier événement
				subscription.unsubscribe();
				
				// Appeler le listener si fourni
				if (listener) {
					listener(event);
				}
				
				// Résoudre la Promise avec l'événement
				resolve(event);
			});
		});
	}

	// MÉTHODE PRINCIPALE : EMIT - Émettre un événement avec middleware
	async emit<T extends EventNames>(
		eventType: T,
		payload: EventPayload<T>,
		options: EmitOptions = {}
	): Promise<EmitResult<T>> {
		const startTime = performance.now();
		
		// Construire l'objet Event complet
		let event: Event<T> = {
			type: eventType,
			payload,
			id: options.id || this.generateEventId(),
			timestamp: new Date(),
			source: options.source,
			correlationId: options.correlationId,
			metadata: options.metadata
		};
		
		try {
			// PHASE 1 : Exécuter les middleware AVANT
			event = await this.runBeforeMiddlewares(event);
			
			// Récupérer tous les listeners pour ce type d'événement
			const listenersSet = this.listeners.get(eventType) || new Set();
			const listenersArray = Array.from(listenersSet);
			
			// Statistiques pour le résultat
			const errors: EmitError[] = [];
			let successfulNotifications = 0;
			
			// Notifier tous les listeners (en parallèle pour la performance)
			await Promise.allSettled(
				listenersArray.map(async (wrapper) => {
					try {
						await wrapper.execute(event);
						successfulNotifications++;
					} catch (error) {
						// Capturer l'erreur mais continuer avec les autres listeners
						errors.push({
							listener: wrapper.id,
							error: error as Error,
							event
						});
					}
				})
			);
			
			// PHASE 2 : Exécuter les middleware APRÈS
			await this.runAfterMiddlewares(event);
			
			// Mettre à jour les statistiques
			this.totalEventsEmitted++;
			
			const duration = performance.now() - startTime;
			
			// Retourner le résultat détaillé
			return {
				eventId: event.id,
				type: eventType,
				listenersNotified: successfulNotifications,
				errors,
				duration
			};
			
		} catch (error) {
			// Si les middleware ont échoué, retourner un résultat d'erreur
			const duration = performance.now() - startTime;
			
			return {
				eventId: event.id,
				type: eventType,
				listenersNotified: 0,
				errors: [{
					listener: 'middleware',
					error: error as Error,
					event
				}],
				duration
			};
		}
	}

	// MÉTHODES UTILITAIRES
	private generateEventId(): string {
		this.eventCounter++;
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 8);
		return `evt_${timestamp}_${this.eventCounter}_${random}`;
	}
	
	// Compte le nombre de listeners pour un type d'événement
	listenerCount<T extends EventNames>(eventType: T): number {
		const listenersSet = this.listeners.get(eventType);
		return listenersSet ? listenersSet.size : 0;
	}
	
	// Liste tous les types d'événements qui ont des listeners
	getActiveEventTypes(): EventNames[] {
		return Array.from(this.listeners.keys());
	}
	
	// Supprime tous les listeners pour un type d'événement
	removeAllListeners<T extends EventNames>(eventType?: T): void {
		if (eventType) {
			this.listeners.delete(eventType);
		} else {
			this.listeners.clear();
		}
	}
	
	// Retourne des métriques basiques du système
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
			uptime,
			eventsPerSecond: Math.round(eventsPerSecond * 100) / 100, // 2 décimales
			memoryUsage: this.estimateMemoryUsage()
		};
	}
	
	// Estimation approximative de l'usage mémoire
	private estimateMemoryUsage(): number {
		let totalListeners = 0;
		for (const listenersSet of this.listeners.values()) {
			totalListeners += listenersSet.size;
		}
		
		// Estimation : ~1KB par listener (très approximatif)
		return totalListeners * 1024;
	}

	// MÉTHODE : STREAM - Créer un observable
	stream<T extends EventNames>(eventType?: T): EventObservable<T> {
		const stream = new EventObservable<T>();
		
		if (eventType) {
			// Stream pour un type spécifique
			this.on(eventType, (event: Event<T>) => {
				stream.next(event);
			});
		} else {
			// Stream pour tous les événements
			const allEventTypes = this.getActiveEventTypes();
			allEventTypes.forEach(type => {
				this.on(type, (event: Event<any>) => {
					stream.next(event);
				});
			});
		}
		
		return stream;
	}
	
	// MÉTHODE : DISPOSE - Nettoyage complet
	async dispose(): Promise<void> {
		// Nettoyer les middleware qui ont une méthode dispose
		for (const middleware of this.middlewares) {
			if ('dispose' in middleware && typeof middleware.dispose === 'function') {
				try {
					await middleware.dispose();
				} catch (error) {
					console.error('Error disposing middleware:', error);
				}
			}
		}
		
		this.middlewares.length = 0;
		this.listeners.clear();
		this.eventCounter = 0;
		this.totalEventsEmitted = 0;
	}
}


// CLASSE HELPER : ListenerWrapper
// Wrapper autour d'un listener pour ajouter des fonctionnalités avancées
class ListenerWrapper<T extends EventNames> {
	public readonly id: string;
	private callCount = 0;
	private isDisposed = false;
	
	constructor(
		private listener: EventListener<T>,
		private options: ListenerOptions
	) {
		// Générer un ID unique pour ce listener
		this.id = `listener_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
	}
	
	// Exécute le listener avec toutes les vérifications et options
	async execute(event: Event<T>): Promise<void> {
		// Vérifier si le listener est encore actif
		if (this.isDisposed) {
			return;
		}
		
		// Vérifier la limite d'appels
		if (this.options.maxCalls && this.callCount >= this.options.maxCalls) {
			this.dispose();
			return;
		}
		
		// Vérifier la condition personnalisée
		if (this.options.condition && !this.options.condition(event)) {
			return;
		}
		
		// Incrémenter le compteur d'appels
		this.callCount++;
		
		try {
			// Exécuter avec timeout si spécifié
			if (this.options.timeout) {
				await this.executeWithTimeout(event, this.options.timeout);
			} else {
				await this.listener(event);
			}
		} catch (error) {
			// Re-lancer l'erreur pour qu'elle soit capturée par emit()
			throw error;
		}
	}
	
	// Exécute le listener avec un timeout
	private async executeWithTimeout(event: Event<T>, timeoutMs: number): Promise<void> {
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				reject(new Error(`Listener timeout after ${timeoutMs}ms`));
			}, timeoutMs);
		});
		
		// Course entre le listener et le timeout
		await Promise.race([
			this.listener(event),
			timeoutPromise
		]);
	}
	
	// Marque le listener comme disposé
	dispose(): void {
		this.isDisposed = true;
	}
	
	// Retourne des infos sur le listener
	getInfo(): ListenerInfo {
		return {
			id: this.id,
			callCount: this.callCount,
			isDisposed: this.isDisposed,
			hasTimeout: !!this.options.timeout,
			hasCondition: !!this.options.condition,
			maxCalls: this.options.maxCalls
		};
	}
}


// INTERFACES ET TYPES ADDITIONNELS
export interface EventEmitterMetrics {
	totalEvents: number;
	activeListeners: Map<EventNames, number>;
	uptime: number; // en millisecondes
	eventsPerSecond: number;
	memoryUsage: number; // estimation en bytes
}

export interface ListenerInfo {
	id: string;
	callCount: number;
	isDisposed: boolean;
	hasTimeout: boolean;
	hasCondition: boolean;
	maxCalls?: number;
}


// EXEMPLE D'UTILISATION AVEC MIDDLEWARE
/*
// Créer l'émetteur
const emitter = new TypedEventEmitter();

// Ajouter des middleware
const logger = new LoggingMiddleware();
const validator = new ValidationMiddleware();
const rateLimiter = new RateLimitMiddleware({
  maxEvents: 10,
  windowMs: 60000
});

emitter.use(logger);
emitter.use(validator);
emitter.use(rateLimiter);

// Enregistrer des listeners (ils bénéficient automatiquement des middleware)
emitter.on('user:login', async (event) => {
  console.log(`User ${event.payload.userId} logged in`);
});

// Émettre des événements (automatiquement protégés par les middleware)
await emitter.emit('user:login', {
  userId: 'user123',
  timestamp: new Date(),
  ip: '192.168.1.1'
});
*/