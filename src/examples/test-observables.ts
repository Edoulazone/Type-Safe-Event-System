import { TypedEventEmitter } from '../core/emitter.js';
// ← Supprimer : import { Event } from '../core/types.js';

async function testObservables() {
	console.log('🚀 Testing Observables...\n');
	
	const emitter = new TypedEventEmitter();
	
	console.log('📝 Test: Basic Stream');
	emitter.stream('user:login').subscribe({
		next: (event: any) => {  // ← TypeScript infère automatiquement le type !
			console.log(`✅ Login: ${event.payload.userId}`);
		}
	});
	
	await emitter.emit('user:login', {
		userId: 'test123',
		timestamp: new Date()
	});
	
	console.log('✅ Test completed!');
}

testObservables().catch(console.error);