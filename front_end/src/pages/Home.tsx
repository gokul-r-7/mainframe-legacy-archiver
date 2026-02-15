import { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { useAuth } from '../utils/AuthContext';
import { getPresignedUrl, uploadFileToS3, startPipeline } from '../services/api';

interface UploadFile {
    file: File;
    id: string;
    progress: number;
    status: 'pending' | 'uploading' | 'uploaded' | 'error';
    s3Key?: string;
    error?: string;
}

const FILE_TYPES = [
    { value: 'csv', label: 'CSV (.csv)' },
    { value: 'parquet', label: 'Parquet (.parquet)' },
    { value: 'xlsx', label: 'Excel (.xlsx)' },
    { value: 'xls', label: 'Excel (.xls)' },
    { value: 'xml', label: 'XML (.xml)' },
    { value: 'yaml', label: 'YAML (.yaml)' },
    { value: 'json', label: 'JSON (.json)' },
];

const LOAD_TYPES = [
    { value: 'full', label: 'Full Load (Overwrite)' },
    { value: 'incremental', label: 'Incremental (Append)' },
];

export default function Home() {
    const navigate = useNavigate();
    const { userEmail, logout } = useAuth();
    const [files, setFiles] = useState<UploadFile[]>([]);
    const [fileType, setFileType] = useState('csv');
    const [loadType, setLoadType] = useState('full');
    const [database, setDatabase] = useState('');
    const [table, setTable] = useState('');
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const newFiles = acceptedFiles.map((file) => ({
            file,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            progress: 0,
            status: 'pending' as const,
        }));
        setFiles((prev) => [...prev, ...newFiles]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        multiple: true,
    });

    const removeFile = (id: string) => {
        setFiles((prev) => prev.filter((f) => f.id !== id));
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const handleUpload = async () => {
        setError('');
        setSuccess('');

        if (!database.trim()) { setError('Database name is required'); return; }
        if (!table.trim()) { setError('Table name is required'); return; }
        if (files.length === 0) { setError('Please select at least one file'); return; }

        setProcessing(true);

        try {
            const uploadedFiles: { s3_key: string; file_type: string; file_name: string }[] = [];

            for (let i = 0; i < files.length; i++) {
                const uploadFile = files[i];
                setFiles((prev) => prev.map((f) => f.id === uploadFile.id ? { ...f, status: 'uploading' } : f));

                try {
                    // Get presigned URL
                    const contentTypeMap: Record<string, string> = {
                        csv: 'text/csv', parquet: 'application/octet-stream',
                        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        xls: 'application/vnd.ms-excel', xml: 'application/xml',
                        yaml: 'application/x-yaml', yml: 'application/x-yaml', json: 'application/json',
                    };

                    const presigned = await getPresignedUrl({
                        file_name: uploadFile.file.name,
                        file_type: fileType,
                        database: database.trim(),
                        table: table.trim(),
                    });

                    // Upload to S3
                    await uploadFileToS3(
                        presigned.presigned_url,
                        uploadFile.file,
                        contentTypeMap[fileType] || 'application/octet-stream'
                    );

                    setFiles((prev) => prev.map((f) =>
                        f.id === uploadFile.id ? { ...f, status: 'uploaded', s3Key: presigned.s3_key, progress: 100 } : f
                    ));

                    uploadedFiles.push({
                        s3_key: presigned.s3_key,
                        file_type: fileType,
                        file_name: uploadFile.file.name,
                    });

                } catch (err: any) {
                    setFiles((prev) => prev.map((f) =>
                        f.id === uploadFile.id ? { ...f, status: 'error', error: err.message } : f
                    ));
                }
            }

            if (uploadedFiles.length > 0) {
                // Start pipeline
                const result = await startPipeline({
                    files: uploadedFiles,
                    database: database.trim(),
                    table: table.trim(),
                    load_type: loadType,
                });

                setSuccess(`Pipeline started for ${uploadedFiles.length} file(s). ${result.jobs?.length || 0} job(s) queued.`);
            }
        } catch (err: any) {
            setError(err.message || 'Upload failed');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="layout">
            <nav className="navbar">
                <div className="navbar-brand">Data Archival Platform</div>
                <div className="navbar-nav">
                    <Link to="/" className="nav-link active">Upload</Link>
                    <Link to="/dashboard" className="nav-link">Dashboard</Link>
                </div>
                <div className="navbar-user">
                    <span className="navbar-email">{userEmail}</span>
                    <button className="btn btn-secondary btn-sm" onClick={logout} id="logout-btn">Logout</button>
                </div>
            </nav>

            <main className="main-content">
                <div className="section">
                    <h1 className="section-title" style={{ marginBottom: 8 }}>Upload & Archive Data</h1>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
                        Upload flat files to be archived in the cloud data lake with automatic schema detection and validation.
                    </p>

                    {error && <div className="error-message">{error}</div>}
                    {success && <div className="success-message">{success}</div>}

                    <div className="card" style={{ marginBottom: 24 }}>
                        <div className="card-header">
                            <div className="card-title">Configuration</div>
                            <div className="card-subtitle">Set the target database, table, file format, and load type</div>
                        </div>

                        <div className="form-grid">
                            <div className="form-group">
                                <label htmlFor="db-name">Database Name</label>
                                <input
                                    id="db-name"
                                    type="text"
                                    className="form-input"
                                    placeholder="e.g., analytics_db"
                                    value={database}
                                    onChange={(e) => setDatabase(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="table-name">Table Name</label>
                                <input
                                    id="table-name"
                                    type="text"
                                    className="form-input"
                                    placeholder="e.g., customer_records"
                                    value={table}
                                    onChange={(e) => setTable(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="file-type">File Type</label>
                                <select id="file-type" className="form-select" value={fileType} onChange={(e) => setFileType(e.target.value)}>
                                    {FILE_TYPES.map((ft) => (
                                        <option key={ft.value} value={ft.value}>{ft.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label htmlFor="load-type">Load Type</label>
                                <select id="load-type" className="form-select" value={loadType} onChange={(e) => setLoadType(e.target.value)}>
                                    {LOAD_TYPES.map((lt) => (
                                        <option key={lt.value} value={lt.value}>{lt.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="card" style={{ marginBottom: 24 }}>
                        <div className="card-header">
                            <div className="card-title">Upload Files</div>
                            <div className="card-subtitle">Drag and drop files or click to browse. Multiple files supported.</div>
                        </div>

                        <div {...getRootProps()} className={`upload-zone ${isDragActive ? 'active' : ''}`} id="upload-dropzone">
                            <input {...getInputProps()} />
                            <div className="upload-zone-icon">📁</div>
                            <div className="upload-zone-text">
                                {isDragActive ? 'Drop files here...' : 'Drag & drop files here, or click to browse'}
                            </div>
                            <div className="upload-zone-hint">CSV, Excel, Parquet, XML, YAML, JSON</div>
                        </div>

                        {files.length > 0 && (
                            <div className="file-list">
                                {files.map((f) => (
                                    <div key={f.id} className="file-item">
                                        <div className="file-info">
                                            <span className="file-icon">
                                                {f.status === 'uploaded' ? '✅' : f.status === 'uploading' ? '⏳' : f.status === 'error' ? '❌' : '📄'}
                                            </span>
                                            <div>
                                                <div className="file-name">{f.file.name}</div>
                                                <div className="file-size">
                                                    {formatFileSize(f.file.size)}
                                                    {f.status === 'error' && <span style={{ color: 'var(--accent-danger)', marginLeft: 8 }}>{f.error}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <button className="file-remove" onClick={() => removeFile(f.id)} title="Remove">✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        className="btn btn-primary"
                        onClick={handleUpload}
                        disabled={processing || files.length === 0}
                        style={{ maxWidth: 300 }}
                        id="start-upload-btn"
                    >
                        {processing ? 'Processing...' : `Upload & Archive ${files.length} File${files.length !== 1 ? 's' : ''}`}
                    </button>
                </div>
            </main>
        </div>
    );
}
