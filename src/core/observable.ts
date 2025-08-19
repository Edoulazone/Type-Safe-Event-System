import { Event, EventNames, EventListener, Subscription } from './types.js';

/**
 * Observer pattern optimisé pour les événements
 */
export interface Observer<T> {
	next?(value: T): void;
	error?(error: Error): void;
	complete?(): void;
}

/**
 * Observable spécialisé pour les événements avec opérateurs avancés
 * Performance: Optimisé pour high-throughput et low-latency
 */
export class EventObservable<T extends EventNames = EventNames> {
	private readonly observers = new Set<Observer<Event<T>>>();
	private isCompleted = false;
	private hasError = false;
	private readonly subscriptionIds = new WeakMap<Observer<Event<T>>, string>();

	/**
	 * Souscrit à l'observable avec gestion automatique des erreurs
	 */
	subscribe(observer: EventListener<T> | Observer<Event<T>>): Subscription {
		const observerObj = typeof observer === 'function' 
			? { next: observer } 
			: observer;

		this.observers.add(observerObj);
		
		const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
		this.subscriptionIds.set(observerObj, subscriptionId);

		return {
			unsubscribe: () => {
				this.observers.delete(observerObj);
				this.subscriptionIds.delete(observerObj);
			},
			closed: this.isCompleted || this.hasError,
			listenerId: subscriptionId
		};
	}

	/**
	 * OPÉRATEUR : FILTER - Filtrer les événements avec type narrowing
	 */
	filter<U extends T>(
		predicate: (event: Event<T>) => event is Event<U>
	): EventObservable<U>;
	filter(
		predicate: (event: Event<T>) => boolean
	): EventObservable<T>;
	filter(predicate: any): any {
		const filtered = new EventObservable<T>();
		
		this.subscribe({
			next: (event) => {
				try {
					if (predicate(event)) {
						filtered.next(event);
					}
				} catch (error) {
					filtered.error(error as Error);
				}
			},
			error: (error) => filtered.error(error),
			complete: () => filtered.complete()
		});

		return filtered;
	}

	/**
	 * OPÉRATEUR : MAP - Transforme les événements
	 */
	map<U>(mapper: (event: Event<T>) => U): Observable<U> {
		const mapped = new Observable<U>();
		
		this.subscribe({
			next: (event) => {
				try {
					const transformedValue = mapper(event);
					mapped.next(transformedValue);
				} catch (error) {
					mapped.error(error as Error);
				}
			},
			error: (error) => mapped.error(error),
			complete: () => mapped.complete()
		});

		return mapped;
	}

	/**
	 * OPÉRATEUR: take - Limite le nombre d'événements
	 */
	take(count: number): EventObservable<T> {
		if (count <= 0) {
			const empty = new EventObservable<T>();
			setImmediate(() => empty.complete());
			return empty;
		}

		const taken = new EventObservable<T>();
		let received = 0;

		this.subscribe({
			next: (event) => {
				if (received < count) {
					taken.next(event);
					received++;
					
					if (received === count) {
						taken.complete();
					}
				}
			},
			error: (error) => taken.error(error),
			complete: () => taken.complete()
		});

		return taken;
	}

	/**
	 * OPÉRATEUR: skip - Ignore les premiers événements
	 */
	skip(count: number): EventObservable<T> {
		const skipped = new EventObservable<T>();
		let skippedCount = 0;

		this.subscribe({
			next: (event) => {
				if (skippedCount < count) {
					skippedCount++;
				} else {
					skipped.next(event);
				}
			},
			error: (error) => skipped.error(error),
			complete: () => skipped.complete()
		});

		return skipped;
	}

	/**
	 * OPÉRATEUR: debounce - Anti-spam avec timing précis
	 */
	debounce(delayMs: number): EventObservable<T> {
		const debounced = new EventObservable<T>();
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let lastEvent: Event<T> | null = null;

		this.subscribe({
			next: (event) => {
				lastEvent = event;
				
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				
				timeoutId = setTimeout(() => {
					if (lastEvent) {
						debounced.next(lastEvent);
						lastEvent = null;
					}
					timeoutId = null;
				}, delayMs);
			},
			error: (error) => {
				if (timeoutId) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}
				debounced.error(error);
			},
			complete: () => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				if (lastEvent) {
					debounced.next(lastEvent);
				}
				debounced.complete();
			}
		});

		return debounced;
	}

	/**
	 * OPÉRATEUR: throttle - Limite la fréquence d'émission
	 */
	throttle(intervalMs: number): EventObservable<T> {
		const throttled = new EventObservable<T>();
		let lastEmission = 0;
		let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

		this.subscribe({
			next: (event) => {
				const now = Date.now();
				const timeSinceLastEmission = now - lastEmission;

				if (timeSinceLastEmission >= intervalMs) {
					// Émettre immédiatement
					throttled.next(event);
					lastEmission = now;
				} else if (!pendingTimeout) {
					// Programmer la prochaine émission
					const delay = intervalMs - timeSinceLastEmission;
					pendingTimeout = setTimeout(() => {
						throttled.next(event);
						lastEmission = Date.now();
						pendingTimeout = null;
					}, delay);
				}
			},
			error: (error) => {
				if (pendingTimeout) {
					clearTimeout(pendingTimeout);
					pendingTimeout = null;
				}
				throttled.error(error);
			},
			complete: () => {
				if (pendingTimeout) {
					clearTimeout(pendingTimeout);
				}
				throttled.complete();
			}
		});

		return throttled;
	}

	/**
	 * OPÉRATEUR: distinct - Évite les doublons avec cache efficace
	 */
	distinct<K>(keySelector?: (event: Event<T>) => K): EventObservable<T> {
		const distinctStream = new EventObservable<T>();
		const seenKeys = new Set<K | string>();

		this.subscribe({
			next: (event) => {
				const key = keySelector ? keySelector(event) : event.id;
				
				if (!seenKeys.has(key)) {
					seenKeys.add(key);
					distinctStream.next(event);
				}
			},
			error: (error) => distinctStream.error(error),
			complete: () => distinctStream.complete()
		});

		return distinctStream;
	}

	/**
	 * OPÉRATEUR: distinctUntilChanged - Évite les doublons consécutifs
	 */
	distinctUntilChanged<K>(keySelector?: (event: Event<T>) => K): EventObservable<T> {
		const distinctStream = new EventObservable<T>();
		let lastKey: K | string | undefined;

		this.subscribe({
			next: (event) => {
				const key = keySelector ? keySelector(event) : event.id;
				
				if (key !== lastKey) {
					lastKey = key;
					distinctStream.next(event);
				}
			},
			error: (error) => distinctStream.error(error),
			complete: () => distinctStream.complete()
		});

		return distinctStream;
	}

	/**
	 * OPÉRATEUR: buffer - Groupe les événements par taille
	 */
	buffer(size: number): Observable<Event<T>[]> {
		const buffered = new Observable<Event<T>[]>();
		const buffer: Event<T>[] = [];

		this.subscribe({
			next: (event) => {
				buffer.push(event);
				
				if (buffer.length >= size) {
					buffered.next([...buffer]);
					buffer.length = 0;
				}
			},
			error: (error) => buffered.error(error),
			complete: () => {
				if (buffer.length > 0) {
					buffered.next([...buffer]);
				}
				buffered.complete();
			}
		});

		return buffered;
	}

	/**
	 * OPÉRATEUR: bufferTime - Groupe les événements par temps
	 */
	bufferTime(timeMs: number): Observable<Event<T>[]> {
		const buffered = new Observable<Event<T>[]>();
		const buffer: Event<T>[] = [];
		
		const intervalId = setInterval(() => {
			if (buffer.length > 0) {
				buffered.next([...buffer]);
				buffer.length = 0;
			}
		}, timeMs);

		this.subscribe({
			next: (event) => {
				buffer.push(event);
			},
			error: (error) => {
				clearInterval(intervalId);
				buffered.error(error);
			},
			complete: () => {
				clearInterval(intervalId);
				if (buffer.length > 0) {
					buffered.next([...buffer]);
				}
				buffered.complete();
			}
		});

		return buffered;
	}

	/**
	 * OPÉRATEUR: scan - Accumulation avec état
	 */
	scan<A>(accumulator: (acc: A, event: Event<T>) => A, seed: A): Observable<A> {
		const scanned = new Observable<A>();
		let accumulated = seed;

		this.subscribe({
			next: (event) => {
				try {
					accumulated = accumulator(accumulated, event);
					scanned.next(accumulated);
				} catch (error) {
					scanned.error(error as Error);
				}
			},
			error: (error) => scanned.error(error),
			complete: () => scanned.complete()
		});

		return scanned;
	}

	/**
	 * OPÉRATEUR: combineWith - Combine avec d'autres streams
	 */
	combineWith<U extends EventNames>(
		other: EventObservable<U>
	): EventObservable<T | U> {
		const combined = new EventObservable<T | U>();
		let completed = 0;

		const onComplete = () => {
			completed++;
			if (completed === 2) {
				combined.complete();
			}
		};

		this.subscribe({
			next: (event) => combined.next(event),
			error: (error) => combined.error(error),
			complete: onComplete
		});

		other.subscribe({
			next: (event) => combined.next(event),
			error: (error) => combined.error(error),
			complete: onComplete
		});

		return combined;
	}

	/**
	 * OPÉRATEUR: startWith - Commence avec des valeurs initiales
	 */
	startWith(...events: Event<T>[]): EventObservable<T> {
		const started = new EventObservable<T>();

		// Émettre les valeurs initiales de manière asynchrone
		setImmediate(() => {
			events.forEach(event => started.next(event));
		});

		this.subscribe({
			next: (event) => started.next(event),
			error: (error) => started.error(error),
			complete: () => started.complete()
		});

		return started;
	}

	/**
	 * Conversion vers Promise (premier événement)
	 */
	toPromise(): Promise<Event<T>> {
		return new Promise((resolve, reject) => {
			if (this.isCompleted && this.observers.size === 0) {
				reject(new Error('Stream already completed without emitting any value'));
				return;
			}

			const subscription = this.subscribe({
				next: (event) => {
					subscription.unsubscribe();
					resolve(event);
				},
				error: (error) => {
					subscription.unsubscribe();
					reject(error);
				},
				complete: () => {
					subscription.unsubscribe();
					reject(new Error('Stream completed without emitting any value'));
				}
			});
		});
	}

	/**
	 * Collecte tous les événements en array
	 */
	toArray(): Promise<Event<T>[]> {
		return new Promise((resolve, reject) => {
			const events: Event<T>[] = [];

			this.subscribe({
				next: (event) => events.push(event),
				error: (error) => reject(error),
				complete: () => resolve(events)
			});
		});
	}

	// MÉTHODES INTERNES
	next(event: Event<T>): void {
		if (this.isCompleted || this.hasError) return;

		// Optimisation: copier la liste pour éviter les modifications concurrentes
		const observersCopy = Array.from(this.observers);
		
		for (const observer of observersCopy) {
			try {
				observer.next?.(event);
			} catch (error) {
				// Isoler les erreurs par observer
				setTimeout(() => observer.error?.(error as Error), 0);
			}
		}
	}

	error(error: Error): void {
		if (this.isCompleted || this.hasError) return;
		
		this.hasError = true;
		const observersCopy = Array.from(this.observers);
		
		for (const observer of observersCopy) {
			try {
				observer.error?.(error);
			} catch (err) {
				console.error('Observer error handler failed:', err);
			}
		}
		
		this.observers.clear();
	}

	complete(): void {
		if (this.isCompleted || this.hasError) return;
		
		this.isCompleted = true;
		const observersCopy = Array.from(this.observers);
		
		for (const observer of observersCopy) {
			try {
				observer.complete?.();
			} catch (error) {
				console.error('Observer complete handler failed:', error);
			}
		}
		
		this.observers.clear();
	}

	// GETTERS UTILES
	get isClosed(): boolean {
		return this.isCompleted || this.hasError;
	}

	get observerCount(): number {
		return this.observers.size;
	}
}

/**
 * Observable générique pour valeurs transformées
 */
export class Observable<T> {
	private readonly observers = new Set<Observer<T>>();
	private isCompleted = false;
	private hasError = false;

	subscribe(observer: Observer<T> | ((value: T) => void)): Subscription {
		const observerObj = typeof observer === 'function' 
			? { next: observer } 
			: observer;

		this.observers.add(observerObj);

		return {
			unsubscribe: () => this.observers.delete(observerObj),
			closed: this.isCompleted || this.hasError,
			listenerId: `obs_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
		};
	}

	next(value: T): void {
		if (this.isCompleted || this.hasError) return;

		const observersCopy = Array.from(this.observers);
		for (const observer of observersCopy) {
			try {
				observer.next?.(value);
			} catch (error) {
				setTimeout(() => observer.error?.(error as Error), 0);
			}
		}
	}

	error(error: Error): void {
		if (this.isCompleted || this.hasError) return;
		
		this.hasError = true;
		const observersCopy = Array.from(this.observers);
		
		for (const observer of observersCopy) {
			try {
				observer.error?.(error);
			} catch (err) {
				console.error('Observer error handler failed:', err);
			}
		}
		
		this.observers.clear();
	}

	complete(): void {
		if (this.isCompleted || this.hasError) return;
		
		this.isCompleted = true;
		const observersCopy = Array.from(this.observers);
		
		for (const observer of observersCopy) {
			try {
				observer.complete?.();
			} catch (error) {
				console.error('Observer complete handler failed:', error);
			}
		}
		
		this.observers.clear();
	}
}

// FONCTIONS UTILITAIRES - Factory et combinaison
export function fromEvents<T extends EventNames>(events: Event<T>[]): EventObservable<T> {
	const stream = new EventObservable<T>();
	
	setImmediate(() => {
		for (const event of events) {
			stream.next(event);
		}
		stream.complete();
	});
	
	return stream;
}

export function fromPromise<T>(promise: Promise<T>): Observable<T> {
	const observable = new Observable<T>();
	
	promise
		.then(value => {
			observable.next(value);
			observable.complete();
		})
		.catch(error => observable.error(error));
	
	return observable;
}

export function interval(ms: number): Observable<number> {
	const observable = new Observable<number>();
	let count = 0;
	let isDisposed = false;
	
	const intervalId = setInterval(() => {
		if (!isDisposed) {
			observable.next(count++);
		}
	}, ms);
	
	// Cleanup lors de la completion
	const originalComplete = observable.complete.bind(observable);
	observable.complete = () => {
		isDisposed = true;
		clearInterval(intervalId);
		originalComplete();
	};
	
	return observable;
}

export function timer(delayMs: number, intervalMs?: number): Observable<number> {
	const observable = new Observable<number>();
	let count = 0;
	
	const timeoutId = setTimeout(() => {
		observable.next(count++);
		
		if (intervalMs) {
			const intervalId = setInterval(() => {
				observable.next(count++);
			}, intervalMs);
			
			// Cleanup automatique
			const originalComplete = observable.complete.bind(observable);
			observable.complete = () => {
				clearInterval(intervalId);
				originalComplete();
			};
		} else {
			observable.complete();
		}
	}, delayMs);
	
	return observable;
}

export function merge<T extends EventNames>(...streams: EventObservable<T>[]): EventObservable<T> {
	const merged = new EventObservable<T>();
	let completedStreams = 0;
	
	if (streams.length === 0) {
		setImmediate(() => merged.complete());
		return merged;
	}
	
	streams.forEach(stream => {
		stream.subscribe({
			next: (event) => merged.next(event),
			error: (error) => merged.error(error),
			complete: () => {
				completedStreams++;
				if (completedStreams === streams.length) {
					merged.complete();
				}
			}
		});
	});
	
	return merged;
}

export function race<T extends EventNames>(...streams: EventObservable<T>[]): EventObservable<T> {
	const raced = new EventObservable<T>();
	let isResolved = false;
	
	streams.forEach(stream => {
		stream.subscribe({
			next: (event) => {
				if (!isResolved) {
					isResolved = true;
					raced.next(event);
					raced.complete();
				}
			},
			error: (error) => {
				if (!isResolved) {
					isResolved = true;
					raced.error(error);
				}
			}
		});
	});
	
	return raced;
}