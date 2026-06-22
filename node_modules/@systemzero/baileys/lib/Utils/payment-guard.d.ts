export interface PaymentGuardHooks {
    isPaymentMessage: (webMessage: any) => boolean;
    recordEnvelope?: (webMessage: any, isPayment: boolean) => void;
    onDetect: (detection: {
        type: 'direct' | 'edited' | 'undecryptable';
        remoteJid: string;
        participant?: string;
        messageId?: string;
        isPreKeyError?: boolean;
        errorMessage?: string;
    }) => void;
    treatDecryptFailureAsSuspicious?: boolean;
}

export declare const bindPaymentGuard: (sock: any, hooks: PaymentGuardHooks) => () => void;
