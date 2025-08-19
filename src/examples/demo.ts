/**
 * Démonstration simplifiée du système d'événements type-safe
 */

import { TypedEventEmitter } from '../core/emitter.js';
import { PluginRegistry, PersistencePlugin, AnalyticsPlugin } from '../plugins/plugins.js';
import { 
	LoggingMiddleware, 
	ValidationMiddleware, 
	userLoginValidator,
	orderCreatedValidator
} from '../middleware/base.js';
import { createUserId, PaymentMethod, PaymentStatus, ErrorSeverity, NotificationType } from '../core/types.js';

class SimpleEventDemo {
	private readonly emitter: TypedEventEmitter;
	private readonly pluginRegistry: PluginRegistry;

	constructor() {
		console.log('🚀 Simple Event System Demo\n');
		this.emitter = new TypedEventEmitter();
		this.pluginRegistry = new PluginRegistry(this.emitter);
	}

	async setup(): Promise<void> {
		// Middleware
		const logger = new LoggingMiddleware(console, { includePayload: false });
		const validator = new ValidationMiddleware();
		validator.addValidator('user:login', userLoginValidator);
		validator.addValidator('order:created', orderCreatedValidator);

		this.emitter.use(logger);
		this.emitter.use(validator);

		// Plugins
		await this.pluginRegistry.register(new PersistencePlugin(), { maxEvents: 50 });
		await this.pluginRegistry.register(new AnalyticsPlugin(), {});

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

		// Simple observables
		this.emitter.stream('order:created').subscribe({
			next: (event) => {
				if (event.payload.amount > 500) {
					console.log(`💰 High-value order: ${event.payload.orderId}`);
				}
			}
		});

		console.log('✅ Setup complete\n');
	}

	async runDemo(): Promise<void> {
		console.log('📝 Generating events...\n');

		const users = ['alice', 'bob', 'charlie'].map(createUserId);

		// Generate events
		for (let i = 0; i < 20; i++) {
			const user = users[i % users.length];

			try {
				// User login
				await this.emitter.emit('user:login', {
					userId: user,
					timestamp: new Date()
				});

				// Order creation
				await this.emitter.emit('order:created', {
					orderId: `order_${i}`,
					userId: user,
					amount: Math.round(Math.random() * 1000 + 50),
					items: [`item_${i}`]
				});

				// Payment
				await this.emitter.emit('payment:processed', {
					paymentId: `pay_${i}`,
					orderId: `order_${i}`,
					amount: Math.round(Math.random() * 1000 + 50),
					method: PaymentMethod.CREDIT_CARD,
					status: PaymentStatus.SUCCESS,
					timestamp: new Date()
				});

				// Occasional error
				if (i % 7 === 0) {
					await this.emitter.emit('system:error', {
						error: new Error(`Test error ${i}`),
						context: 'demo',
						severity: ErrorSeverity.MEDIUM
					});
				}

			} catch (error) {
				// Rate limiting or other errors
				if (error instanceof Error && !error.message.includes('Rate limit')) {
					console.error('Error:', error.message);
				}
			}
		}

		console.log('\n✅ Event generation complete');
		await new Promise(resolve => setTimeout(resolve, 1000));
	}


	async showStats(): Promise<void> {
		console.log('\n📊 Final Statistics:');

		// Emitter metrics
		const metrics = this.emitter.getMetrics();
		console.log(`• Total events: ${metrics.totalEvents}`);
		console.log(`• Events/sec: ${metrics.eventsPerSecond}`);

		// Plugin stats
		const persistence = this.pluginRegistry.getPlugin<PersistencePlugin>('persistence');
		const analytics = this.pluginRegistry.getPlugin<AnalyticsPlugin>('analytics');

		if (persistence) {
			const stats = persistence.getStats();
			console.log(`• Stored events: ${stats.total}`);
		}

		if (analytics) {
			const report = analytics.getReport();
			console.log(`• Analytics events: ${report.totalEvents}`);
		}
	}

	async cleanup(): Promise<void> {
		await this.pluginRegistry.dispose();
		await this.emitter.dispose();
		console.log('\n🧹 Cleanup complete');
	}
}

async function runDemo(): Promise<void> {
	const demo = new SimpleEventDemo();
	
	try {
		await demo.setup();
		await demo.runDemo();
		await demo.showStats();
	} catch (error) {
		console.error('Demo failed:', error);
	} finally {
		await demo.cleanup();
		console.log('\n🎉 Demo completed successfully!');
		process.exit(0);
	}
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runDemo().catch(console.error);
}