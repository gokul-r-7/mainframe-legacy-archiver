/**
 * Auth service using Amazon Cognito Identity JS SDK.
 */
import {
    CognitoUserPool,
    CognitoUser,
    AuthenticationDetails,
    CognitoUserAttribute,
    CognitoUserSession,
} from 'amazon-cognito-identity-js';

const POOL_DATA = {
    UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_placeholder',
    ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || 'placeholder',
};

const userPool = new CognitoUserPool(POOL_DATA);

export interface AuthResult {
    success: boolean;
    message: string;
    token?: string;
    email?: string;
}

export function signUp(email: string, password: string): Promise<AuthResult> {
    return new Promise((resolve) => {
        const attrs = [
            new CognitoUserAttribute({ Name: 'email', Value: email }),
        ];

        userPool.signUp(email, password, attrs, [], (err, result) => {
            if (err) {
                resolve({ success: false, message: err.message || 'Signup failed' });
                return;
            }
            resolve({
                success: true,
                message: 'Verification code sent to your email',
                email: result?.user.getUsername(),
            });
        });
    });
}

export function confirmSignUp(email: string, code: string): Promise<AuthResult> {
    return new Promise((resolve) => {
        const user = new CognitoUser({ Username: email, Pool: userPool });
        user.confirmRegistration(code, true, (err) => {
            if (err) {
                resolve({ success: false, message: err.message || 'Verification failed' });
                return;
            }
            resolve({ success: true, message: 'Email verified successfully' });
        });
    });
}

export function signIn(email: string, password: string): Promise<AuthResult> {
    return new Promise((resolve) => {
        const user = new CognitoUser({ Username: email, Pool: userPool });
        const authDetails = new AuthenticationDetails({ Username: email, Password: password });

        user.authenticateUser(authDetails, {
            onSuccess: (session: CognitoUserSession) => {
                const token = session.getIdToken().getJwtToken();
                const userEmail = session.getIdToken().payload.email;
                localStorage.setItem('authToken', token);
                localStorage.setItem('userEmail', userEmail);
                resolve({ success: true, message: 'Login successful', token, email: userEmail });
            },
            onFailure: (err) => {
                resolve({ success: false, message: err.message || 'Login failed' });
            },
        });
    });
}

export function signOut(): void {
    const user = userPool.getCurrentUser();
    if (user) {
        user.signOut();
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('userEmail');
}

export function getCurrentSession(): Promise<CognitoUserSession | null> {
    return new Promise((resolve) => {
        const user = userPool.getCurrentUser();
        if (!user) {
            resolve(null);
            return;
        }
        user.getSession((err: Error | null, session: CognitoUserSession | null) => {
            if (err || !session?.isValid()) {
                resolve(null);
                return;
            }
            resolve(session);
        });
    });
}

export function getAuthToken(): string | null {
    return localStorage.getItem('authToken');
}

export function getUserEmail(): string | null {
    return localStorage.getItem('userEmail');
}
