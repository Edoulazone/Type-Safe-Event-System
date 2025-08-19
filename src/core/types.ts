export interface EventRegistry {
	/** Événements d'authentification utilisateur */
	'user:login': {
		userId: string;
		timestamp: Date;
		ip?: string;
		userAgent?: string;
	};

	'user:logout': {
		userId: string;
		timestamp: Date;
		duration: number; // en secondes
	};

	/** Événements de commande e-commerce */
	'order:created': {
		orderId: string;
		userId: string;
		amount: number;
		items: string[];
		currency?: string;
	};

	'order:updated': {
		orderId: string;
		changes: Record<string, any>;
		updatedBy: string;
		timestamp: Date;
	};

	/** Événements de paiement */
	'payment:processed': {
		paymentId: string;
		orderId: string;
		amount: number;
		method: 'credit_card' | 'paypal' | 'bank_transfer' | 'crypto';
		status: 'success' | 'failed' | 'pending' | 'cancelled';
		timestamp: Date;
	};

	/** Événements système critiques */
	'system:error': {
		error: Error;
		context: string;
		severity: 'low' | 'medium' | 'high' | 'critical';
		userId?: string;
		stackTrace?: string;
	};

	/** Événements de notification */
	'notification:sent': {
		userId: string;
		type: 'email' | 'sms' | 'push' | 'slack';
		message: string;
		templateId?: string;
		deliveredAt: Date;
	};
}

// TYPES DE BASE
export type EventNames = keyof EventRegistry;
export type EventPayload<T extends EventNames> = EventRegistry[T];

export type EventId = string;
export type CorrelationId = string;
export type UserId = string;

// STRUCTURE D'ÉVÉNEMENT
export interface Event<T extends EventNames> {
	/** Type d'événement, sert de discriminant */
	type: T;
	/** Données spécifiques à ce type d'événement */
	payload: EventPayload<T>;
	/** Identifiant unique de l'événement */
	id: EventId;
	/** Horodatage de création */
	timestamp: Date;
	/** Source qui a émis l'événement */
	source?: string;
	/** ID pour tracer les événements liés */
	correlationId?: CorrelationId;
	/** Métadonnées additionnelles */
	metadata?: Record<string, unknown>;
}

// LISTENERS
export type EventListener<T extends EventNames> = (event: Event<T>) => void | Promise<void>;

// SUBSCRIPTION
export interface Subscription {
	unsubscribe: () => void;
	closed: boolean;
	listenerId: string;
}

// RÉSULTATS D'ÉMISSION
export interface EmitResult<T extends EventNames> {
	eventId: EventId;
	type: T;
	listenersNotified: number;
	errors: EmitError[];
	duration: number;
	success: boolean;
}

export interface EmitError {
	listenerId: string;
	error: Error;
	event: Event<any>;
	timestamp: Date;
}

// OPTIONS
export interface ListenerOptions {
	maxCalls?: number;
	timeout?: number;
	condition?: (event: Event<any>) => boolean;
	priority?: number; // 1-10, 10 étant le plus prioritaire
	once?: boolean;
}

export interface EmitOptions {
	id?: EventId;
	source?: string;
	correlationId?: CorrelationId;
	metadata?: Record<string, unknown>;
	timeout?: number;
	skipMiddleware?: boolean;
}

// CONSTANTES
export const EVENT_CONFIG = {
	PRIORITIES: {
		LOW: 1,
		NORMAL: 5,
		HIGH: 10,
	},
	TIMEOUTS: {
		DEFAULT: 5000,
		FAST: 1000,
		SLOW: 30000,
	},
	LIMITS: {
		MAX_LISTENERS_PER_EVENT: 100,
		MAX_METADATA_SIZE: 1024,
		MAX_PAYLOAD_SIZE: 10 * 1024, // 10KB
	}
} as const;

// TYPE GUARDS
export function isEvent<T extends EventNames>(
	obj: unknown, 
	eventType: T
): obj is Event<T> {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'type' in obj &&
		'payload' in obj &&
		'id' in obj &&
		'timestamp' in obj &&
		(obj as any).type === eventType &&
		typeof (obj as any).id === 'string' &&
		(obj as any).timestamp instanceof Date
	);
}

export function isValidEventType(type: unknown): type is EventNames {
	const validTypes: EventNames[] = [
		'user:login',
		'user:logout', 
		'order:created',
		'order:updated',
		'payment:processed',
		'system:error',
		'notification:sent'
	];
	return typeof type === 'string' && validTypes.includes(type as EventNames);
}

// FACTORY FUNCTIONS
export function createEventId(): EventId {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `evt_${timestamp}_${random}`;
}

export function createCorrelationId(): CorrelationId {
	return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function createUserId(id: string): UserId {
	return id;
}