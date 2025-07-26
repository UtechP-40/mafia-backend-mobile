// Admin Model exports
export * from './SuperUser';
export * from './AdminLog';
export * from './SystemMetric';
export * from './AdminSession';
export * from './EmailApproval';

// Re-export commonly used types for convenience
export type { ISuperUser, Permission } from './SuperUser';
export type { IAdminLog, LogLevel, ActionType, RequestInfo, ResponseInfo } from './AdminLog';
export type { ISystemMetric, MetricType, MetricUnit, AlertThreshold } from './SystemMetric';
export type { IAdminSession, SessionStatus, SessionActivity } from './AdminSession';
export type { IEmailApproval, ApprovalType, ApprovalStatus, Priority, ApprovalData } from './EmailApproval';

// Re-export enums
export { SuperUserStatus } from './SuperUser';
export { SessionStatus as AdminSessionStatus } from './AdminSession';

// Model instances for direct use
export { SuperUser } from './SuperUser';
export { AdminLog } from './AdminLog';
export { SystemMetric } from './SystemMetric';
export { AdminSession } from './AdminSession';
export { EmailApproval } from './EmailApproval';