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
} from './types';
import { EventObservable } from './observable.js';

// CLASSE PRINCIPALE : TypedEventEmitter
export class TypedEventEmitter {

	// STOCKAGE INTERNE
	// Map qui associe chaque type d'événement à ses listeners
	private listeners = new Map<EventNames, Set<ListenerWrapper<any>>>();
	
	// Compteur pour générer des IDs uniques
	private eventCounter = 0;
	
	// Statistiques
	private totalEventsEmitted = 0;
	private startTime = Date.now();


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


	// MÉTHODE PRINCIPALE : EMIT - Émettre un événement
	async emit<T extends EventNames>(
		eventType: T,
		payload: EventPayload<T>,
		options: EmitOptions = {}
	): Promise<EmitResult<T>> {
		const startTime = performance.now();
		
		// Construire l'objet Event complet
		const event: Event<T> = {
		type: eventType,
		payload,
		id: options.id || this.generateEventId(),
		timestamp: new Date(),
		source: options.source,
		correlationId: options.correlationId,
		metadata: options.metadata
		};
		
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
	stream<T extends EventNames>(eventType?: T): any {
		// Import dynamique pour éviter les problèmes circulaires
		const stream = new EventObservable<T>();
		
		if (eventType) {
			// Stream pour un type spécifique
			this.on(eventType, (event) => {
				stream.next(event as any);
			});
		} else {
			// Stream pour tous les événements
			const allEventTypes = this.getActiveEventTypes();
			allEventTypes.forEach(type => {
				this.on(type, (event) => {
					stream.next(event as any);
				});
			});
		}
		return stream;
	}
	
	// Nettoyage complet du système
	async dispose(): Promise<void> {
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


// EXEMPLE D'UTILISATION BASIQUE
/*
// Créer l'émetteur
const emitter = new TypedEventEmitter();

// Enregistrer des listeners
const loginSub = emitter.on('user:login', async (event) => {
  console.log(`User ${event.payload.userId} logged in at ${event.payload.timestamp}`);
  await sendWelcomeEmail(event.payload.userId);
});

const orderSub = emitter.on('order:created', (event) => {
  console.log(`New order: ${event.payload.orderId} for $${event.payload.amount}`);
}, {
  maxCalls: 10,  // Se désactive après 10 appels
  timeout: 5000  // Timeout de 5 secondes
});

// Émettre des événements
await emitter.emit('user:login', {
  userId: 'user123',
  timestamp: new Date(),
  ip: '192.168.1.1'
});

await emitter.emit('order:created', {
  orderId: 'order456',
  userId: 'user123',
  amount: 299.99,
  items: ['laptop', 'mouse']
});

// Métriques
const metrics = emitter.getMetrics();
console.log(`Total events: ${metrics.totalEvents}`);
console.log(`Events per second: ${metrics.eventsPerSecond}`);

// Nettoyage
loginSub.unsubscribe();
orderSub.unsubscribe();
await emitter.dispose();
*/