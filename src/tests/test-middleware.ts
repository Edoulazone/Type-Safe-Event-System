import { TypedEventEmitter } from '../core/emitter.ts';
import { 
	LoggingMiddleware, 
	ValidationMiddleware, 
	RateLimitMiddleware,
	PerformanceMiddleware,
	userLoginValidator,
	orderCreatedValidator
} from '../middleware/base.ts';

async function testMiddleware() {
	console.log('🛡️ Testing Middleware System...\n');
	
	const emitter = new TypedEventEmitter();
	
	// 1. Setup Logging Middleware
	const logger = new LoggingMiddleware(console, {
		includePayload: true,
		logLevel: 'info'
	});
	
	// 2. Setup Validation Middleware
	const validator = new ValidationMiddleware();
	validator.addValidator('user:login', userLoginValidator);
	validator.addValidator('order:created', orderCreatedValidator);
	
	// 3. Setup Rate Limiting Middleware  
	const rateLimiter = new RateLimitMiddleware({
		maxEvents: 3,
		windowMs: 10000, // 3 événements par 10 secondes
		keyExtractor: (event) => {
			const payload = event.payload as any;
			return payload.userId || 'anonymous';
		}
	});
	
	// 4. Setup Performance Middleware
	const perfMonitor = new PerformanceMiddleware();
	
	// 5. Add all middleware to emitter
	emitter.use(logger);
	emitter.use(validator);
	emitter.use(rateLimiter);
	emitter.use(perfMonitor);
	
	// 6. Add a listener
	emitter.on('user:login', (event) => {
		console.log(`   👤 User ${event.payload.userId} processed successfully`);
	});
	
	console.log('📝 Test 1: Valid events');
	try {
		await emitter.emit('user:login', {
			userId: 'alice123',
			timestamp: new Date(),
			ip: '192.168.1.1'
		});
		
		await emitter.emit('user:login', {
			userId: 'bob456', 
			timestamp: new Date()
		});
	} catch (error) {
		console.error('❌ Unexpected error:', error);
	}
	
	console.log('\n📝 Test 2: Invalid event (should fail validation)');
	try {
		await emitter.emit('user:login', {
			userId: 'x', // Trop court !
			timestamp: new Date()
		});
	} catch (error: any) {
		console.log(`   ❌ Validation blocked: ${error.message}`);
	}
	
	console.log('\n📝 Test 3: Rate limiting (4th event should fail)');
	try {
		await emitter.emit('user:login', {
			userId: 'alice123',
			timestamp: new Date()
		});
		
		await emitter.emit('user:login', {
			userId: 'alice123', 
			timestamp: new Date()
		});
		
		// This should fail (4th event for alice123)
		await emitter.emit('user:login', {
			userId: 'alice123',
			timestamp: new Date()
		});
	} catch (error: any) {
		console.log(`   ⏱️ Rate limit blocked: ${error.message}`);
	}
	
	console.log('\n📊 Performance Metrics:');
	const metrics = perfMonitor.getMetrics();
	for (const [eventType, metric] of metrics) {
		console.log(`   ${eventType}: ${metric.count} events, avg ${metric.avgDuration.toFixed(2)}ms`);
	}
	
	console.log('\n📊 Rate Limit Stats:');
	const rateLimitStats = rateLimiter.getStats();
	console.log(`   Active keys: ${rateLimitStats.activeKeys.size}`);
	for (const [key, count] of rateLimitStats.activeKeys) {
		console.log(`   - ${key}: ${count}/${rateLimitStats.maxEvents} events`);
	}
	
	console.log('\n✅ Middleware tests completed!');

	await emitter.dispose();
	process.exit(0); // Forcer l'arrêt du processus
}

testMiddleware().catch(console.error);