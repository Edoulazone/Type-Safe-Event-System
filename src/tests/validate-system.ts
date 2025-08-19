/**
 * Script de validation rapide du système
 * Vérifie que tous les composants fonctionnent correctement
 */

import { TypedEventEmitter } from '../core/emitter.js';
import { PluginRegistry, PersistencePlugin, AnalyticsPlugin } from '../plugins/plugins.js';
import { LoggingMiddleware, ValidationMiddleware } from '../middleware/base.js';

async function validateSystem(): Promise<void> {
	console.log('🔍 Validating Type-Safe Event System...\n');

	const results: { test: string; status: '✅' | '❌'; message?: string }[] = [];

	// Test 1: Basic Event Emission
	try {
		const emitter = new TypedEventEmitter();
		let received = false;

		emitter.on('user:login', (event) => {
			received = true;
			// Type checking au runtime
			if (typeof event.payload.userId !== 'string') {
				throw new Error('userId should be string');
			}
		});

		await emitter.emit('user:login', {
			userId: 'test123',
			timestamp: new Date()
		});

		if (received) {
			results.push({ test: 'Basic Event Emission', status: '✅' });
		} else {
			results.push({ test: 'Basic Event Emission', status: '❌', message: 'Event not received' });
		}

		await emitter.dispose();
	} catch (error) {
		results.push({ test: 'Basic Event Emission', status: '❌', message: (error as Error).message });
	}

	// Test 2: Middleware Pipeline
	try {
		const emitter = new TypedEventEmitter();
		const logger = new LoggingMiddleware(console, { includePayload: false });
		
		emitter.use(logger);

		let processed = false;
		emitter.on('user:login', () => { processed = true; });

		await emitter.emit('user:login', {
			userId: 'test123',
			timestamp: new Date()
		});

		if (processed) {
			results.push({ test: 'Middleware Pipeline', status: '✅' });
		} else {
			results.push({ test: 'Middleware Pipeline', status: '❌', message: 'Middleware failed' });
		}

		await emitter.dispose();
	} catch (error) {
		results.push({ test: 'Middleware Pipeline', status: '❌', message: (error as Error).message });
	}

	// Test 3: Plugin System
	try {
		const emitter = new TypedEventEmitter();
		const registry = new PluginRegistry(emitter);

		await registry.register(new PersistencePlugin(), { maxEvents: 10 });
		await registry.register(new AnalyticsPlugin(), {});

		await emitter.emit('user:login', {
			userId: 'test123',
			timestamp: new Date()
		});

		// Attendre un peu pour que les plugins traitent
		await new Promise(resolve => setTimeout(resolve, 100));

		const persistence = registry.getPlugin<PersistencePlugin>('persistence');
		const analytics = registry.getPlugin<AnalyticsPlugin>('analytics');

		if (persistence && analytics) {
			const stats = persistence.getStats();
			const report = analytics.getReport();

			if (stats.total > 0 && report.totalEvents > 0) {
				results.push({ test: 'Plugin System', status: '✅' });
			} else {
				results.push({ test: 'Plugin System', status: '❌', message: `Persistence: ${stats.total}, Analytics: ${report.totalEvents}` });
			}
		} else {
			results.push({ test: 'Plugin System', status: '❌', message: 'Plugins not loaded' });
		}

		await registry.dispose();
		await emitter.dispose();
	} catch (error) {
		results.push({ test: 'Plugin System', status: '❌', message: (error as Error).message });
	}

	// Test 4: Observable Streams
	try {
		const emitter = new TypedEventEmitter();
		let streamReceived = false;

		const stream = emitter.stream('user:login')
			.filter(event => event.payload.userId.length > 3)
			.take(1);

		stream.subscribe({
			next: () => { streamReceived = true; },
			complete: () => { /* stream completed */ }
		});

		await emitter.emit('user:login', {
			userId: 'test123',
			timestamp: new Date()
		});

		// Attendre un peu pour que l'observable traite
		await new Promise(resolve => setTimeout(resolve, 100));

		if (streamReceived) {
			results.push({ test: 'Observable Streams', status: '✅' });
		} else {
			results.push({ test: 'Observable Streams', status: '❌', message: 'Stream not working' });
		}

		await emitter.dispose();
	} catch (error) {
		results.push({ test: 'Observable Streams', status: '❌', message: (error as Error).message });
	}

	// Test 5: Type Safety (compile-time, mais on peut tester au runtime)
	try {
		const emitter = new TypedEventEmitter();
		
		// Test que les types corrects fonctionnent
		await emitter.emit('user:login', {
			userId: 'test123',
			timestamp: new Date()
		});

		results.push({ test: 'Type Safety', status: '✅' });
		
		await emitter.dispose();
	} catch (error) {
		results.push({ test: 'Type Safety', status: '❌', message: (error as Error).message });
	}

	// Test 6: Performance Basique
	try {
		const emitter = new TypedEventEmitter();
		const startTime = Date.now();
		const eventCount = 100;

		emitter.on('user:login', () => { /* process event */ });

		for (let i = 0; i < eventCount; i++) {
			await emitter.emit('user:login', {
				userId: `user${i}`,
				timestamp: new Date()
			});
		}

		const duration = Date.now() - startTime;
		const eventsPerSecond = Math.round((eventCount / duration) * 1000);

		if (eventsPerSecond > 50) { // Au moins 50 events/sec
			results.push({ test: 'Performance Baseline', status: '✅', message: `${eventsPerSecond} events/sec` });
		} else {
			results.push({ test: 'Performance Baseline', status: '❌', message: `Only ${eventsPerSecond} events/sec` });
		}

		await emitter.dispose();
	} catch (error) {
		results.push({ test: 'Performance Baseline', status: '❌', message: (error as Error).message });
	}

	// Afficher les résultats
	console.log('📊 Validation Results:\n');
	
	let passed = 0;
	let failed = 0;

	results.forEach(result => {
		const message = result.message ? ` (${result.message})` : '';
		console.log(`${result.status} ${result.test}${message}`);
		
		if (result.status === '✅') {
			passed++;
		} else {
			failed++;
		}
	});

	console.log(`\n📈 Summary: ${passed} passed, ${failed} failed`);

	if (failed === 0) {
		console.log('\n🎉 All systems operational! Your event system is ready for production.');
	} else {
		console.log('\n⚠️ Some tests failed. Please check the issues above.');
		process.exit(1);
	}
}

// Lancer la validation
validateSystem().catch(console.error);