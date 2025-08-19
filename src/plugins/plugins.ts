import { EventNames, Event } from '../core/types';
import { TypedEventEmitter } from '../core/emitter';

// INTERFACE DE BASE
export interface EventPlugin<TConfig = any> {
	name: string;
	version: string;
	
	// Lifecycle
	initialize(emitter: TypedEventEmitter, config: TConfig): Promise<void> | void;
	destroy?(): Promise<void> | void;
	
	// Event hook optionnel
	onEventEmitted?<T extends EventNames>(event: Event<T>): Promise<void> | void;
}

// REGISTRY DE PLUGINS
export class PluginRegistry {
	private plugins = new Map<string, LoadedPlugin<any>>();
	private emitter: TypedEventEmitter;

	constructor(emitter: TypedEventEmitter) {
		this.emitter = emitter;
	}

	// Enregistre un plugin
	async register<TConfig>(
		plugin: EventPlugin<TConfig>,
		config: TConfig = {} as TConfig
	): Promise<void> {
		if (this.plugins.has(plugin.name)) {
			throw new Error(`Plugin ${plugin.name} already registered`);
		}

		try {
			// Initialiser le plugin
			await plugin.initialize(this.emitter, config);

			// Hook d'événements via middleware
			if (plugin.onEventEmitted) {
				console.log(`🔗 Registering event hook for plugin ${plugin.name}`);
				
				// Utiliser le système de middleware pour les hooks
				this.emitter.use({
					name: `plugin-${plugin.name}`,
					process: (event) => {
						// Appeler le hook du plugin de manière non-bloquante
						setImmediate(() => {
							if (plugin.onEventEmitted) {
								try {
									plugin.onEventEmitted(event);
								} catch (error) {
									console.error(`Plugin ${plugin.name} hook error:`, error);
								}
							}
						});
						return event; // Passer l'événement sans modification
					}
				});
			}

			// Stocker
			this.plugins.set(plugin.name, {
				plugin,
				config,
				loadedAt: new Date()
			});

			console.log(`✅ Plugin ${plugin.name} loaded successfully`);

		} catch (error) {
			throw new Error(`Failed to load plugin ${plugin.name}: ${(error as Error).message}`);
		}
	}

	// Désenregistre un plugin
	async unregister(name: string): Promise<void> {
		const loaded = this.plugins.get(name);
		if (!loaded) {
			throw new Error(`Plugin ${name} not found`);
		}

		// Supprimer le middleware associé
		this.emitter.removeMiddleware(`plugin-${name}`);

		if (loaded.plugin.destroy) {
			await loaded.plugin.destroy();
		}

		this.plugins.delete(name);
		console.log(`🗑️ Plugin ${name} unregistered`);
	}

	// Récupère un plugin
	getPlugin<T extends EventPlugin>(name: string): T | undefined {
		return this.plugins.get(name)?.plugin as T;
	}

	// Liste les plugins
	getPlugins(): string[] {
		return Array.from(this.plugins.keys());
	}

	// Nettoie tout
	async dispose(): Promise<void> {
		for (const name of this.plugins.keys()) {
			try {
				await this.unregister(name);
			} catch (error) {
				console.error(`Error disposing plugin ${name}:`, error);
			}
		}
	}
}

// PLUGIN DE PERSISTANCE
export class PersistencePlugin implements EventPlugin<PersistenceConfig> {
	name = 'persistence';
	version = '1.0.0';
	
	private events: Event<any>[] = [];
	private maxEvents: number = 1000;

	async initialize(emitter: TypedEventEmitter, config: PersistenceConfig): Promise<void> {
		this.maxEvents = config.maxEvents || 1000;
		console.log(`💾 Persistence plugin initialized (max: ${this.maxEvents} events)`);
	}

	// Hook appelé automatiquement via le registry
	onEventEmitted(event: Event<any>): void {
		console.log(`💾 Persistence: Storing event ${event.type} (${event.id})`);
		this.events.push(event);
		
		// Limiter la taille
		if (this.events.length > this.maxEvents) {
			this.events.shift();
		}
	}

	// Récupère l'historique
	getHistory<T extends EventNames>(eventType?: T, limit?: number): Event<T>[] {
		let filtered = this.events;

		if (eventType) {
			filtered = filtered.filter(e => e.type === eventType);
		}

		if (limit) {
			filtered = filtered.slice(-limit);
		}

		return filtered as Event<T>[];
	}

	// Rejoue des événements
	async replay<T extends EventNames>(
		emitter: TypedEventEmitter,
		eventType?: T,
		limit: number = 5
	): Promise<number> {
		const toReplay = this.getHistory(eventType, limit);
		
		console.log(`🔄 Replaying ${toReplay.length} events...`);
		
		for (const event of toReplay) {
			await emitter.emit(event.type, event.payload, {
				source: 'replay',
				metadata: { replayed: true, originalId: event.id }
			});
		}

		return toReplay.length;
	}

	// Stats
	getStats(): { total: number; byType: Record<string, number> } {
		const byType: Record<string, number> = {};
		
		for (const event of this.events) {
			byType[event.type] = (byType[event.type] || 0) + 1;
		}

		return { total: this.events.length, byType };
	}

	// Nettoie l'historique
	clear(): void {
		this.events.length = 0;
		console.log('💾 Persistence: History cleared');
	}
}

// PLUGIN D'ANALYTICS
export class AnalyticsPlugin implements EventPlugin<AnalyticsConfig> {
	name = 'analytics';
	version = '1.0.0';
	
	private eventCounts = new Map<EventNames, number>();
	private startTime = Date.now();
	private totalEvents = 0;
	private reportInterval?: ReturnType<typeof setInterval>;

	async initialize(emitter: TypedEventEmitter, config: AnalyticsConfig): Promise<void> {
		console.log('📊 Analytics plugin initialized');
		
		// Rapport périodique optionnel
		if (config.reportInterval) {
			this.reportInterval = setInterval(() => {
				const report = this.getReport();
				console.log('📊 Periodic Analytics Report:', {
					totalEvents: report.totalEvents,
					eventsPerSecond: report.eventsPerSecond,
					topEvents: Object.entries(report.eventCounts)
						.sort(([,a], [,b]) => b - a)
						.slice(0, 3)
						.map(([type, count]) => `${type}: ${count}`)
				});
			}, config.reportInterval);
		}
	}

	// Hook appelé automatiquement pour chaque événement
	onEventEmitted(event: Event<any>): void {
		this.totalEvents++;
		const count = this.eventCounts.get(event.type) || 0;
		this.eventCounts.set(event.type, count + 1);
	}

	async destroy(): Promise<void> {
		if (this.reportInterval) {
			clearInterval(this.reportInterval);
		}
		console.log('📊 Analytics plugin destroyed');
	}

	// Rapport détaillé
	getReport(): AnalyticsReport {
		const uptime = Date.now() - this.startTime;
		const eventsPerSecond = this.totalEvents / (uptime / 1000);

		return {
			totalEvents: this.totalEvents,
			eventsPerSecond: Math.round(eventsPerSecond * 100) / 100,
			eventCounts: Object.fromEntries(this.eventCounts),
			uptime: Math.round(uptime / 1000), // en secondes
			averageFrequency: this.calculateAverageFrequency(),
			mostActiveEvent: this.getMostActiveEvent()
		};
	}

	// Stats pour un type spécifique
	getEventCount(eventType: EventNames): number {
		return this.eventCounts.get(eventType) || 0;
	}

	// Reset des métriques
	reset(): void {
		this.eventCounts.clear();
		this.totalEvents = 0;
		this.startTime = Date.now();
		console.log('📊 Analytics: Metrics reset');
	}

	// Méthodes privées
	private calculateAverageFrequency(): number {
		const uptime = Date.now() - this.startTime;
		if (this.eventCounts.size === 0) return 0;
		
		const totalUniqueEvents = this.eventCounts.size;
		return Math.round((this.totalEvents / totalUniqueEvents) * 100) / 100;
	}

	private getMostActiveEvent(): { eventType: EventNames; count: number } | null {
		if (this.eventCounts.size === 0) return null;
		
		let maxCount = 0;
		let maxEventType: EventNames = 'user:login'; // default
		
		for (const [eventType, count] of this.eventCounts) {
			if (count > maxCount) {
				maxCount = count;
				maxEventType = eventType;
			}
		}
		
		return { eventType: maxEventType, count: maxCount };
	}
}

// TYPES ET INTERFACES
interface LoadedPlugin<TConfig> {
	plugin: EventPlugin<TConfig>;
	config: TConfig;
	loadedAt: Date;
}

export interface PersistenceConfig {
	maxEvents?: number;
}

export interface AnalyticsConfig {
	reportInterval?: number; // en millisecondes
}

export interface AnalyticsReport {
	totalEvents: number;
	eventsPerSecond: number;
	eventCounts: Record<string, number>;
	uptime: number; // en secondes
	averageFrequency: number;
	mostActiveEvent: { eventType: EventNames; count: number } | null;
}