import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getCurrentSession, signOut as cognitoSignOut, getUserEmail } from '../services/auth';

interface AuthContextType {
    isAuthenticated: boolean;
    userEmail: string | null;
    loading: boolean;
    logout: () => void;
    refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    userEmail: null,
    loading: true,
    logout: () => { },
    refreshAuth: async () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = async () => {
        try {
            const session = await getCurrentSession();
            if (session && session.isValid()) {
                setIsAuthenticated(true);
                setUserEmail(session.getIdToken().payload.email || getUserEmail());
            } else {
                const token = localStorage.getItem('authToken');
                if (token) {
                    setIsAuthenticated(true);
                    setUserEmail(getUserEmail());
                } else {
                    setIsAuthenticated(false);
                    setUserEmail(null);
                }
            }
        } catch {
            const token = localStorage.getItem('authToken');
            setIsAuthenticated(!!token);
            setUserEmail(getUserEmail());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { checkAuth(); }, []);

    const logout = () => {
        cognitoSignOut();
        setIsAuthenticated(false);
        setUserEmail(null);
    };

    const refreshAuth = async () => {
        await checkAuth();
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, userEmail, loading, logout, refreshAuth }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
