// Personal Ops 类型定义

// 用户与认证
export interface AuthUser {
  id: string
  username: string
  avatar: string
  isWhitelisted: boolean
  loginAt: number
  sessionExpiresAt: number
  isPersonalDevice: boolean
}

export type AuthState =
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'not_whitelisted'
  | 'expired'
  | 'offline'
  | 'github_revoked'
  | 'account_removed'
  | 'temporary_device'

// 知识库
export interface KBFile {
  id: string
  path: string
  name: string
  type: 'file' | 'dir'
  content?: string
  sha: string
  size: number
  lastModified: string
  encoding?: string
}

export interface KBDoc {
  id: string
  path: string
  title: string
  content: string
  sha: string
  lastModified: string
  author: string
  tags: string[]
  category: string
}

// 任务看板
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: 'user' | 'ai'
  labels: string[]
  createdAt: string
  updatedAt: string
  dueDate?: string
}

// AI 审批
export type AIJobStatus = 'pending' | 'approved' | 'rejected' | 'modified'
export type AIJobType = 'summarize' | 'decompose' | 'research' | 'edit_prd' | 'weekly_report' | 'custom'

export interface AIJob {
  id: string
  type: AIJobType
  title: string
  description: string
  targetFile?: string
  originalContent?: string
  proposedContent?: string
  diff?: string
  status: AIJobStatus
  createdAt: string
  feedback?: string
}

// 导航
export type PageId = 'home' | 'tasks' | 'knowledge' | 'ai' | 'approval' | 'settings'

// 设备类型
export type DeviceType = 'mobile' | 'tablet' | 'desktop'
