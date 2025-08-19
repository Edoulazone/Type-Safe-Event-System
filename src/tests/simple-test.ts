import { TypedEventEmitter } from '../core/emitter.js';

async function simpleTest() {
	console.log('🚀 Simple Test...');
	
	const emitter = new TypedEventEmitter();
	
	// Test basique sans stream
	emitter.on('user:login', (event) => {
		console.log(`✅ User logged in: ${event.payload.userId}`);
	});
	
	await emitter.emit('user:login', {
		userId: 'test123',
		timestamp: new Date()
	});
	
	console.log('✅ Basic test completed!');
}

simpleTest().catch(console.error);
