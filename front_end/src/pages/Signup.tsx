import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signUp, confirmSignUp } from '../services/auth';

export default function Signup() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [step, setStep] = useState<'signup' | 'verify'>('signup');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSignup = async (e: FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setLoading(true);
        try {
            const result = await signUp(email, password);
            if (result.success) {
                setSuccess(result.message);
                setStep('verify');
            } else {
                setError(result.message);
            }
        } catch (err: any) {
            setError(err.message || 'Signup failed');
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await confirmSignUp(email, verificationCode);
            if (result.success) {
                setSuccess('Account verified! Redirecting to login...');
                setTimeout(() => navigate('/login'), 2000);
            } else {
                setError(result.message);
            }
        } catch (err: any) {
            setError(err.message || 'Verification failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-logo">
                    <h1>Data Archival Platform</h1>
                    <p>{step === 'signup' ? 'Create your account' : 'Verify your email'}</p>
                </div>

                {error && <div className="error-message">{error}</div>}
                {success && <div className="success-message">{success}</div>}

                {step === 'signup' ? (
                    <form onSubmit={handleSignup}>
                        <div className="form-group">
                            <label htmlFor="signup-email">Email Address</label>
                            <input
                                id="signup-email"
                                type="email"
                                className="form-input"
                                placeholder="name@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="signup-password">Password</label>
                            <input
                                id="signup-password"
                                type="password"
                                className="form-input"
                                placeholder="Min 8 characters"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={8}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="signup-confirm">Confirm Password</label>
                            <input
                                id="signup-confirm"
                                type="password"
                                className="form-input"
                                placeholder="Confirm your password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>

                        <button type="submit" className="btn btn-primary" disabled={loading} id="signup-submit">
                            {loading ? 'Creating Account...' : 'Create Account'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleVerify}>
                        <div className="form-group">
                            <label htmlFor="verify-code">Verification Code</label>
                            <input
                                id="verify-code"
                                type="text"
                                className="form-input"
                                placeholder="Enter the 6-digit code"
                                value={verificationCode}
                                onChange={(e) => setVerificationCode(e.target.value)}
                                required
                                maxLength={6}
                            />
                        </div>

                        <button type="submit" className="btn btn-primary" disabled={loading} id="verify-submit">
                            {loading ? 'Verifying...' : 'Verify Email'}
                        </button>
                    </form>
                )}

                <div className="auth-link">
                    Already have an account? <Link to="/login">Sign in</Link>
                </div>
            </div>
        </div>
    );
}
