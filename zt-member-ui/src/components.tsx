import React, { useState, useEffect, useRef } from 'react'
import {
  Member,
  AuthFilter,
  SortKey,
  statusColor,
  statusLabel,
  memberGroup,
  displayName,
  isNamed,
  Network,
  V4Mode,
  V6Mode,
  poolText,
  isControllerMember,
  ApiKey,
  ApiKeyIssued,
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  copyText,
} from './lib'

export function StatusDot({ status, size = 10 }: { status: Member['status']; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, background: statusColor(status) }}
      className="inline-block rounded-full flex-shrink-0"
    />
  )
}

export function LiquidHighlight({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`absolute -inset-1 pointer-events-none ${className}`}
      style={{
        background:
          'radial-gradient(120% 108% at 50% 26%, rgba(255,255,255,1), rgba(255,255,255,0.49) 46%, rgba(255,255,255,0) 78%)',
        filter: 'blur(4px)',
      }}
    />
  )
}

export function Segmented({
  value,
  onChange,
}: {
  value: AuthFilter
  onChange: (v: AuthFilter) => void
}) {
  const items: { k: AuthFilter; label: string }[] = [
    { k: 'unauth', label: '未认证' },
    { k: 'auth', label: '已认证' },
  ]
  return (
    <div className="flex bg-grouped rounded-lg p-0.5">
      {items.map((it) => {
        const active = value === it.k
        return (
          <button
            key={it.k}
            onClick={() => onChange(it.k)}
            className={`relative flex-1 text-[13px] py-1.5 rounded-md transition-colors ${
              active ? 'bg-white text-sysblue font-medium shadow-sm' : 'text-[#3C3C43]'
            }`}
          >
            {active && <LiquidHighlight className="-inset-0.5 rounded-lg" />}
            <span className="relative">{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SortMenu({
  value,
  onChange,
}: {
  value: SortKey
  onChange: (v: SortKey) => void
}) {
  const map: Record<SortKey, string> = {
    ip: '按 IP',
    name: '按名称',
    status: '按状态',
    lastSeen: '按最近活跃',
    version: '按版本',
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-sysgray">排序</span>
      <div className="flex bg-grouped rounded-lg p-0.5">
        {(Object.keys(map) as SortKey[]).map((k) => {
          const active = value === k
          return (
            <button
              key={k}
              onClick={() => onChange(k)}
              className={`relative text-[12px] px-2.5 py-1 rounded-md transition-colors ${
                active ? 'bg-white text-sysblue font-medium shadow-sm' : 'text-[#3C3C43]'
              }`}
            >
              {active && <LiquidHighlight className="-inset-0.5 rounded-lg" />}
              <span className="relative">{map[k]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Toggle({
  on,
  onChange,
  color = '#34C759',
  disabled = false,
}: {
  on: boolean
  onChange: () => void
  color?: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={disabled ? () => {} : onChange}
      disabled={disabled}
      className={`relative w-[42px] h-[26px] rounded-full transition-colors flex-shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      style={{ background: on ? color : '#E5E5EA' }}
    >
      <span
        className="absolute top-0.5 bg-white rounded-full shadow"
        style={{ width: 22, height: 22, left: on ? 18 : 2, transition: 'left .15s' }}
      />
    </button>
  )
}

function subLine(m: Member) {
  const g = memberGroup(m)
  const ver = m.version ? ` · ${m.version}` : ''
  if (g === 'assigned')
    return <span className="text-sysblue">{m.ipAssignments[0]} · {statusLabel(m.status)}{ver}</span>
  if (g === 'pending')
    return <span className="text-sysorange">待分配 IP · {statusLabel(m.status)}{ver}</span>
  return <span className="text-sysgray">未授权 · {statusLabel(m.status)}{ver}</span>
}

export function MemberCard({
  m,
  selected,
  onClick,
  controllerAddress,
}: {
  m: Member
  selected?: boolean
  onClick: () => void
  controllerAddress?: string
}) {
  const isCtl = isControllerMember(m, controllerAddress || '')
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 bg-white border rounded-xl px-3.5 py-3 text-left ${
        selected ? 'border-sysblue bg-[#EAF3FF]' : 'border-separator'
      }`}
    >
      <StatusDot status={m.status} />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium text-black truncate flex items-center gap-1.5">
          {displayName(m)}
          {isCtl && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#FFF0E0] text-[#FF9500] align-middle">
              控制器
            </span>
          )}
          {!isNamed(m) && !isCtl && <span className="ml-1.5 text-[11px] font-normal text-sysgray align-middle">未命名</span>}
        </div>
        <div className="text-[13px] truncate">{subLine(m)}</div>
      </div>
      <span className="text-sysgray text-lg">›</span>
    </button>
  )
}

function peerVersionText(m: Member): string {
  return m.version || '—'
}

export function MemberTable({
  members,
  selectedId,
  onSelect,
  sortKey,
  onSortIp,
  controllerAddress,
}: {
  members: Member[]
  selectedId?: string
  onSelect: (m: Member) => void
  sortKey: SortKey
  onSortIp: () => void
  controllerAddress?: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-separator bg-white">
      <div className="grid grid-cols-[28px_1.4fr_1.1fr_0.8fr_0.9fr_1fr] items-center px-3.5 py-2 bg-[#FAFAFC] text-[12px] text-sysgray border-b border-separator">
        <span />
        <span>名称</span>
        <button onClick={onSortIp} className={sortKey === 'ip' ? 'text-sysblue font-medium text-left' : 'text-left'}>
          IP 地址 {sortKey === 'ip' ? '↓' : ''}
        </button>
        <span>状态</span>
        <span>版本</span>
        <span>最近活跃</span>
      </div>
      {members.map((m) => {
        const g = memberGroup(m)
        const isCtl = isControllerMember(m, controllerAddress || '')
        return (
          <div
            key={m.id}
            onClick={() => onSelect(m)}
            className={`grid grid-cols-[28px_1.4fr_1.1fr_0.8fr_0.9fr_1fr] items-center px-3.5 py-2.5 text-[13px] border-b border-[#F2F2F7] cursor-pointer ${
              selectedId === m.id ? 'bg-[#EAF3FF]' : ''
            }`}
          >
            <span className="text-sysgray">☐</span>
            <span className="flex items-center gap-2 min-w-0">
              <StatusDot status={m.status} size={8} />
              <span className={`truncate ${isNamed(m) ? 'text-black' : 'text-sysgray'} flex items-center gap-1.5`}>
                {displayName(m)}
                {isCtl && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#FFF0E0] text-[#FF9500]">
                    控制器
                  </span>
                )}
              </span>
            </span>
            <span className={g === 'assigned' ? 'text-sysblue' : 'text-sysgray'}>
              {g === 'assigned' ? m.ipAssignments[0] : g === 'pending' ? '待分配 IP' : '—'}
            </span>
            <span>{statusLabel(m.status)}</span>
            <span className="text-sysgray">{peerVersionText(m)}</span>
            <span className="text-sysgray">
              {m.status === 'offline' ? '离线' : timeAgo(m.lastSeen)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function timeAgo(ms: number) {
  if (!ms || ms <= 0) return '从未上线'
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.round(min / 60)
  return `${h} 小时前`
}

export function MemberDetail({
  m,
  onToggleAuth,
  onToggleBridge,
  onDelete,
  onRename,
  autoAssign,
  onToggleAuto,
  networkAutoOff,
  suggestedIp,
  validateIp,
  onAssignIp,
  onAutoAssign,
  onClearIp,
  network,
}: {
  m: Member
  network?: Network
  onToggleAuth: () => void
  onToggleBridge: () => void
  onDelete: () => void
  onRename: (name: string) => void
  autoAssign: boolean
  onToggleAuto: () => void
  networkAutoOff?: boolean
  suggestedIp: string
  validateIp: (ip: string) => string | null
  onAssignIp: (ip: string) => void
  onAutoAssign: () => void
  onClearIp: () => void
}) {
  const g = memberGroup(m)
  const [draft, setDraft] = useState(m.ipAssignments[0] || '')
  const [err, setErr] = useState<string | null>(null)
  const [draftName, setDraftName] = useState(m.name)
  useEffect(() => {
    setDraft(m.ipAssignments[0] || '')
    setErr(null)
  }, [m.id, m.ipAssignments[0]])
  useEffect(() => {
    setDraftName(m.name)
  }, [m.id])

  function onIpChange(v: string) {
    setDraft(v)
    setErr(validateIp(v))
  }
  function commit() {
    if (draft.trim() === '') {
      onClearIp()
      setErr(null)
      return
    }
    const e = validateIp(draft)
    if (e) {
      setErr(e)
      return
    }
    onAssignIp(draft)
    setErr(null)
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3.5 mb-5">
        <div className="rounded-full bg-[#E5F0FF] text-sysblue flex items-center justify-center text-xl font-medium" style={{ width: 52, height: 52 }}>
          {(displayName(m).charAt(0) || '?').toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-black truncate">{isNamed(m) ? m.name : '未命名设备'}</div>
          <div className="text-[13px] text-sysgray truncate">{m.id} · {statusLabel(m.status)}</div>
        </div>
      </div>

      <div className="border-t border-separator">
        <Row label="所属网络">
          <span className="flex items-center gap-1.5">
            <span className="text-black">{network?.name ?? '—'}</span>
            {network && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded ${network.private ? 'bg-[#E5F0FF] text-sysblue' : 'bg-grouped text-sysgray'}`}>
                {network.private ? '私有' : '公开'}
              </span>
            )}
          </span>
        </Row>
        <Row label="IP 池">
          <span className="text-sysgray text-right max-w-[60%] truncate">{network ? poolText(network) : '—'}</span>
        </Row>
        <Row label="名称">
          <input
            value={draftName}
            placeholder="点击设置名称"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              if (draftName !== m.name) onRename(draftName)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className="text-right bg-transparent outline-none text-black w-40 max-w-[60%] placeholder:text-sysgray"
          />
        </Row>
        <Row label="IP 地址">
          <div className="flex flex-col items-end">
            <input
              value={draft}
              placeholder={networkAutoOff ? '手工填写' : autoAssign ? '自动分配' : suggestedIp}
              onChange={(e) => onIpChange(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              className={`text-right bg-transparent outline-none w-40 max-w-[60%] placeholder:text-sysgray ${
                err ? 'text-[#FF3B30]' : 'text-sysblue'
              }`}
            />
            {err && <span className="text-[11px] text-[#FF3B30] mt-0.5">{err}</span>}
          </div>
        </Row>
        <Row label="自动分配 IP">
          {networkAutoOff ? (
            <Toggle on={false} onChange={() => {}} disabled />
          ) : (
            <Toggle on={autoAssign} onChange={onToggleAuto} />
          )}
        </Row>
        {networkAutoOff && (
          <div className="-mt-1 mb-1 px-1 text-[11px] text-sysgray">
            网络已关闭自动分配，请在「网络」设置中开启 IPv4 分配
          </div>
        )}
        <Row label="桥接模式">
          <Toggle on={m.bridge} onChange={onToggleBridge} />
        </Row>
        <Row label="授权">
          <Toggle on={m.authorized} onChange={onToggleAuth} />
        </Row>
        <Row label="客户端版本">
          <span className="text-sysgray">{m.version || '—'}</span>
        </Row>
        <Row label="最近活跃">
          <span className="text-sysgray">{timeAgo(m.lastSeen)}</span>
        </Row>
      </div>

      <div className="flex gap-2.5 mt-5">
        {!m.authorized ? (
          <button onClick={onToggleAuth} className="flex-1 text-center py-2.5 rounded-xl bg-sysblue text-white text-[14px] font-medium">
            授权
          </button>
        ) : g === 'pending' && autoAssign && !networkAutoOff ? (
          <button onClick={onAutoAssign} className="flex-1 text-center py-2.5 rounded-xl bg-sysblue text-white text-[14px] font-medium">
            自动分配 IP
          </button>
        ) : g === 'assigned' ? (
          <button onClick={onClearIp} className="flex-1 text-center py-2.5 rounded-xl bg-white border border-sysblue text-sysblue text-[14px] font-medium">
            解除 IP
          </button>
        ) : null}
        <button onClick={onDelete} className="flex-1 text-center py-2.5 rounded-xl bg-white border border-[#FF3B30] text-[#FF3B30] text-[14px] font-medium">
          删除
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-3 border-b border-separator">
      <span className="text-[14px] text-black">{label}</span>
      {children}
    </div>
  )
}

function Seg({
  options,
  value,
  onChange,
}: {
  options: { k: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex bg-grouped rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={o.k}
          onClick={() => onChange(o.k)}
          className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${
            value === o.k ? 'bg-white text-sysblue font-medium shadow-sm' : 'text-[#3C3C43]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function NetworkCard({
  net,
  count,
  onOpen,
  onDelete,
  onManageMembers,
}: {
  net: Network
  count: { total: number; authorized: number }
  onOpen: () => void
  onDelete: () => void
  onManageMembers: () => void
}) {
  return (
    <div className="bg-white border border-separator rounded-xl px-3.5 py-3 flex items-center gap-3">
      <button className="flex-1 min-w-0 text-left" onClick={onOpen}>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-medium text-black truncate">{net.name}</span>
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded ${
              net.private ? 'bg-[#E5F0FF] text-sysblue' : 'bg-grouped text-sysgray'
            }`}
          >
            {net.private ? '私有' : '公开'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-sysgray truncate">
          <span className="font-mono truncate">{net.id}</span>
          <button
            onClick={() => copyText(net.id)}
            className="text-sysblue flex-shrink-0"
            aria-label="复制网络 ID"
          >
            复制
          </button>
          <span className="flex-shrink-0">· {count.authorized}/{count.total} 已授权</span>
        </div>
      </button>
      <button onClick={onManageMembers} className="text-sysblue text-[13px] px-2 py-1 flex-shrink-0">
        管理成员
      </button>
      <button onClick={onDelete} className="text-[#FF3B30] text-[13px] px-2 py-1 flex-shrink-0">
        删除
      </button>
    </div>
  )
}

export function NetworkConfig({
  net,
  onUpdate,
  onDelete,
  onClose,
}: {
  net: Network
  onUpdate: (updater: (n: Network) => Network) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [poolStart, setPoolStart] = useState('')
  const [poolEnd, setPoolEnd] = useState('')
  const [routeTarget, setRouteTarget] = useState('')
  const [routeVia, setRouteVia] = useState('')
  const [dnsServer, setDnsServer] = useState('')

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-[480px] max-h-[90vh] overflow-auto glass-strong rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <span className="text-[17px] font-semibold text-black">网络配置</span>
          <button onClick={onClose} className="text-sysblue text-[15px]">
            完成
          </button>
        </div>

        <div className="border-t border-separator">
          <Row label="名称">
            <input
              value={net.name}
              onChange={(e) => onUpdate((n) => ({ ...n, name: e.target.value }))}
              className="text-right bg-transparent outline-none text-black w-44 max-w-[60%]"
            />
          </Row>
          <Row label="私有网络">
            <Toggle on={net.private} onChange={() => onUpdate((n) => ({ ...n, private: !n.private }))} />
          </Row>
          <Row label="IPv4 分配">
            <Seg
              options={[
                { k: 'zt', label: '自动' },
                { k: 'none', label: '关闭' },
              ]}
              value={net.v4AssignMode}
              onChange={(v) => onUpdate((n) => ({ ...n, v4AssignMode: v as V4Mode }))}
            />
          </Row>
          <Row label="IPv6 分配">
            <Seg
              options={[
                { k: '6plane', label: '6PLANE' },
                { k: 'rfc4193', label: 'RFC4193' },
                { k: 'zt', label: '自动' },
                { k: 'none', label: '关闭' },
              ]}
              value={net.v6AssignMode}
              onChange={(v) => onUpdate((n) => ({ ...n, v6AssignMode: v as V6Mode }))}
            />
          </Row>
        </div>

        {/* IP 分配池 */}
        <div className="text-[13px] text-sysgray font-medium px-1 mt-4 mb-2">IP 分配池</div>
        <div className="space-y-2">
          {net.ipPool.map((r) => (
            <div key={r.id} className="flex items-center justify-between bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2">
              <span className="text-[13px] text-black">
                {r.start} – {r.end}
              </span>
              <button
                onClick={() => onUpdate((n) => ({ ...n, ipPool: n.ipPool.filter((x) => x.id !== r.id) }))}
                className="text-[#FF3B30] text-[13px]"
              >
                移除
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              value={poolStart}
              onChange={(e) => setPoolStart(e.target.value)}
              placeholder="起始 IP"
              className="flex-1 bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2 text-[13px] outline-none"
            />
            <input
              value={poolEnd}
              onChange={(e) => setPoolEnd(e.target.value)}
              placeholder="结束 IP"
              className="flex-1 bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2 text-[13px] outline-none"
            />
            <button
              onClick={() => {
                if (!poolStart || !poolEnd) return
                onUpdate((n) => ({
                  ...n,
                  ipPool: [...n.ipPool, { id: `${Date.now()}`, start: poolStart, end: poolEnd }],
                }))
                setPoolStart('')
                setPoolEnd('')
              }}
              className="text-sysblue text-[14px] px-2"
            >
              添加
            </button>
          </div>
        </div>

        {/* 路由 */}
        <div className="text-[13px] text-sysgray font-medium px-1 mt-4 mb-2">路由</div>
        <div className="space-y-2">
          {net.routes.map((r) => (
            <div key={r.id} className="flex items-center justify-between bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2">
              <span className="text-[13px] text-black">
                {r.target}
                {r.via ? ` via ${r.via}` : ''}
              </span>
              <button
                onClick={() => onUpdate((n) => ({ ...n, routes: n.routes.filter((x) => x.id !== r.id) }))}
                className="text-[#FF3B30] text-[13px]"
              >
                移除
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              value={routeTarget}
              onChange={(e) => setRouteTarget(e.target.value)}
              placeholder="目标 CIDR"
              className="flex-1 bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2 text-[13px] outline-none"
            />
            <input
              value={routeVia}
              onChange={(e) => setRouteVia(e.target.value)}
              placeholder="网关(可选)"
              className="flex-1 bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2 text-[13px] outline-none"
            />
            <button
              onClick={() => {
                if (!routeTarget) return
                onUpdate((n) => ({
                  ...n,
                  routes: [...n.routes, { id: `${Date.now()}`, target: routeTarget, via: routeVia }],
                }))
                setRouteTarget('')
                setRouteVia('')
              }}
              className="text-sysblue text-[14px] px-2"
            >
              添加
            </button>
          </div>
        </div>

        {/* DNS */}
        <div className="flex justify-between items-center py-3 mt-3 border-t border-separator">
          <span className="text-[14px] text-black">启用 DNS</span>
          <Toggle
            on={!!net.dns}
            onChange={() =>
              onUpdate((n) => ({ ...n, dns: n.dns ? null : { domain: '', servers: [] } }))
            }
          />
        </div>
        {net.dns && (
          <div className="space-y-2">
            <input
              value={net.dns.domain}
              onChange={(e) => onUpdate((n) => ({ ...n, dns: { ...n.dns!, domain: e.target.value } }))}
              placeholder="搜索域 (可选)"
              className="w-full bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2 text-[13px] outline-none"
            />
            {net.dns.servers.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2">
                <span className="text-[13px] text-black">{s}</span>
                <button
                  onClick={() =>
                    onUpdate((n) => ({
                      ...n,
                      dns: { ...n.dns!, servers: n.dns!.servers.filter((_, j) => j !== i) },
                    }))
                  }
                  className="text-[#FF3B30] text-[13px]"
                >
                  移除
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={dnsServer}
                onChange={(e) => setDnsServer(e.target.value)}
                placeholder="DNS 服务器 IP"
                className="flex-1 bg-white/60 border border-white/80 shadow-sm rounded-lg px-3 py-2 text-[13px] outline-none"
              />
              <button
                onClick={() => {
                  if (!dnsServer) return
                  onUpdate((n) => ({
                    ...n,
                    dns: { ...n.dns!, servers: [...n.dns!.servers, dnsServer] },
                  }))
                  setDnsServer('')
                }}
                className="text-sysblue text-[14px] px-2"
              >
                添加
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onDelete}
          className="w-full mt-6 text-center py-2.5 rounded-xl bg-white border border-[#FF3B30] text-[#FF3B30] text-[14px] font-medium"
        >
          删除网络
        </button>
      </div>
    </div>
  )
}

export function ChangePasswordSheet({
  onCancel,
  onSubmit,
  forced = false,
}: {
  onCancel: () => void
  onSubmit: (cur: string, next: string) => Promise<boolean>
  forced?: boolean
}) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!cur) {
      setErr('请输入当前密码')
      return
    }
    if (!next || next.length < 6) {
      setErr('新密码至少 6 位')
      return
    }
    if (next !== confirm) {
      setErr('两次输入的新密码不一致')
      return
    }
    const ok = await onSubmit(cur, next)
    if (!ok) {
      setErr('当前密码不正确')
      return
    }
    setDone(true)
    setTimeout(onCancel, 900)
  }
  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={forced ? undefined : onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] glass-strong rounded-2xl p-5 flex flex-col"
      >
        <div className="flex justify-between items-center mb-4">
          <span className="text-[17px] font-semibold text-black">
            {forced ? '首次登录，请修改密码' : '修改密码'}
          </span>
          {!forced && (
            <button type="button" onClick={onCancel} className="text-sysblue text-[15px]">
              取消
            </button>
          )}
        </div>
        {forced && (
          <p className="text-[12px] text-sysgray mb-3 leading-relaxed">
            检测到这是随机生成的初始密码，系统要求您立即设置一个新密码后再继续使用。
          </p>
        )}
        {done ? (
          <div className="py-6 text-center">
            <div className="w-12 h-12 rounded-full bg-[#34C759]/15 flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2.4">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-[15px] text-black">密码已更新</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              <input
                type="password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
                placeholder="当前密码"
                autoFocus
                className="w-full bg-white/70 border border-white/80 rounded-xl px-3.5 py-3 text-[15px] text-black outline-none placeholder:text-sysgray focus:border-sysblue"
              />
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="新密码（至少 6 位）"
                className="w-full bg-white/70 border border-white/80 rounded-xl px-3.5 py-3 text-[15px] text-black outline-none placeholder:text-sysgray focus:border-sysblue"
              />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="确认新密码"
                className="w-full bg-white/70 border border-white/80 rounded-xl px-3.5 py-3 text-[15px] text-black outline-none placeholder:text-sysgray focus:border-sysblue"
              />
            </div>
            {err && <p className="text-[12px] text-[#FF3B30] mt-2.5 text-center">{err}</p>}
            <button
              type="submit"
              className="mt-5 w-full py-3 rounded-xl bg-sysblue text-white text-[15px] font-medium active:scale-[0.99] transition"
            >
              确认修改
            </button>
          </>
        )}
      </form>
    </div>
  )
}

function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [name, setName] = useState('')
  const [issued, setIssued] = useState<ApiKeyIssued | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    try {
      setKeys(await fetchApiKeys())
    } catch (e) {
      setErr(String(e))
    }
  }
  useEffect(() => {
    load()
  }, [])

  const onCreate = async () => {
    setLoading(true)
    setErr('')
    try {
      const k = await createApiKey(name)
      setIssued(k)
      setName('')
      await load()
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }
  const onRevoke = async (id: string) => {
    try {
      await revokeApiKey(id)
      await load()
    } catch (e) {
      setErr(String(e))
    }
  }

  const fmt = (t: number | null) =>
    t ? new Date(t * 1000).toLocaleString() : '从未'

  const statusBadge = (k: ApiKey) =>
    k.status === 'active' ? (
      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[#E3F9E5] text-[#1A8A3A]">有效</span>
    ) : (
      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-grouped text-sysgray">已禁用</span>
    )

  return (
    <div className="mt-4 border-t border-separator pt-4">
      <div className="text-[13px] font-medium text-black mb-2">API 密钥</div>
      <div className="text-[12px] text-sysgray leading-relaxed mb-3">
        用于外部程序以 <code className="px-1 rounded bg-grouped">Authorization: Bearer</code> 方式调用
        ZeroTier 管理 API（<code className="px-1 rounded bg-grouped">/api/controller/**</code>
        ）。密钥不基于浏览器会话、无登录/退出概念。它仅能操作 ZT 控制器，
        不可用于登录或管理系统自身（如本面板、改密等）。密钥仅在创建时显示一次，请妥善保存。
      </div>

      {issued && (
        <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <div className="text-[12px] text-amber-700 mb-1">新密钥已生成（仅显示一次）</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] break-all text-black select-all">
              {issued.key}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(issued.key)}
              className="text-sysblue text-[13px] flex-shrink-0"
            >
              复制
            </button>
          </div>
        </div>
      )}

      {err && <div className="text-[12px] text-[#FF3B30] mb-2">{err}</div>}

      <div className="space-y-2 mb-3">
        {keys.length === 0 && (
          <div className="text-[12px] text-sysgray">暂无密钥</div>
        )}
        {keys.map((k) => (
          <div
            key={k.id}
            className="flex items-center justify-between p-2.5 rounded-xl bg-grouped"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-black truncate">{k.name}</span>
                {statusBadge(k)}
              </div>
              <div className="text-[11px] text-sysgray truncate">
                {k.prefix}… · 创建 {fmt(k.created_at)} · 创建人 {k.created_by || '—'}
                {k.last_used_at ? ` · 最近 ${fmt(k.last_used_at)}` : ''}
                {k.status !== 'active' && k.expires_at ? ` · 失效 ${fmt(k.expires_at)}` : ''}
              </div>
            </div>
            {k.status === 'active' ? (
              <button
                onClick={() => onRevoke(k.id)}
                className="text-[#FF3B30] text-[13px] flex-shrink-0 ml-2"
              >
                吊销
              </button>
            ) : (
              <span className="text-[11px] text-sysgray flex-shrink-0 ml-2">已吊销</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="密钥名称（可选）"
          className="flex-1 px-3 py-2 rounded-xl bg-grouped text-[13px] text-black outline-none border border-transparent focus:border-sysblue"
        />
        <button
          onClick={onCreate}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-sysblue text-white text-[13px] font-medium disabled:opacity-50"
        >
          新建
        </button>
      </div>
    </div>
  )
}

export function Settings({
  defaultAutoAssign,
  onToggleDefaultAuto,
  onLogout,
  onChangePassword,
  onClose,
  controllerAddress,
  apiVersion,
}: {
  defaultAutoAssign: boolean
  onToggleDefaultAuto: () => void
  onLogout: () => void
  onChangePassword: (cur: string, next: string) => Promise<boolean>
  onClose: () => void
  controllerAddress: string
  apiVersion: number
}) {
  const [showPw, setShowPw] = useState(false)
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-[480px] glass-strong rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <span className="text-[17px] font-semibold text-black">设置</span>
          <button onClick={onClose} className="text-sysblue text-[15px]">
            完成
          </button>
        </div>
        <div className="border-t border-separator">
          <Row label="当前管理员">
            <span className="text-[13px] text-black">admin</span>
          </Row>
          <Row label="控制器地址">
            <span className="text-[13px] text-sysgray">{controllerAddress || '—'}</span>
          </Row>
          <Row label="版本">
            <span className="text-[13px] text-sysgray">
              {apiVersion ? `API v${apiVersion}` : '—'}
            </span>
          </Row>
          <Row label="默认自动分配 IP">
            <Toggle on={defaultAutoAssign} onChange={onToggleDefaultAuto} />
          </Row>
        </div>
        <div className="text-[12px] text-sysgray mt-4 leading-relaxed">
          对接宿主机 ZeroTier 控制器，操作实时生效。
        </div>
        <ApiKeyManager />
        <button
          onClick={() => setShowPw(true)}
          className="mt-4 w-full py-2.5 rounded-xl bg-white border border-sysblue text-sysblue text-[14px] font-medium"
        >
          修改密码
        </button>
        <button
          onClick={onLogout}
          className="mt-3 w-full py-2.5 rounded-xl bg-white border border-[#FF3B30] text-[#FF3B30] text-[14px] font-medium"
        >
          退出登录
        </button>
      </div>
      {showPw && (
        <ChangePasswordSheet onCancel={() => setShowPw(false)} onSubmit={onChangePassword} />
      )}
    </div>
  )
}

export function NetworkSwitcher({
  networks,
  currentNwid,
  onSelect,
}: {
  networks: Network[]
  currentNwid: string
  onSelect: (nwid: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = networks.find((n) => n.id === currentNwid)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-grouped text-[14px] text-black font-medium max-w-[52vw]"
      >
        <span className="truncate">{current?.name ?? '选择网络'}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 w-64 max-w-[80vw] glass-strong rounded-xl border border-separator shadow-lg p-1.5">
          <div className="px-2.5 py-1.5 text-[12px] text-sysgray">切换网络</div>
          {networks.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                onSelect(n.id)
                setOpen(false)
              }}
              className="relative w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-[14px] hover:bg-grouped"
            >
              {n.id === currentNwid && <LiquidHighlight className="-inset-0.5 rounded-lg" />}
              <span className="relative flex items-center gap-2 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    n.id === currentNwid ? 'bg-sysblue' : 'bg-transparent'
                  }`}
                />
                <span className="truncate text-black">{n.name}</span>
              </span>
              <span
                className={`relative text-[13px] flex-shrink-0 ml-2 ${
                  n.id === currentNwid ? 'text-sysblue' : 'text-transparent'
                }`}
              >
                ✓
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar({
  networks,
  currentNwid,
  onSelect,
  onManage,
  controllerAddress,
  apiVersion,
  databaseReady,
}: {
  networks: Network[]
  currentNwid: string
  onSelect: (nwid: string) => void
  onManage: () => void
  controllerAddress: string
  apiVersion: number
  databaseReady: boolean
}) {
  return (
    <aside className="hidden lg:flex flex-col w-[200px] flex-shrink-0 border-r border-separator glass p-3.5">
      <div className="text-[12px] text-sysgray mb-2">控制器状态</div>
      <div className="text-[13px] text-black mb-1">地址 {controllerAddress || '—'}</div>
      <div className="text-[13px] text-sysgray mb-3.5">
        {apiVersion ? `API v${apiVersion}` : '—'}
        {databaseReady ? ' · 已就绪' : ' · 未就绪'}
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-sysgray">网络 ({networks.length})</span>
        <button onClick={onManage} className="text-[12px] text-sysblue">
          管理
        </button>
      </div>
      {networks.map((n) => (
        <button
          key={n.id}
          onClick={() => onSelect(n.id)}
          className={`text-left px-2.5 py-1.5 rounded-lg text-[13px] mb-1.5 truncate ${
            n.id === currentNwid ? 'bg-[#E5F0FF] text-sysblue font-medium' : 'text-[#3C3C43]'
          }`}
          title={n.name}
        >
          {n.name}
        </button>
      ))}
    </aside>
  )
}

export function TabBar({
  view,
  onView,
}: {
  view: 'members' | 'networks' | 'settings'
  onView: (v: 'members' | 'networks' | 'settings') => void
}) {
  const tabs: { k: 'networks' | 'members' | 'settings'; label: string; icon: React.ReactNode }[] = [
    {
      k: 'networks',
      label: '网络',
      icon: (
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
        </svg>
      ),
    },
    {
      k: 'members',
      label: '成员',
      icon: (
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="8" r="3.6" />
          <path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" />
        </svg>
      ),
    },
    {
      k: 'settings',
      label: '设置',
      icon: (
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
        </svg>
      ),
    },
  ]
  return (
    <nav className="lg:hidden fixed bottom-[max(16px,calc(env(safe-area-inset-bottom)+16px))] left-1/2 -translate-x-1/2 w-[min(420px,calc(100%-32px))] glass rounded-2xl flex px-2 py-2 z-20 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_14px_40px_rgba(31,38,88,0.20)]">
      {tabs.map((t) => {
        const active = view === t.k
        return (
          <button
            key={t.k}
            onClick={() => onView(t.k)}
            className={`relative flex-1 flex flex-col items-center gap-1 ${active ? 'text-sysblue' : 'text-sysgray'}`}
          >
            {active && <LiquidHighlight className="rounded-2xl" />}
            <span className={`relative ${active ? '' : 'opacity-85'}`}>{t.icon}</span>
            <span className={`relative text-[10px] ${active ? 'font-medium' : ''}`}>{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

// 登录门：提交后调用后端 /api/auth/login，凭据由服务端校验，会话用 HttpOnly cookie 维持。
export function LoginGate({ onLogin }: { onLogin: (user: string, pass: string) => Promise<boolean> }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!user.trim() || !pass) {
      setErr('请输入用户名和密码')
      return
    }
    const ok = await onLogin(user.trim(), pass)
    if (!ok) setErr('用户名或密码不正确')
  }
  return (
    <div className="min-h-screen app-bg flex items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-[360px] glass-strong rounded-[28px] p-6 flex flex-col">
        <div className="w-16 h-16 rounded-2xl bg-sysblue/10 flex items-center justify-center mx-auto mb-4">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="1.8">
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            <circle cx="12" cy="15.5" r="1.4" fill="#007AFF" stroke="none" />
          </svg>
        </div>
        <h1 className="text-center text-[22px] font-semibold text-black mb-0.5">ZeroTier 控制台</h1>
        <p className="text-center text-[13px] text-sysgray mb-6">管理员登录</p>

        <div className="flex flex-col gap-2.5">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="用户名"
            autoFocus
            className="w-full bg-white/70 border border-white/80 rounded-xl px-3.5 py-3 text-[15px] text-black outline-none placeholder:text-sysgray focus:border-sysblue"
          />
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="密码"
            className="w-full bg-white/70 border border-white/80 rounded-xl px-3.5 py-3 text-[15px] text-black outline-none placeholder:text-sysgray focus:border-sysblue"
          />
        </div>

        {err && <p className="text-[12px] text-[#FF3B30] mt-2.5 text-center">{err}</p>}

        <button
          type="submit"
          className="mt-5 w-full py-3 rounded-xl bg-sysblue text-white text-[15px] font-medium active:scale-[0.99] transition"
        >
          登录
        </button>
        <p className="text-center text-[11px] text-sysgray mt-4">用户名 admin · 初始密码见服务首次启动日志</p>
      </form>
    </div>
  )
}

// 网络 ID 复制胶囊：成员页头部与网络卡片共用，让客户端明确「加入哪个网络」。
export function NetworkIdChip({ nwid }: { nwid: string }) {
  const [copied, setCopied] = useState(false)
  async function onCopy() {
    const ok = await copyText(nwid)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <button
      onClick={onCopy}
      title="点击复制网络 ID，发给客户端用于加入"
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-grouped text-sysgray text-[12px] max-w-[44vw] flex-shrink-0"
    >
      <span className="font-mono truncate">{nwid}</span>
      <span className="text-sysblue flex-shrink-0">{copied ? '已复制' : '复制'}</span>
    </button>
  )
}
