import { EventNames, Event } from '../core/types.js';
import { TypedEventEmitter } from '../core/emitter.js';

// INTERFACE DE BASE : Plugin
export interface EventPlugin<TConfig = any> {
	name: string;
	version: string;
	
	// Lifecycle
	initialize(emitter: TypedEventEmitter, config: TConfig): Promise<void> | void;
	destroy?(): Promise<void> | void;
	
	// Event hook optionnel
	onEventEmitted?<T extends EventNames>(event: Event<T>): Promise<void> | void;
}

// REGISTRY DE PLUGINS - Simple et efficace
export class PluginRegistry {
	private plugins = new Map<string, LoadedPlugin<any>>();
	private emitter: TypedEventEmitter;

	constructor(emitter: TypedEventEmitter) {
		this.emitter = emitter;
	}

	// Enregistre un plugin (VERSION CORRIGÉE - PLUS DE DUPLICATION)
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

			// FIX SPÉCIAL POUR PERSISTENCE - Forcer la méthode
			if (plugin.name === 'persistence') {
				console.log('🔧 Applying special fix for persistence plugin');
				(plugin as any).onEventEmitted = (event: Event<any>) => {
					console.log(`💾 Persistence: Storing event ${event.type}`);
					(plugin as any).events.push(event);
					
					if ((plugin as any).events.length > (plugin as any).maxEvents) {
						(plugin as any).events.shift();
					}
				};
			}

			// Debug explicite
			console.log(`🔍 Plugin ${plugin.name} properties:`, Object.getOwnPropertyNames(plugin));
			console.log(`🔍 Plugin ${plugin.name} has onEventEmitted:`, typeof plugin.onEventEmitted);

			// Hook d'événements - NOUVELLE APPROCHE
			if (plugin.onEventEmitted) {
				console.log(`🔗 Registering event hook for plugin ${plugin.name}`); // Debug
				// Ajouter un middleware pour appeler le hook
				this.emitter.use({
					name: `plugin-${plugin.name}`,
					after: async (event) => {
						if (plugin.onEventEmitted) {
							plugin.onEventEmitted(event);
						}
					}
				});
			} else {
				console.log(`⚠️ Plugin ${plugin.name} has no onEventEmitted hook`); // Debug
			}

			// Stocker
			this.plugins.set(plugin.name, {
				plugin,
				config,
				loadedAt: new Date()
			});

			console.log(`✅ Plugin ${plugin.name} loaded`);

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

// PLUGIN DE PERSISTANCE - Sauvegarde simple
export class PersistencePlugin implements EventPlugin<PersistenceConfig> {
	name = 'persistence';
	version = '1.0.0';
	
	private events: Event<any>[] = [];
	private maxEvents: number = 1000; // Valeur par défaut

	async initialize(emitter: TypedEventEmitter, config: PersistenceConfig): Promise<void> {
		this.maxEvents = config.maxEvents || 1000;

		// Sauvegarder tous les événements
		emitter.stream().subscribe({
			next: (event) => {
				console.log(`💾 Persistence: Storing event ${event.type}`); // Debug
				this.events.push(event);
				
				// Limiter la taille
				if (this.events.length > this.maxEvents) {
					this.events.shift();
				}
			}
		});
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
		
		for (const event of toReplay) {
			await emitter.emit(event.type, event.payload, {
				source: 'replay',
				metadata: { replayed: true }
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
}

// PLUGIN D'ANALYTICS - Métriques simples
export class AnalyticsPlugin implements EventPlugin<AnalyticsConfig> {
	name = 'analytics';
	version = '1.0.0';
	
	private eventCounts = new Map<EventNames, number>();
	private startTime = Date.now();
	private totalEvents = 0;
	private reportInterval?: ReturnType<typeof setInterval>;

	async initialize(emitter: TypedEventEmitter, config: AnalyticsConfig): Promise<void> {
		console.log('📊 Analytics initialized');
		
		// Rapport périodique optionnel
		if (config.reportInterval) {
			this.reportInterval = setInterval(() => {
				console.log('📊 Periodic Analytics:', this.getReport());
			}, config.reportInterval);
		}
	}

	// Hook appelé automatiquement pour chaque événement
	onEventEmitted(event: Event<any>): void {
		console.log(`📊 Analytics: Counting event ${event.type}`);
		this.totalEvents++;
		const count = this.eventCounts.get(event.type) || 0;
		this.eventCounts.set(event.type, count + 1);
	}

	async destroy(): Promise<void> {
		if (this.reportInterval) {
			clearInterval(this.reportInterval);
		}
	}

	// Rapport simple
	getReport(): AnalyticsReport {
		const uptime = Date.now() - this.startTime;
		const eventsPerSecond = this.totalEvents / (uptime / 1000);

		return {
			totalEvents: this.totalEvents,
			eventsPerSecond: Math.round(eventsPerSecond * 100) / 100,
			eventCounts: Object.fromEntries(this.eventCounts),
			uptime: Math.round(uptime / 1000) // en secondes
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
	}
}

// TYPES SIMPLES
interface LoadedPlugin<TConfig> {
	plugin: EventPlugin<TConfig>;
	config: TConfig;
	loadedAt: Date;
}

export interface PersistenceConfig {
	maxEvents?: number; // Limite d'événements en mémoire
}

export interface AnalyticsConfig {
	reportInterval?: number; // Intervalle de rapport en ms
}

export interface AnalyticsReport {
	totalEvents: number;
	eventsPerSecond: number;
	eventCounts: Record<string, number>;
	uptime: number; // en secondes
}

// EXEMPLE D'UTILISATION
/*
const emitter = new TypedEventEmitter();
const registry = new PluginRegistry(emitter);

// Ajouter plugins
await registry.register(new PersistencePlugin(), { maxEvents: 500 });
await registry.register(new AnalyticsPlugin(), { reportInterval: 10000 });

// Utiliser
const persistence = registry.getPlugin<PersistencePlugin>('persistence');
const analytics = registry.getPlugin<AnalyticsPlugin>('analytics');

// Les événements sont automatiquement sauvés et comptés !
await emitter.emit('user:login', { userId: 'test', timestamp: new Date() });

// Voir les stats
console.log(analytics?.getReport());
console.log(persistence?.getStats());
*/