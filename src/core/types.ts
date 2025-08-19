// REGISTRY D'ÉVÉNEMENTS - Plus strict et documenté
export interface EventRegistry {
	/** Événements d'authentification utilisateur */
	'user:login': {
		readonly userId: string;
		readonly timestamp: Date;
		readonly ip?: string;
		readonly userAgent?: string;
	};

	'user:logout': {
		readonly userId: string;
		readonly timestamp: Date;
		readonly duration: number; // en secondes
	};

	/** Événements de commande e-commerce */
	'order:created': {
		readonly orderId: string;
		readonly userId: string;
		readonly amount: number;
		readonly items: readonly string[];
		readonly currency?: string;
	};

	'order:updated': {
		readonly orderId: string;
		readonly changes: Partial<Order>;
		readonly updatedBy: string;
		readonly timestamp: Date;
	};

	/** Événements de paiement */
	'payment:processed': {
		readonly paymentId: string;
		readonly orderId: string;
		readonly amount: number;
		readonly method: PaymentMethod;
		readonly status: PaymentStatus;
		readonly timestamp: Date;
	};

	/** Événements système critiques */
	'system:error': {
		readonly error: Error;
		readonly context: string;
		readonly severity: ErrorSeverity;
		readonly userId?: string;
		readonly stackTrace?: string;
	};

	/** Événements de notification */
	'notification:sent': {
		readonly userId: string;
		readonly type: NotificationType;
		readonly message: string;
		readonly templateId?: string;
		readonly deliveredAt: Date;
	};
}

// TYPES UTILITAIRES - Plus expressifs
export type EventNames = keyof EventRegistry;
export type EventPayload<T extends EventNames> = EventRegistry[T];

// ENUMS - Plus type-safe que les unions de strings
export const enum PaymentMethod {
	CREDIT_CARD = 'credit_card',
	PAYPAL = 'paypal',
	BANK_TRANSFER = 'bank_transfer',
	CRYPTO = 'crypto'
}

export const enum PaymentStatus {
	SUCCESS = 'success',
	FAILED = 'failed',
	PENDING = 'pending',
	CANCELLED = 'cancelled'
}

export const enum ErrorSeverity {
	LOW = 'low',
	MEDIUM = 'medium',
	HIGH = 'high',
	CRITICAL = 'critical'
}

export const enum NotificationType {
	EMAIL = 'email',
	SMS = 'sms',
	PUSH = 'push',
	SLACK = 'slack'
}

// STRUCTURE D'ÉVÉNEMENT - Plus stricte
export interface Event<T extends EventNames> {
	/** Type d'événement, sert de discriminant */
	readonly type: T;
	/** Données spécifiques à ce type d'événement */
	readonly payload: EventPayload<T>;
	/** Identifiant unique de l'événement */
	readonly id: EventId;
	/** Horodatage de création */
	readonly timestamp: Date;
	/** Source qui a émis l'événement */
	readonly source?: string;
	/** ID pour tracer les événements liés */
	readonly correlationId?: CorrelationId;
	/** Métadonnées additionnelles */
	readonly metadata?: ReadonlyRecord<string, unknown>;
}

// BRANDED TYPES - Plus de sécurité
export type EventId = string & { readonly __brand: 'EventId' };
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };
export type UserId = string & { readonly __brand: 'UserId' };

// TYPE HELPERS
export type ReadonlyRecord<K extends string | number | symbol, V> = {
	readonly [P in K]: V;
};

// LISTENERS - Plus typés
export type EventListener<T extends EventNames> = (event: Event<T>) => void | Promise<void>;

export type AnyEventListener = {
	[K in EventNames]: (event: Event<K>) => void | Promise<void>;
}[EventNames];

// SUBSCRIPTION - Plus robuste
export interface Subscription {
	readonly unsubscribe: () => void;
	readonly closed: boolean;
	readonly eventType?: EventNames;
	readonly listenerId: string;
}

// RÉSULTATS D'ÉMISSION - Plus détaillés
export interface EmitResult<T extends EventNames> {
	readonly eventId: EventId;
	readonly type: T;
	readonly listenersNotified: number;
	readonly errors: readonly EmitError[];
	readonly duration: number;
	readonly success: boolean;
}

export interface EmitError {
	readonly listenerId: string;
	readonly error: Error;
	readonly event: Event<any>;
	readonly timestamp: Date;
}

// OPTIONS - Plus expressives
export interface ListenerOptions {
	readonly maxCalls?: number;
	readonly timeout?: number;
	readonly condition?: (event: Event<any>) => boolean;
	readonly priority?: ListenerPriority;
	readonly once?: boolean;
}

export interface EmitOptions {
	readonly id?: EventId;
	readonly source?: string;
	readonly correlationId?: CorrelationId;
	readonly metadata?: ReadonlyRecord<string, unknown>;
	readonly timeout?: number;
	readonly skipMiddleware?: boolean;
}

export const enum ListenerPriority {
	LOW = 1,
	NORMAL = 5,
	HIGH = 10,
	CRITICAL = 15,
	EMERGENCY = 20
}

// INTERFACES MÉTIER - Plus complètes
export interface Order {
	readonly id: string;
	readonly userId: UserId;
	readonly amount: number;
	readonly currency: string;
	readonly status: OrderStatus;
	readonly items: readonly OrderItem[];
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly version: number; // Pour optimistic locking
}

export interface OrderItem {
	readonly productId: string;
	readonly name: string;
	readonly quantity: number;
	readonly unitPrice: number;
	readonly totalPrice: number;
	readonly sku?: string;
}

export const enum OrderStatus {
	PENDING = 'pending',
	CONFIRMED = 'confirmed',
	SHIPPED = 'shipped',
	DELIVERED = 'delivered',
	CANCELLED = 'cancelled'
}

export interface User {
	readonly id: UserId;
	readonly email: string;
	readonly name: string;
	readonly role: UserRole;
	readonly createdAt: Date;
	readonly lastLoginAt?: Date;
	readonly isActive: boolean;
}

export const enum UserRole {
	USER = 'user',
	ADMIN = 'admin',
	MODERATOR = 'moderator',
	SYSTEM = 'system'
}

// TYPES AVANCÉS - Plus utiles
/** Extrait les événements qui ont une propriété userId */
export type UserEvents = {
	[K in EventNames]: EventRegistry[K] extends { userId: unknown } ? K : never;
}[EventNames];

/** Extrait les événements système (sans userId) */
export type SystemEvents = Exclude<EventNames, UserEvents>;

/** Extrait le userId d'un événement s'il existe */
export type ExtractUserId<T extends EventNames> =
	EventRegistry[T] extends { userId: infer U } ? U : never;

/** Rend toutes les propriétés d'un payload optionnelles */
export type PartialEventPayload<T extends EventNames> = {
	readonly [K in keyof EventPayload<T>]?: EventPayload<T>[K];
};

/** Type conditionnel pour les événements critiques */
export type CriticalEvents = {
	[K in EventNames]: EventRegistry[K] extends { severity: ErrorSeverity.CRITICAL } ? K : never;
}[EventNames];

// CONSTANTES - Plus organisées
export const EVENT_CONFIG = {
	PRIORITIES: {
		LOW: 1,
		NORMAL: 5,
		HIGH: 10,
		CRITICAL: 15,
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

// TYPE GUARDS - Plus robustes
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

export function hasUserId<T extends EventNames>(
	event: Event<T>
): event is Event<T> & { payload: { userId: string } } {
	return 'userId' in event.payload && typeof (event.payload as any).userId === 'string';
}

export function isUserEvent(eventType: EventNames): eventType is UserEvents {
	const userEventTypes: UserEvents[] = ['user:login', 'user:logout', 'order:created', 'notification:sent'];
	return userEventTypes.includes(eventType as UserEvents);
}

export function isSystemEvent(eventType: EventNames): eventType is SystemEvents {
	return !isUserEvent(eventType);
}

// FACTORY FUNCTIONS - Pour créer des objets typés
export function createEventId(): EventId {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `evt_${timestamp}_${random}` as EventId;
}

export function createCorrelationId(): CorrelationId {
	return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}` as CorrelationId;
}

export function createUserId(id: string): UserId {
	return id as UserId;
}

// VALIDATION SCHEMAS - Pour runtime validation
export const EventSchemas = {
	'user:login': {
		userId: { type: 'string', minLength: 1 },
		timestamp: { type: 'date' },
		ip: { type: 'string', optional: true },
		userAgent: { type: 'string', optional: true }
	},
	'order:created': {
		orderId: { type: 'string', minLength: 1 },
		userId: { type: 'string', minLength: 1 },
		amount: { type: 'number', min: 0 },
		items: { type: 'array', minLength: 1 },
		currency: { type: 'string', optional: true }
	}
	// ... autres schémas
} as const;

// EXTENSION INTERFACE - Pour l'extensibilité
declare global {
	namespace EventSystem {
		interface CustomEventRegistry extends EventRegistry {}
		interface CustomMetadata extends Record<string, unknown> {}
	}
}

export type ExtendedEventRegistry = EventRegistry & EventSystem.CustomEventRegistry;