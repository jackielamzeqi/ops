import { useAuthStore, useKnowledgeStore } from '../store'
import type { TreeNode } from '../store/data'
import { KB_BRANCH, KB_OWNER, KB_REPO } from '../lib/githubKb'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

function TreeView({
  nodes,
  depth = 0,
  accessToken,
}: {
  nodes: TreeNode[]
  depth?: number
  accessToken: string | null
}) {
  const {
    currentPath,
    selectFile,
    expandedDirs,
    toggleDir,
    ensureDirLoaded,
    loadingDirs,
    loadedDirs,
    dirErrors,
  } = useKnowledgeStore()

  return (
    <div className="tree-node">
      {nodes.map((node) => {
        const isExpanded = expandedDirs.includes(node.path)
        const isActive = currentPath === node.path
        const isLoading = loadingDirs.includes(node.path)
        const dirError = dirErrors[node.path]
        const hasChildren = Boolean(node.children?.length) || node.type === 'folder'
        const showChildren = node.type === 'folder' && isExpanded
        const childNodes = node.children || []

        return (
          <div key={node.path}>
            <div
              className={`tree-item ${isActive ? 'active' : ''} ${node.type === 'folder' ? 'tree-item-folder' : 'tree-item-file'}`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => {
                if (node.type === 'folder') void toggleDir(node.path, accessToken)
                else void selectFile(node.path, accessToken)
              }}
            >
              {node.type === 'folder' ? (
                <>
                  <span className={`tree-chevron ${isExpanded ? 'open' : ''}`}>
                    {hasChildren ? '▶' : '·'}
                  </span>
                  <span className="tree-icon">📁</span>
                  <span className="tree-name" title={node.name}>{node.name}</span>
                  {isLoading ? (
                    <span className="tree-meta">同步中</span>
                  ) : node.fileCount !== undefined ? (
                    <span className="tree-meta">{node.fileCount}</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="tree-chevron" style={{ opacity: 0 }}>▶</span>
                  <span className="tree-icon">📄</span>
                  <span className="tree-name" title={node.name}>{node.name}</span>
                </>
              )}
            </div>
            {showChildren && (
              <div className="tree-children">
                {childNodes.length > 0 ? (
                  <TreeView nodes={childNodes} depth={depth + 1} accessToken={accessToken} />
                ) : isLoading ? (
                  <div
                    className="tree-status"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  >
                    正在从 GitHub 同步…
                  </div>
                ) : dirError ? (
                  <div
                    className="tree-status tree-status-error"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                    onClick={(e) => {
                      e.stopPropagation()
                      void ensureDirLoaded(node.path, accessToken, true)
                    }}
                    title="点击重试"
                  >
                    {dirError} · 点击重试
                  </div>
                ) : loadedDirs.includes(node.path) ? (
                  <div
                    className="tree-status"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  >
                    空目录
                  </div>
                ) : (
                  <div
                    className="tree-status"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  >
                    尚未同步
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function KnowledgePage() {
  const {
    tree,
    currentPath,
    currentContent,
    contentStatus,
    contentError,
    searchQuery,
    setSearchQuery,
    searchResults,
    selectFile,
    expandedDirs,
    ensureDirLoaded,
    loadingDirs,
    dirErrors,
  } = useKnowledgeStore()
  const { user, accessToken } = useAuthStore()
  const navigate = useNavigate()
  const [showSearch, setShowSearch] = useState(false)
  const canAccess = Boolean(user?.isWhitelisted && accessToken)
  const rootLoading = loadingDirs.includes('')
  const rootError = dirErrors['']

  // 进入页面：同步仓库根目录 + 默认已展开目录的 GitHub 最新列表
  useEffect(() => {
    if (!canAccess || !accessToken) return
    let cancelled = false
    ;(async () => {
      await ensureDirLoaded('', accessToken, false)
      if (cancelled) return
      for (const path of useKnowledgeStore.getState().expandedDirs) {
        if (cancelled) return
        await ensureDirLoaded(path, accessToken, false)
      }
    })()
    return () => {
      cancelled = true
    }
    // 仅在登录态变化时触发；expandedDirs 后续由 toggleDir 自行加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, accessToken])

  if (!canAccess) {
    return (
      <div className="kb-locked fade-in">
        <div className="kb-locked-card">
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>知识库已锁定</div>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            需使用白名单 GitHub 账号登录后才能查看内容，保障数据安全。
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>
            使用 GitHub 登录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ height: '100%' }}>
      <div className="kb-secure-banner">
        🔐 已通过 GitHub 账号 <strong>@{user?.username}</strong> 验证 · 同步{' '}
        <strong>
          {KB_OWNER}/{KB_REPO}
        </strong>
        @{KB_BRANCH}
        {rootLoading ? ' · 同步中…' : null}
        {rootError ? (
          <button
            type="button"
            className="kb-banner-retry"
            onClick={() => void ensureDirLoaded('', accessToken, true)}
          >
            根目录失败，点击重试
          </button>
        ) : null}
      </div>
      <div className="kb-layout">
        <div className="kb-sidebar">
          <div className="kb-search">
            <span className="kb-search-icon">🔍</span>
            <input
              type="text"
              placeholder="搜索知识库..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setShowSearch(e.target.value.length > 0)
              }}
              onFocus={() => setShowSearch(searchQuery.length > 0)}
            />
          </div>

          {showSearch && searchQuery ? (
            <div style={{ padding: '8px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', padding: '4px 8px' }}>
                {searchResults.length} 条结果
              </div>
              {searchResults.map((item) => (
                <div
                  key={item.path}
                  className={`tree-item tree-item-file ${currentPath === item.path ? 'active' : ''}`}
                  onClick={() => {
                    void selectFile(item.path, accessToken)
                    setShowSearch(false)
                    setSearchQuery('')
                  }}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px' }}
                >
                  <span style={{ fontWeight: 500, fontSize: '0.82rem' }}>{item.title}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>{item.path}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>{item.preview}</span>
                </div>
              ))}
              {searchResults.length === 0 && (
                <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.82rem' }}>
                  无匹配结果
                </div>
              )}
            </div>
          ) : (
            <TreeView nodes={tree} accessToken={accessToken} />
          )}
        </div>

        <div className="kb-content">
          {contentStatus === 'loading' && currentPath ? (
            <div className="kb-content-empty">
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 8 }}>正在从 GitHub 加载…</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {currentPath}
              </div>
            </div>
          ) : currentContent ? (
            <div>
              <div style={{ marginBottom: '16px', color: 'var(--color-text-tertiary)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                {currentPath}
                {contentStatus === 'error' && contentError ? (
                  <span style={{ color: '#fb923c', marginLeft: 8 }}>· {contentError}</span>
                ) : (
                  <span style={{ marginLeft: 8, color: 'var(--color-text-tertiary)' }}>· GitHub 最新</span>
                )}
              </div>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.9rem',
                lineHeight: 1.8,
              }}>
                {currentContent}
              </pre>
            </div>
          ) : (
            <div className="kb-content-empty">
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📚</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 8 }}>知识库</div>
              <div style={{ fontSize: '0.85rem' }}>
                从左侧选择文件查看内容<br />
                目录树会实时同步 GitHub 仓库最新文件
              </div>
              <div style={{ marginTop: 24, fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                {KB_OWNER}/{KB_REPO}@{KB_BRANCH}
                {expandedDirs.length ? ` · 已展开 ${expandedDirs.length} 个目录` : ''}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
