import { Event, EventNames, EventListener, Subscription } from './types.js';


// INTERFACE OBSERVER - Comment observer un stream
export interface Observer<T> {
	next?(value: T): void;          // Quand une nouvelle valeur arrive
	error?(error: Error): void;     // Quand une erreur survient
	complete?(): void;              // Quand le stream se termine
}


// CLASSE PRINCIPALE : EventObservable
export class EventObservable<T extends EventNames = EventNames> {
	// Stockage des observers qui écoutent ce stream
	private observers = new Set<Observer<Event<T>>>();
	private isCompleted = false;
	private hasError = false;


	// MÉTHODE DE BASE : SUBSCRIBE - S'abonner au stream
	subscribe(observer: EventListener<T> | Observer<Event<T>>): Subscription {
		// Si c'est juste une fonction, la transformer en objet observer
		const observerObj = typeof observer === 'function' 
			? { next: observer } 
			: observer;

		// Ajouter à la liste des observers
		this.observers.add(observerObj);

		// Retourner subscription pour se désabonner
		return {
			unsubscribe: () => {
				this.observers.delete(observerObj);
			},
			closed: this.isCompleted || this.hasError
		};
	}


	// OPÉRATEUR : FILTER - Filtrer les événements
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
				// Si l'événement passe le test, le transmettre
				if (predicate(event)) {
					filtered.next(event);
				}
			},
			error: (error) => filtered.error(error),
			complete: () => filtered.complete()
		});

		return filtered;
	}


	// OPÉRATEUR : MAP - Transformer les événements
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

	
	// OPÉRATEUR : TAKE - Limiter le nombre d'événements
	take(count: number): EventObservable<T> {
		const taken = new EventObservable<T>();
		let received = 0;

		this.subscribe({
			next: (event) => {
				if (received < count) {
					taken.next(event);
					received++;
					
					// Fermer le stream après avoir reçu le nombre voulu
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

	
	// OPÉRATEUR : DEBOUNCE - Éviter le spam
	debounce(delayMs: number): EventObservable<T> {
		const debounced = new EventObservable<T>();
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let lastEvent: Event<T> | null = null;

		this.subscribe({
			next: (event) => {
				lastEvent = event;
				
				// Annuler le timeout précédent s'il existe
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				
				// Créer nouveau timeout
				timeoutId = setTimeout(() => {
					if (lastEvent) {
						debounced.next(lastEvent);
						lastEvent = null;
					}
				}, delayMs);
			},
			error: (error) => debounced.error(error),
			complete: () => {
				// Si le stream se ferme, émettre le dernier événement en attente
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

	
	// OPÉRATEUR : SKIP - Ignorer les premiers événements
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

	
	// OPÉRATEUR : COMBINE - Combiner avec autre stream
	combineWith<U extends EventNames>(
		other: EventObservable<U>
	): EventObservable<T | U> {
		const combined = new EventObservable<T | U>();

		// S'abonner aux deux streams
		this.subscribe({
			next: (event) => combined.next(event),
			error: (error) => combined.error(error)
		});

		other.subscribe({
			next: (event) => combined.next(event),
			error: (error) => combined.error(error)
		});

		return combined;
	}

	
	// OPÉRATEUR : DISTINCT - Éviter les doublons
	distinct<K>(keySelector?: (event: Event<T>) => K): EventObservable<T> {
		const distinctStream = new EventObservable<T>();
		const seenKeys = new Set<K | Event<T>>();

		this.subscribe({
			next: (event) => {
				const key = keySelector ? keySelector(event) : event;
				
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

	
	// MÉTHODES INTERNES - Gestion du stream
	next(event: Event<T>): void {
		if (this.isCompleted || this.hasError) return;

		this.observers.forEach(observer => {
			try {
				observer.next?.(event);
			} catch (error) {
				observer.error?.(error as Error);
			}
		});
	}

	// Signale une erreur à tous les observers
	error(error: Error): void {
		if (this.isCompleted || this.hasError) return;
		
		this.hasError = true;
		this.observers.forEach(observer => {
			observer.error?.(error);
		});
	}

	// Ferme le stream et notifie tous les observers
	complete(): void {
		if (this.isCompleted || this.hasError) return;
		
		this.isCompleted = true;
		this.observers.forEach(observer => {
			observer.complete?.();
		});
		this.observers.clear();
	}

	// Convertit vers Promise qui se résout au premier événement
	toPromise(): Promise<Event<T>> {
		return new Promise((resolve, reject) => {
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
}


// CLASSE : Observable Générique (pour les types non-événements)
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
			unsubscribe: () => {
				this.observers.delete(observerObj);
			},
			closed: this.isCompleted || this.hasError
		};
	}

	next(value: T): void {
		if (this.isCompleted || this.hasError) return;

		this.observers.forEach(observer => {
			try {
				observer.next?.(value);
			} catch (error) {
				observer.error?.(error as Error);
			}
		});
	}

	error(error: Error): void {
		if (this.isCompleted || this.hasError) return;
		
		this.hasError = true;
		this.observers.forEach(observer => {
			observer.error?.(error);
		});
	}

	complete(): void {
		if (this.isCompleted || this.hasError) return;
		
		this.isCompleted = true;
		this.observers.forEach(observer => {
			observer.complete?.();
		});
		this.observers.clear();
	}
}


// FONCTIONS UTILITAIRES - Création de streams
export function fromEvents<T extends EventNames>(events: Event<T>[]): EventObservable<T> {
	const stream = new EventObservable<T>();
	
	// Émettre tous les événements de manière asynchrone
	setTimeout(() => {
		events.forEach(event => stream.next(event));
		stream.complete();
	}, 0);
	
	return stream;
}

// Crée un stream qui émet un événement après un délai
export function delay<T extends EventNames>(event: Event<T>, delayMs: number): EventObservable<T> {
	const stream = new EventObservable<T>();
	
	setTimeout(() => {
		stream.next(event);
		stream.complete();
	}, delayMs);
	
	return stream;
}

// Combine plusieurs streams en un seul
export function merge<T extends EventNames>(...streams: EventObservable<T>[]): EventObservable<T> {
	const merged = new EventObservable<T>();
	let completedStreams = 0;
	
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


// EXEMPLE D'UTILISATION
/*
// Créer un stream
const stream = new EventObservable<'user:login'>();

// Chaîner des opérateurs
const processedStream = stream
	.filter(event => event.payload.userId.startsWith('admin'))  // Seulement les admins
	.debounce(1000)                                             // Éviter le spam
	.take(5)                                                    // Max 5 événements
	.distinct(event => event.payload.userId);                   // Pas de doublons

// S'abonner au résultat
processedStream.subscribe({
	next: (event) => {
		console.log(`Admin login: ${event.payload.userId}`);
	},
	error: (error) => {
		console.error('Stream error:', error);
	},
	complete: () => {
		console.log('Stream completed');
	}
});

// Émettre des événements dans le stream source
stream.next({
	type: 'user:login',
	payload: { userId: 'admin123', timestamp: new Date() },
	id: 'evt_1',
	timestamp: new Date()
});
*/