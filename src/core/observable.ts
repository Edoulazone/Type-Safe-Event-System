import { Event, EventNames, EventListener, Subscription } from './types';

/**
 * Observer pattern simplifié pour les événements
 */
export interface Observer<T> {
	next?(value: T): void;
	error?(error: Error): void;
	complete?(): void;
}

/**
 * Observable spécialisé pour les événements
 * Garde seulement les opérateurs essentiels pour les performances
 */
export class EventObservable<T extends EventNames = EventNames> {
	private observers = new Set<Observer<Event<T>>>();
	private isCompleted = false;
	private hasError = false;

	/**
	 * Souscrit à l'observable
	 */
	subscribe(observer: EventListener<T> | Observer<Event<T>>): Subscription {
		if (this.isCompleted || this.hasError) {
			throw new Error('Cannot subscribe to completed or errored observable');
		}

		const observerObj = typeof observer === 'function' 
			? { next: observer } 
			: observer;

		this.observers.add(observerObj);
		
		const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

		return {
			unsubscribe: () => {
				this.observers.delete(observerObj);
			},
			closed: this.isCompleted || this.hasError,
			listenerId: subscriptionId
		};
	}

	/**
	 * OPÉRATEUR : FILTER - Filtrer les événements
	 */
	filter(predicate: (event: Event<T>) => boolean): EventObservable<T> {
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
	 * OPÉRATEUR: TAKE - Limite le nombre d'événements
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
	 * OPÉRATEUR: SKIP - Ignore les premiers événements
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
	 * OPÉRATEUR: DEBOUNCE - Anti-spam simplifié
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

	// MÉTHODES INTERNES
	next(event: Event<T>): void {
		if (this.isCompleted || this.hasError) return;
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
	private observers = new Set<Observer<T>>();
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

// FONCTIONS UTILITAIRES
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