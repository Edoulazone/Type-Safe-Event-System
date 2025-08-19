import { TypedEventEmitter } from '../core/emitter';
import { PluginRegistry, PersistencePlugin, AnalyticsPlugin } from '../plugins/plugins';
import { 
	LoggingMiddleware, 
	ValidationMiddleware, 
	userLoginValidator,
	orderCreatedValidator
} from '../middleware/base';
import { createUserId } from '../core/types';

class SimpleEventDemo {
	private readonly emitter: TypedEventEmitter;
	private readonly pluginRegistry: PluginRegistry;

	constructor() {
		console.log('🚀 Simple Event System Demo\n');
		this.emitter = new TypedEventEmitter();
		this.pluginRegistry = new PluginRegistry(this.emitter);
	}

	async setup(): Promise<void> {
		console.log('⚙️ Setting up middleware and plugins...');
		
		// Middleware
		const logger = new LoggingMiddleware(console, { includePayload: false });
		const validator = new ValidationMiddleware();
		validator.addValidator('user:login', userLoginValidator);
		validator.addValidator('order:created', orderCreatedValidator);

		this.emitter.use(logger);
		this.emitter.use(validator);

		// Plugins
		await this.pluginRegistry.register(new PersistencePlugin(), { maxEvents: 50 });
		await this.pluginRegistry.register(new AnalyticsPlugin(), { reportInterval: 5000 });

		// Listeners
		this.emitter.on('user:login', (event) => {
			console.log(`👤 User ${event.payload.userId} logged in`);
		});

		this.emitter.on('order:created', (event) => {
			console.log(`🛒 Order ${event.payload.orderId}: $${event.payload.amount}`);
		});

		this.emitter.on('system:error', (event) => {
			console.log(`⚠️ Error: ${event.payload.error.message}`);
		});

		// Observable simple pour les commandes importantes
		this.emitter.stream('order:created')
			.filter(event => event.payload.amount > 500)
			.subscribe(event => {
				console.log(`💰 High-value order detected: ${event.payload.orderId} ($${event.payload.amount})`);
			});

		console.log('✅ Setup complete\n');
	}

	async runDemo(): Promise<void> {
		console.log('📝 Generating sample events...\n');

		const users = ['alice', 'bob', 'charlie'].map(createUserId);

		// Générer des événements de test
		for (let i = 0; i < 15; i++) {
			const user = users[i % users.length];

			try {
				// Login utilisateur
				await this.emitter.emit('user:login', {
					userId: user,
					timestamp: new Date(),
					ip: `192.168.1.${100 + i}`
				});

				// Création de commande
				const amount = Math.round(Math.random() * 1000 + 50);
				await this.emitter.emit('order:created', {
					orderId: `order_${i + 1}`,
					userId: user,
					amount,
					items: [`item_${i + 1}`, `item_${i + 2}`]
				});

				// Traitement de paiement
				await this.emitter.emit('payment:processed', {
					paymentId: `pay_${i + 1}`,
					orderId: `order_${i + 1}`,
					amount,
					method: 'credit_card',
					status: 'success',
					timestamp: new Date()
				});

				// Notification
				await this.emitter.emit('notification:sent', {
					userId: user,
					type: 'email',
					message: `Your order #${i + 1} has been confirmed!`,
					deliveredAt: new Date()
				});

				// Erreur occasionnelle pour tester
				if (i % 7 === 0) {
					await this.emitter.emit('system:error', {
						error: new Error(`Test error ${i + 1}`),
						context: 'demo-simulation',
						severity: 'medium'
					});
				}

				// Petit délai pour voir la progression
				await new Promise(resolve => setTimeout(resolve, 100));

			} catch (error) {
				console.error(`❌ Error processing event ${i + 1}:`, (error as Error).message);
			}
		}

		console.log('\n✅ Event generation complete');
		
		// Attendre un peu pour que tous les événements soient traités
		await new Promise(resolve => setTimeout(resolve, 1000));
	}

	async testObservables(): Promise<void> {
		console.log('\n🔍 Testing Observable Features...');

		// Test des opérateurs
		console.log('• Testing filter + take operators:');
		
		const userLoginStream = this.emitter.stream('user:login')
			.filter(event => event.payload.userId.includes('test'))
			.take(2);

		userLoginStream.subscribe({
			next: (event) => console.log(`  📊 Filtered login: ${event.payload.userId}`),
			complete: () => console.log('  ✅ Stream completed')
		});

		// Émettre quelques événements de test
		for (let i = 1; i <= 3; i++) {
			await this.emitter.emit('user:login', {
				userId: `test_user_${i}`,
				timestamp: new Date()
			});
		}

		await new Promise(resolve => setTimeout(resolve, 500));
	}

	async showStats(): Promise<void> {
		console.log('\n📊 Final Statistics:');

		// Métriques de l'emitter
		const metrics = this.emitter.getMetrics();
		console.log(`• Total events emitted: ${metrics.totalEvents}`);
		console.log(`• Events per second: ${metrics.eventsPerSecond}`);
		console.log(`• Memory usage: ${Math.round(metrics.memoryUsage / 1024)}KB`);

		// Stats des plugins
		const persistence = this.pluginRegistry.getPlugin<PersistencePlugin>('persistence');
		const analytics = this.pluginRegistry.getPlugin<AnalyticsPlugin>('analytics');

		if (persistence) {
			const stats = persistence.getStats();
			console.log(`• Events stored: ${stats.total}`);
			console.log('• Events by type:', Object.entries(stats.byType)
				.map(([type, count]) => `${type}: ${count}`)
				.join(', '));
		}

		if (analytics) {
			const report = analytics.getReport();
			console.log(`• Analytics total: ${report.totalEvents}`);
			if (report.mostActiveEvent) {
				console.log(`• Most active: ${report.mostActiveEvent.eventType} (${report.mostActiveEvent.count} times)`);
			}
		}
	}

	async testPluginFeatures(): Promise<void> {
		console.log('\n🔄 Testing Plugin Features...');

		const persistence = this.pluginRegistry.getPlugin<PersistencePlugin>('persistence');
		
		if (persistence) {
			// Test du replay
			console.log('• Testing event replay:');
			const replayedCount = await persistence.replay(this.emitter, 'user:login', 2);
			console.log(`  ✅ Replayed ${replayedCount} login events`);
			
			// Historique récent
			const recentOrders = persistence.getHistory('order:created', 3);
			console.log(`• Recent orders: ${recentOrders.length} found`);
			recentOrders.forEach(order => {
				console.log(`  - ${order.payload.orderId}: $${order.payload.amount}`);
			});
		}
	}

	async cleanup(): Promise<void> {
		console.log('\n🧹 Cleaning up...');
		await this.pluginRegistry.dispose();
		await this.emitter.dispose();
		console.log('✅ Cleanup complete');
	}
}

async function runDemo(): Promise<void> {
	const demo = new SimpleEventDemo();
	
	try {
		await demo.setup();
		await demo.runDemo();
		await demo.testObservables();
		await demo.testPluginFeatures();
		await demo.showStats();
	} catch (error) {
		console.error('❌ Demo failed:', error);
	} finally {
		await demo.cleanup();
		console.log('\n🎉 Demo completed successfully!');
		process.exit(0);
	}
}

// Lancer la démo si ce fichier est exécuté directement
if (import.meta.url === `file://${process.argv[1]}`) {
	runDemo().catch(console.error);
}