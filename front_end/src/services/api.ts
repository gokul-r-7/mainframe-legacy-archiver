/**
 * API service for backend communication.
 */
import axios, { AxiosInstance, AxiosError } from 'axios';
import { getAuthToken } from './auth';

const API_BASE = import.meta.env.VITE_API_ENDPOINT || 'http://localhost:3001';

const api: AxiosInstance = axios.create({
    baseURL: API_BASE,
    timeout: 60000,
    headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach auth token
api.interceptors.request.use((config) => {
    const token = getAuthToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor: handle auth errors
api.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userEmail');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// ─── Upload APIs ──────────────────────────────────────────────────────────

export interface PresignedUrlRequest {
    file_name: string;
    file_type: string;
    database: string;
    table: string;
}

export interface PresignedUrlResponse {
    presigned_url: string;
    s3_key: string;
    bucket: string;
}

export async function getPresignedUrl(data: PresignedUrlRequest): Promise<PresignedUrlResponse> {
    const resp = await api.post('/presigned-url', data);
    return resp.data;
}

export async function uploadFileToS3(presignedUrl: string, file: File, contentType: string): Promise<void> {
    await axios.put(presignedUrl, file, {
        headers: { 'Content-Type': contentType },
    });
}

export interface StartPipelineRequest {
    files: Array<{ s3_key: string; file_type: string; file_name: string }>;
    database: string;
    table: string;
    load_type: string;
}

export interface JobResult {
    job_id: string;
    execution_arn: string;
    s3_key: string;
    status: string;
}

export async function startPipeline(data: StartPipelineRequest): Promise<{ message: string; jobs: JobResult[] }> {
    const resp = await api.post('/upload', data);
    return resp.data;
}

// ─── Metadata APIs ────────────────────────────────────────────────────────

export interface MetadataItem {
    job_id: string;
    file_name: string;
    table_name: string;
    database_name: string;
    archived_by: string;
    start_time: string;
    end_time: string;
    duration: string;
    validation_status: string;
    error_message: string;
    status: string;
    source_row_count?: number;
    target_row_count?: number;
}

export async function getMetadata(email?: string, limit = 50): Promise<MetadataItem[]> {
    const params = new URLSearchParams();
    if (email) params.append('email', email);
    params.append('limit', String(limit));
    const resp = await api.get(`/metadata?${params.toString()}`);
    return resp.data.items || [];
}

export async function getJobs(): Promise<MetadataItem[]> {
    const resp = await api.get('/jobs');
    return resp.data.items || [];
}

export async function deleteMetadata(jobId: string): Promise<void> {
    await api.delete(`/metadata/${jobId}`);
}

// ─── Query APIs ───────────────────────────────────────────────────────────

export interface QueryResult {
    status: string;
    query_execution_id: string;
    columns: string[];
    column_types: string[];
    data: Record<string, string>[];
    row_count: number;
    statistics: { data_scanned_bytes: number; execution_time_ms: number };
    error?: string;
}

export async function executeQuery(query: string, database?: string): Promise<QueryResult> {
    const resp = await api.post('/query', { query, database, action: 'query' });
    return resp.data;
}

export async function listTables(database?: string): Promise<QueryResult> {
    const resp = await api.post('/query', { action: 'list_tables', database });
    return resp.data;
}

// ─── Delete APIs ──────────────────────────────────────────────────────────

export interface DeleteResult {
    database: string;
    table: string;
    status: string;
    steps: Array<{ action: string; status: string; deleted_objects?: number }>;
}

export async function deleteData(database: string, table: string): Promise<DeleteResult> {
    const resp = await api.delete(`/data/${database}/${table}`);
    return resp.data;
}

export default api;
