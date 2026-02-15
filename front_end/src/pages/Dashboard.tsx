import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useAuth } from '../utils/AuthContext';
import {
    getMetadata, executeQuery, deleteData, deleteMetadata,
    MetadataItem, QueryResult,
} from '../services/api';

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899'];

export default function Dashboard() {
    const { userEmail, logout } = useAuth();
    const [activeTab, setActiveTab] = useState<'overview' | 'query' | 'jobs' | 'metadata'>('overview');
    const [metadata, setMetadata] = useState<MetadataItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('SELECT * FROM your_table LIMIT 10');
    const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
    const [queryLoading, setQueryLoading] = useState(false);
    const [queryError, setQueryError] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<{ database: string; table: string } | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => { loadMetadata(); }, []);

    const loadMetadata = async () => {
        setLoading(true);
        try {
            const items = await getMetadata();
            setMetadata(items);
        } catch (err) {
            console.error('Failed to load metadata:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleQuery = async () => {
        if (!query.trim()) return;
        setQueryLoading(true);
        setQueryError('');
        setQueryResult(null);
        try {
            const result = await executeQuery(query);
            if (result.status === 'SUCCEEDED') {
                setQueryResult(result);
            } else {
                setQueryError(result.error || 'Query failed');
            }
        } catch (err: any) {
            setQueryError(err.response?.data?.error || err.message || 'Query failed');
        } finally {
            setQueryLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteConfirm) return;
        setActionLoading(true);
        try {
            await deleteData(deleteConfirm.database, deleteConfirm.table);
            setDeleteConfirm(null);
            await loadMetadata();
        } catch (err: any) {
            console.error('Delete failed:', err);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteMetadata = async (jobId: string) => {
        try {
            await deleteMetadata(jobId);
            await loadMetadata();
        } catch (err) {
            console.error('Delete metadata failed:', err);
        }
    };

    // ─── Chart Data ───────────────────────────────────────────────────────────
    const successCount = metadata.filter((m) => m.status === 'SUCCESS').length;
    const failedCount = metadata.filter((m) => m.status === 'FAILED').length;
    const totalRows = metadata.reduce((sum, m) => sum + (m.source_row_count || 0), 0);

    const statusData = [
        { name: 'Success', value: successCount, fill: '#10b981' },
        { name: 'Failed', value: failedCount, fill: '#ef4444' },
    ].filter((d) => d.value > 0);

    const dailyData = metadata.reduce<Record<string, { date: string; jobs: number; rows: number }>>((acc, m) => {
        const date = m.start_time ? m.start_time.split('T')[0] : 'Unknown';
        if (!acc[date]) acc[date] = { date, jobs: 0, rows: 0 };
        acc[date].jobs += 1;
        acc[date].rows += m.source_row_count || 0;
        return acc;
    }, {});
    const dailyChartData = Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);

    const tableData = metadata.reduce<Record<string, { table: string; database: string; count: number }>>((acc, m) => {
        const key = `${m.database_name}.${m.table_name}`;
        if (!acc[key]) acc[key] = { table: m.table_name, database: m.database_name, count: 0 };
        acc[key].count += 1;
        return acc;
    }, {});
    const tableChartData = Object.values(tableData).sort((a, b) => b.count - a.count).slice(0, 10);

    return (
        <div className="layout">
            <nav className="navbar">
                <div className="navbar-brand">Data Archival Platform</div>
                <div className="navbar-nav">
                    <Link to="/" className="nav-link">Upload</Link>
                    <Link to="/dashboard" className="nav-link active">Dashboard</Link>
                </div>
                <div className="navbar-user">
                    <span className="navbar-email">{userEmail}</span>
                    <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
                </div>
            </nav>

            <main className="main-content">
                {/* ── Tabs ────────────────────────────────────────────────── */}
                <div className="tab-bar">
                    {(['overview', 'query', 'jobs', 'metadata'] as const).map((tab) => (
                        <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab)} id={`tab-${tab}`}>
                            {tab === 'overview' ? '📊 Overview' : tab === 'query' ? '🔍 Query' : tab === 'jobs' ? '⚙️ Jobs' : '📋 Metadata'}
                        </button>
                    ))}
                </div>

                {/* ── Overview Tab ──────────────────────────────────────── */}
                {activeTab === 'overview' && (
                    <div className="section">
                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-label">Total Jobs</div>
                                <div className="stat-value">{metadata.length}</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-label">Successful</div>
                                <div className="stat-value" style={{ color: 'var(--accent-success)' }}>{successCount}</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-label">Failed</div>
                                <div className="stat-value" style={{ color: 'var(--accent-danger)' }}>{failedCount}</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-label">Total Rows Processed</div>
                                <div className="stat-value">{totalRows.toLocaleString()}</div>
                            </div>
                        </div>

                        <div className="charts-grid">
                            <div className="chart-card">
                                <div className="chart-title">Jobs Over Time</div>
                                {dailyChartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={280}>
                                        <LineChart data={dailyChartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#2d3561" />
                                            <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                                            <YAxis stroke="#64748b" fontSize={12} />
                                            <Tooltip contentStyle={{ background: '#1a1f36', border: '1px solid #2d3561', borderRadius: 8, color: '#f1f5f9' }} />
                                            <Line type="monotone" dataKey="jobs" stroke="#6366f1" strokeWidth={2} dot={{ fill: '#6366f1', r: 4 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="empty-state"><div className="empty-state-text">No data yet</div></div>
                                )}
                            </div>

                            <div className="chart-card">
                                <div className="chart-title">Job Status Distribution</div>
                                {statusData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={280}>
                                        <PieChart>
                                            <Pie data={statusData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value" label>
                                                {statusData.map((entry, idx) => (
                                                    <Cell key={idx} fill={entry.fill} />
                                                ))}
                                            </Pie>
                                            <Legend />
                                            <Tooltip contentStyle={{ background: '#1a1f36', border: '1px solid #2d3561', borderRadius: 8, color: '#f1f5f9' }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="empty-state"><div className="empty-state-text">No data yet</div></div>
                                )}
                            </div>

                            <div className="chart-card">
                                <div className="chart-title">Rows Processed Over Time</div>
                                {dailyChartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={280}>
                                        <BarChart data={dailyChartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#2d3561" />
                                            <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                                            <YAxis stroke="#64748b" fontSize={12} />
                                            <Tooltip contentStyle={{ background: '#1a1f36', border: '1px solid #2d3561', borderRadius: 8, color: '#f1f5f9' }} />
                                            <Bar dataKey="rows" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="empty-state"><div className="empty-state-text">No data yet</div></div>
                                )}
                            </div>

                            <div className="chart-card">
                                <div className="chart-title">Jobs by Table</div>
                                {tableChartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={280}>
                                        <BarChart data={tableChartData} layout="vertical">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#2d3561" />
                                            <XAxis type="number" stroke="#64748b" fontSize={12} />
                                            <YAxis type="category" dataKey="table" stroke="#64748b" fontSize={12} width={120} />
                                            <Tooltip contentStyle={{ background: '#1a1f36', border: '1px solid #2d3561', borderRadius: 8, color: '#f1f5f9' }} />
                                            <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="empty-state"><div className="empty-state-text">No data yet</div></div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Query Tab ─────────────────────────────────────────── */}
                {activeTab === 'query' && (
                    <div className="section">
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">Athena Query Editor</div>
                                <div className="card-subtitle">Execute SQL queries against your archived data</div>
                            </div>

                            <textarea
                                className="query-editor"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="SELECT * FROM your_table LIMIT 10"
                                id="query-input"
                            />

                            <div className="query-actions">
                                <button className="btn btn-primary btn-sm" onClick={handleQuery} disabled={queryLoading} id="run-query-btn">
                                    {queryLoading ? '⏳ Running...' : '▶ Run Query'}
                                </button>
                                {queryResult && (
                                    <span className="query-stats">
                                        {queryResult.row_count} rows • {(queryResult.statistics.data_scanned_bytes / 1024).toFixed(1)} KB scanned
                                        • {queryResult.statistics.execution_time_ms}ms
                                    </span>
                                )}
                            </div>

                            {queryError && <div className="error-message" style={{ marginTop: 16 }}>{queryError}</div>}

                            {queryResult && queryResult.data.length > 0 && (
                                <div className="table-container" style={{ marginTop: 20 }}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>{queryResult.columns.map((col) => <th key={col}>{col}</th>)}</tr>
                                        </thead>
                                        <tbody>
                                            {queryResult.data.map((row, i) => (
                                                <tr key={i}>
                                                    {queryResult.columns.map((col) => <td key={col}>{row[col] ?? ''}</td>)}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Jobs Tab ──────────────────────────────────────────── */}
                {activeTab === 'jobs' && (
                    <div className="section">
                        <div className="section-header">
                            <div className="section-title">Job Status</div>
                            <button className="btn btn-secondary btn-sm" onClick={loadMetadata} id="refresh-jobs-btn">🔄 Refresh</button>
                        </div>

                        {loading ? (
                            <div className="loading-screen" style={{ minHeight: 200 }}>
                                <div className="spinner" />
                            </div>
                        ) : metadata.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-icon">📭</div>
                                <div className="empty-state-text">No jobs found</div>
                                <div className="empty-state-hint">Upload files to start archiving data</div>
                            </div>
                        ) : (
                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Job ID</th>
                                            <th>Database</th>
                                            <th>Table</th>
                                            <th>Status</th>
                                            <th>Validation</th>
                                            <th>Rows</th>
                                            <th>Duration</th>
                                            <th>Archived By</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {metadata.map((item) => (
                                            <tr key={item.job_id}>
                                                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.job_id.slice(0, 8)}...</td>
                                                <td>{item.database_name}</td>
                                                <td>{item.table_name}</td>
                                                <td>
                                                    <span className={`badge ${item.status === 'SUCCESS' ? 'badge-success' : item.status === 'FAILED' ? 'badge-danger' : 'badge-warning'}`}>
                                                        {item.status || 'RUNNING'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`badge ${item.validation_status === 'PASSED' ? 'badge-success' : item.validation_status === 'FAILED' ? 'badge-danger' : 'badge-info'}`}>
                                                        {item.validation_status || 'N/A'}
                                                    </span>
                                                </td>
                                                <td>{item.source_row_count?.toLocaleString() || 'N/A'}</td>
                                                <td>{item.duration || 'N/A'}</td>
                                                <td>{item.archived_by}</td>
                                                <td>
                                                    <button className="btn btn-danger btn-sm" style={{ padding: '4px 10px', fontSize: 12 }}
                                                        onClick={() => setDeleteConfirm({ database: item.database_name, table: item.table_name })}>
                                                        🗑️
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Metadata Tab ─────────────────────────────────────── */}
                {activeTab === 'metadata' && (
                    <div className="section">
                        <div className="section-header">
                            <div className="section-title">Metadata Logs</div>
                            <button className="btn btn-secondary btn-sm" onClick={loadMetadata}>🔄 Refresh</button>
                        </div>

                        {metadata.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-icon">📋</div>
                                <div className="empty-state-text">No metadata logs</div>
                            </div>
                        ) : (
                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>File Name</th>
                                            <th>Table</th>
                                            <th>Database</th>
                                            <th>Archived By</th>
                                            <th>Start Time</th>
                                            <th>End Time</th>
                                            <th>Duration</th>
                                            <th>Validation</th>
                                            <th>Error</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {metadata.map((item) => (
                                            <tr key={item.job_id}>
                                                <td>{item.file_name}</td>
                                                <td>{item.table_name}</td>
                                                <td>{item.database_name}</td>
                                                <td>{item.archived_by}</td>
                                                <td style={{ fontSize: 12 }}>{item.start_time ? new Date(item.start_time).toLocaleString() : 'N/A'}</td>
                                                <td style={{ fontSize: 12 }}>{item.end_time ? new Date(item.end_time).toLocaleString() : 'N/A'}</td>
                                                <td>{item.duration}</td>
                                                <td>
                                                    <span className={`badge ${item.validation_status === 'PASSED' ? 'badge-success' : 'badge-danger'}`}>
                                                        {item.validation_status || 'N/A'}
                                                    </span>
                                                </td>
                                                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                    title={item.error_message}>{item.error_message || '—'}</td>
                                                <td>
                                                    <button className="btn btn-danger btn-sm" style={{ padding: '4px 10px', fontSize: 12 }}
                                                        onClick={() => handleDeleteMetadata(item.job_id)}>
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* ── Delete Confirmation Modal ──────────────────────────── */}
            {deleteConfirm && (
                <div className="modal-overlay" onClick={() => !actionLoading && setDeleteConfirm(null)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-title">⚠️ Confirm Deletion</div>
                        <div className="modal-text">
                            This will permanently delete all data for <strong>{deleteConfirm.database}.{deleteConfirm.table}</strong> including
                            S3 objects, Athena/Iceberg table, and metadata records. This cannot be undone.
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)} disabled={actionLoading}>Cancel</button>
                            <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={actionLoading} id="confirm-delete-btn">
                                {actionLoading ? 'Deleting...' : 'Delete Everything'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
