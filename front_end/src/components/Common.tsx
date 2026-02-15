import { ReactNode } from 'react';

interface StatusBadgeProps {
    status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
    const normalized = status?.toUpperCase() || 'UNKNOWN';
    const classMap: Record<string, string> = {
        SUCCESS: 'badge-success',
        PASSED: 'badge-success',
        FAILED: 'badge-danger',
        RUNNING: 'badge-warning',
        PENDING: 'badge-info',
    };
    const className = classMap[normalized] || 'badge-info';
    return <span className={`badge ${className}`}>{normalized}</span>;
}

interface EmptyStateProps {
    icon?: string;
    title: string;
    subtitle?: string;
    action?: ReactNode;
}

export function EmptyState({ icon = '📭', title, subtitle, action }: EmptyStateProps) {
    return (
        <div className="empty-state">
            <div className="empty-state-icon">{icon}</div>
            <div className="empty-state-text">{title}</div>
            {subtitle && <div className="empty-state-hint">{subtitle}</div>}
            {action && <div style={{ marginTop: 16 }}>{action}</div>}
        </div>
    );
}

interface StatCardProps {
    label: string;
    value: string | number;
    color?: string;
}

export function StatCard({ label, value, color }: StatCardProps) {
    return (
        <div className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={color ? { color } : undefined}>
                {typeof value === 'number' ? value.toLocaleString() : value}
            </div>
        </div>
    );
}

interface LoadingSpinnerProps {
    size?: number;
    text?: string;
}

export function LoadingSpinner({ size = 40, text }: LoadingSpinnerProps) {
    return (
        <div className="loading-screen" style={{ minHeight: 200 }}>
            <div className="spinner" style={{ width: size, height: size }} />
            {text && <p>{text}</p>}
        </div>
    );
}
