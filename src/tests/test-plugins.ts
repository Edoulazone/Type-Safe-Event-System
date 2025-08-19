import { TypedEventEmitter } from '../core/emitter.js';
import { 
	PluginRegistry, 
	PersistencePlugin, 
	AnalyticsPlugin 
} from '../plugins/plugins.js';

async function testPlugins() {
	console.log('🔌 Testing Plugin System...\n');
	
	const emitter = new TypedEventEmitter();
	const registry = new PluginRegistry(emitter);
	
	// 1. Charger les plugins
	console.log('📦 Loading plugins...');
	await registry.register(new PersistencePlugin(), { maxEvents: 100 });
	await registry.register(new AnalyticsPlugin(), { reportInterval: 5000 });
	
	console.log('Active plugins:', registry.getPlugins());
	
	// 2. Ajouter des listeners
	emitter.on('user:login', (event) => {
		console.log(`👤 ${event.payload.userId} logged in`);
	});
	
	emitter.on('order:created', (event) => {
		console.log(`📦 Order ${event.payload.orderId} created ($${event.payload.amount})`);
	});
	
	// 3. Émettre des événements
	console.log('\n📝 Emitting events...');
	
	for (let i = 1; i <= 3; i++) {
		await emitter.emit('user:login', {
			userId: `user${i}`,
			timestamp: new Date()
		});
		
		await emitter.emit('order:created', {
			orderId: `order${i}`,
			userId: `user${i}`,
			amount: Math.round(Math.random() * 500 + 50),
			items: [`item${i}`]
		});
		
		// Petit délai pour voir la progression
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	
	// 4. Vérifier les plugins
	console.log('\n📊 Analytics Report:');
	const analytics = registry.getPlugin<AnalyticsPlugin>('analytics')!;
	const report = analytics.getReport();
	console.log(`- Total events: ${report.totalEvents}`);
	console.log(`- Events/second: ${report.eventsPerSecond}`);
	console.log('- By type:', report.eventCounts);
	console.log(`- Uptime: ${report.uptime}s`);
	
	console.log('\n💾 Persistence Stats:');
	const persistence = registry.getPlugin<PersistencePlugin>('persistence')!;
	const stats = persistence.getStats();
	console.log(`- Total stored: ${stats.total}`);
	console.log('- By type:', stats.byType);
	
	// 5. Test de l'historique
	console.log('\n📚 Event History:');
	const userLogins = persistence.getHistory('user:login');
	console.log(`- User logins stored: ${userLogins.length}`);
	
	const lastLogin = userLogins[userLogins.length - 1];
	if (lastLogin) {
		console.log(`- Last login: ${lastLogin.payload.userId} at ${lastLogin.timestamp.toLocaleTimeString()}`);
	}
	
	// 6. Test du replay
	console.log('\n🔄 Testing Event Replay:');
	console.log('Replaying last 2 user logins...');
	
	const replayedCount = await persistence.replay(emitter, 'user:login', 2);
	console.log(`✅ Replayed ${replayedCount} events`);
	
	// 7. Stats finales
	console.log('\n📈 Final Analytics:');
	const finalReport = analytics.getReport();
	console.log(`- Total events: ${finalReport.totalEvents} (should be higher after replay)`);
	console.log('- Distribution:', finalReport.eventCounts);
	
	console.log('\n✅ Plugin tests completed!');
	
	// 8. Cleanup
	await registry.dispose();
	await emitter.dispose();
	process.exit(0);
}

testPlugins().catch(console.error);