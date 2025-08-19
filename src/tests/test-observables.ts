import { TypedEventEmitter } from '../core/emitter';

async function testObservables() {
	console.log('🚀 Testing Observables System...\n');
	
	const emitter = new TypedEventEmitter();
	
	console.log('📝 Test 1: Basic Stream Subscription');
	let eventsReceived = 0;
	
	emitter.stream('user:login').subscribe(event => {
		eventsReceived++;
		console.log(`✅ Received login: ${event.payload.userId} (${eventsReceived})`);
	});
	
	await emitter.emit('user:login', {
		userId: 'test123',
		timestamp: new Date()
	});
	
	await emitter.emit('user:login', {
		userId: 'alice456',
		timestamp: new Date()
	});
	
	console.log(`✅ Basic stream test completed (${eventsReceived} events received)\n`);
	
	console.log('📝 Test 2: Filter Operator');
	let filteredEvents = 0;
	
	emitter.stream('order:created')
		.filter(event => event.payload.amount > 100)
		.subscribe(event => {
			filteredEvents++;
			console.log(`💰 High-value order: ${event.payload.orderId} ($${event.payload.amount})`);
		});
	
	// Émettre des commandes avec différents montants
	await emitter.emit('order:created', {
		orderId: 'order1',
		userId: 'user1',
		amount: 50, // Ne passera pas le filtre
		items: ['item1']
	});
	
	await emitter.emit('order:created', {
		orderId: 'order2',
		userId: 'user2',
		amount: 150, // Passera le filtre
		items: ['item2']
	});
	
	await emitter.emit('order:created', {
		orderId: 'order3',
		userId: 'user3',
		amount: 200, // Passera le filtre
		items: ['item3']
	});
	
	console.log(`✅ Filter test completed (${filteredEvents} filtered events)\n`);
	
	console.log('📝 Test 3: Take Operator');
	let takenEvents = 0;
	
	emitter.stream('user:login')
		.take(2)
		.subscribe({
			next: event => {
				takenEvents++;
				console.log(`📥 Taken event ${takenEvents}: ${event.payload.userId}`);
			},
			complete: () => {
				console.log('🔚 Stream completed after taking 2 events');
			}
		});
	
	// Émettre 3 événements, mais seulement 2 seront pris
	for (let i = 1; i <= 3; i++) {
		await emitter.emit('user:login', {
			userId: `take_user_${i}`,
			timestamp: new Date()
		});
	}
	
	console.log(`✅ Take test completed (${takenEvents} taken)\n`);
	
	console.log('📝 Test 4: Chaining Operators');
	let chainedEvents = 0;
	
	emitter.stream('order:created')
		.filter(event => event.payload.amount > 75)
		.take(2)
		.subscribe({
			next: event => {
				chainedEvents++;
				console.log(`🔗 Chained event ${chainedEvents}: ${event.payload.orderId} ($${event.payload.amount})`);
			},
			complete: () => {
				console.log('🔚 Chained stream completed');
			}
		});
	
	// Émettre plusieurs commandes
	const orders = [
		{ amount: 50, shouldPass: false },
		{ amount: 100, shouldPass: true },
		{ amount: 25, shouldPass: false },
		{ amount: 150, shouldPass: true },
		{ amount: 200, shouldPass: false } // Ne sera pas pris car take(2)
	];
	
	for (let i = 0; i < orders.length; i++) {
		await emitter.emit('order:created', {
			orderId: `chain_order_${i + 1}`,
			userId: `user${i + 1}`,
			amount: orders[i].amount,
			items: [`item${i + 1}`]
		});
	}
	
	console.log(`✅ Chaining test completed (${chainedEvents} chained events)\n`);
	
	console.log('📝 Test 5: Error Handling');
	
	const errorStream = emitter.stream('system:error');
	errorStream.subscribe({
		next: event => {
			console.log(`⚠️ System error caught: ${event.payload.error.message}`);
		},
		error: error => {
			console.log(`❌ Stream error: ${error.message}`);
		}
	});
	
	await emitter.emit('system:error', {
		error: new Error('Test error for observable'),
		context: 'observable-test',
		severity: 'low'
	});
	
	console.log('✅ Error handling test completed\n');
	
	console.log('📝 Test 6: Multiple Subscriptions');
	let subscription1Count = 0;
	let subscription2Count = 0;
	
	const sharedStream = emitter.stream('notification:sent');
	
	const sub1 = sharedStream.subscribe(event => {
		subscription1Count++;
		console.log(`📧 Sub1 received: ${event.payload.type} to ${event.payload.userId}`);
	});
	
	const sub2 = sharedStream.subscribe(event => {
		subscription2Count++;
		console.log(`📱 Sub2 received: ${event.payload.message}`);
	});
	
	await emitter.emit('notification:sent', {
		userId: 'user123',
		type: 'email',
		message: 'Welcome to our service!',
		deliveredAt: new Date()
	});
	
	// Désabonner une subscription
	sub1.unsubscribe();
	
	await emitter.emit('notification:sent', {
		userId: 'user456',
		type: 'sms',
		message: 'Your order is ready!',
		deliveredAt: new Date()
	});
	
	console.log(`✅ Multiple subscriptions test: Sub1=${subscription1Count}, Sub2=${subscription2Count}\n`);
	
	console.log('📝 Test 7: Promise Conversion');
	
	// Créer une promesse qui se résout au premier événement
	const firstLoginPromise = emitter.stream('user:login').toPromise();
	
	// Émettre un événement
	setTimeout(() => {
		emitter.emit('user:login', {
			userId: 'promise_user',
			timestamp: new Date()
		});
	}, 100);
	
	try {
		const event = await firstLoginPromise;
		console.log(`🎯 Promise resolved with: ${event.payload.userId}`);
	} catch (error) {
		console.log(`❌ Promise rejected: ${error}`);
	}
	
	console.log('✅ Promise conversion test completed\n');
	
	console.log('🎉 All observable tests completed successfully!');
	
	await emitter.dispose();
	process.exit(0);
}

testObservables().catch(console.error);