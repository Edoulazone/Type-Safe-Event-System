// On va définir ici tous les événements possibles dans notre système
export interface EventRegistry {
	// Événements utilisateur
	'user:login': {
		userId: string;
		timestamp: Date;
		ip?: string; // Le "?" est équivalent à ip: string | undefined, permet donc que cet élément soit optionnel
		userAgent?: string;
	};

	'user:logout': {
		userId: string;
		timestamp: Date;
		duration: number;
	};

	// Événements de commande
	'order:created': {
		orderId: string;
		userId: string;
		amount: number;
		items: string[];
		currency?: string;
	};

	'order:updated': {
		orderId: string;
		changes: Partial<Order>; // Type utilitaire qui permet de modifier seulement une partie de Order
		updatedBy: string;
	};

	// Événement de paiement
	'payment:processed': {
		paymentId: string;
		orderId: string;
		amount: number;
		method: 'credit_card' | 'paypal' | 'bank_transfer';
		status: 'success' | 'failed' | 'pending';
	};

	// Événement système
	'system:error': {
		error: Error;
		context: string;
		severity: 'low' | 'medium' | 'high' | 'critical';
		userId?: string;
	};

	// Événement de notification
	'notification:sent': {
		userId: string;
		type: 'email' | 'sms' | 'push';
		message: string;
		templateId?: string;
	};
}

// TYPES UTILITAIRES - Extraction automatique de types
// Ces types sont "calculés" automatiquement à partir d'EventRegistry
export type EventNames = keyof EventRegistry;
export type EventPayload<T extends EventNames> = EventRegistry[T];


// STRUCTURE D'UN ÉVÉNEMENT - Le format standard
// Chaque événement a cette structure, peu importe son type
export interface Event<T extends EventNames> {
	// Identite de l'event
	type: T;
	payload: EventPayload<T>;

	// Metadonnees automatiques
	id: string;
	timestamp: Date;

	// Metadonnees optionnelles
	source?: string;
	correlationId?: string;
	metadata?: Record<string, unknown>;
}


// TYPES POUR LES LISTENERS - Comment écouter les événements
// Un listener est une fonction qui réagit à un événement spécifique
export type EventListener<T extends EventNames> = (event: Event<T>) => void | Promise<void>;

// Un listener générique qui peut écouter n'importe quel événement
export type AnyEventListener = <T extends EventNames>(event: Event<T>) => void | Promise<void>;


// SUBSCRIPTION - Gérer l'abonnement aux événements
export interface Subscription {
	unsubscribe(): void;
	readonly closed: boolean;
}


// TYPES POUR LE FILTERING - Filtrer les événements
export interface EventFilter<T extends EventNames> {
	type?: T | T[];
	source?: string | string[];
	userId?: string;
	correlationId?: string;
	custom?: (event: Event<T>) => boolean;
}


// RÉSULTATS D'ÉMISSION - Feedback quand on émet un événement
export interface EmitResult<T extends EventNames> {
	eventId: string;
	type: T;
	listenersNotified: number;
	errors: EmitError[];
	duration: number;
}

export interface EmitError {
	listener: string;
	error: Error;
	event: Event<any>;
}


// INTERFACES MÉTIER - Types pour nos domaines
// Ces interfaces définissent les objets métier utilisés dans les événements
export interface Order {
	id: string;
	userId: string;
	amount: number;
	currency: string;
	status: 'confirmed' | 'shipped' | 'delivered' | 'pending' | 'cancelled';
	items: OrderItem[];
	createdAt: Date;
	updatedAt: Date;
}

export interface OrderItem {
	productId: string;
	name: string;
	quantity: number;
	unitPrice: number;
	totalPrice: number;
}

export interface User {
	id: string;
	email: string;
	name: string;
	role: 'user' | 'admin' | 'moderator';
	createdAt: Date;
	lastLoginAt?: Date;
}


// TYPES POUR LES OPTIONS - Configuration des comportements
export interface ListenerOptions {
	maxCalls?: number;
	timeout?: number;
	condition?: (event: Event<any>) => boolean;
	priority?: 'low' | 'normal' | 'high';
}

export interface EmitOptions {
	id?: string;
	source?: string;
	correlationId?: string;
	metadata?: Record<string, unknown>;
	timeout?: number;
}


// TYPES AVANCÉS - Utilisation de TypeScript avancé
// Type conditionnel : si T est un type d'événement user, extraire userId
export type ExtractUserId<T extends EventNames> =
	EventRegistry[T] extends {userId: string }
	? EventRegistry[T]['userId']
	: never;

// Type pour les événements qui ont un userId
export type UserEvents = {
	[K in EventNames]: EventRegistry[K] extends {userId: string} ? K : never;
}[EventNames];

// Type pour les événements système (sans userId)
export type SystemEvents = Exclude<EventNames, UserEvents>;

// Mapped type : rendre toutes les propriétés d'un payload optionnelles
export type PartialEventPayload<T extends EventNames> = {
	[K in keyof EventPayload<T>]?: EventPayload<T>[K];
};


// CONSTANTES ET ENUMS - Valeurs prédéfinies
export const EVENT_PRIORITIES = {
	LOW: 1,
	NORMAL: 5,
	HIGH: 10,
	CRITICAL: 15,
} as const;

export const DEFAULT_TIMEOUT = 5000;
export const MAX_LISTENERS_PER_EVENT = 100;
export const MAX_METADATA_SIZE = 1024;


// TYPE GUARDS - Vérifications de types à runtime
// Ces fonctions permettent de vérifier qu'un objet correspond bien à un type
export function isEvent<T extends EventNames>(obj: any, eventType: T): obj is Event<T> {
	return (
		obj &&
		typeof obj === 'object' &&
		obj.type === eventType &&
		typeof obj.id === 'string' &&
		obj.timestamp instanceof Date &&
		obj.payload !== undefined
	);
}

export function isValidEventType(type: string): type is EventNames {
	const validTypes: EventNames[] = [
	'user:login',
	'user:logout', 
	'order:created',
	'order:updated',
	'payment:processed',
	'system:error',
	'notification:sent'
	];
	return validTypes.includes(type as EventNames);
}

export function hasUserId(payload: any): payload is {userId: string} {
	return payload && typeof payload.userId === 'string';
}


// INTERFACES POUR L'EXTENSION - Permettre l'ajout de nouveaux types
// Cette interface peut être étendue par d'autres modules
declare global {
	namespace EventSystem {
		interface CustomEventRegistry {}
	}
}

// Fusion des types personnalisés avec les types de base
export type ExtendedEventRegistry = EventRegistry & EventSystem.CustomEventRegistry;


// EXEMPLE D'UTILISATION DE CES TYPES
/*
// Émission d'événement typé
const loginEvent: Event<'user:login'> = {
  type: 'user:login',
  payload: {
    userId: 'user123',
    timestamp: new Date(),
    ip: '192.168.1.1'
  },
  id: 'evt_123',
  timestamp: new Date()
};

// Listener typé automatiquement
const handleLogin: EventListener<'user:login'> = (event) => {
  // event.payload est automatiquement typé comme { userId: string, timestamp: Date, ip?: string }
  console.log(`User ${event.payload.userId} logged in from ${event.payload.ip}`);
};

// Filtre typé
const userEventFilter: EventFilter<'user:login'> = {
  type: 'user:login',
  custom: (event) => event.payload.ip?.startsWith('192.168')
};
*/