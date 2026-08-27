import { useMemo, useState, useEffect } from 'react'
import {
  Member,
  AuthFilter,
  SortKey,
  Network,
  memberGroup,
  sortMembers,
  nextFreeIp,
  isValidIp,
  ipInUse,
  ipInPool,
  countByNetwork,
  newNetworkDraft,
  fetchNetworks,
  fetchMembers,
  fetchPeers,
  withPeerStatus,
  fetchControllerStatus,
  ControllerStatus,
  saveMember,
  saveNetwork,
  createNetworkApi,
  deleteNetworkApi,
  deleteMemberApi,
} from './lib'
import {
  Segmented,
  SortMenu,
  MemberCard,
  MemberTable,
  MemberDetail,
  Sidebar,
  TabBar,
  NetworkCard,
  NetworkConfig,
  Settings,
  NetworkSwitcher,
  LoginGate,
  ChangePasswordSheet,
} from './components'

type View = 'members' | 'networks' | 'settings'

export default function App() {
  const [networks, setNetworks] = useState<Network[]>([])
  const [membersByNetwork, setMembersByNetwork] = useState<Record<string, Member[]>>({})
  const [currentNwid, setCurrentNwid] = useState<string>('')
  const [view, setView] = useState<View>('members')
  const [editingNetId, setEditingNetId] = useState<string | undefined>(undefined)
  const [defaultAutoAssign, setDefaultAutoAssign] = useState(false)
  const [search, setSearch] = useState('')

  const [authFilter, setAuthFilter] = useState<AuthFilter>('auth')
  const [sortKey, setSortKey] = useState<SortKey>('ip')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authed, setAuthed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('zt_auth') === '1'
    } catch {
      return false
    }
  })
  // 后端标记「需强制改密」（首次启动随机密码登录后触发）。
  const [mustChange, setMustChange] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [controller, setController] = useState<ControllerStatus>({ address: '', apiVersion: 0, databaseReady: false })

  // 会话由后端签发 HttpOnly cookie 管理；挂载时向后端确认登录态。
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (r) => {
        if (r.ok) {
          setAuthed(true)
          try {
            const d = await r.json()
            setMustChange(Boolean(d.must_change))
          } catch { /* ignore */ }
          try { localStorage.setItem('zt_auth', '1') } catch { /* ignore */ }
        } else {
          setAuthed(false)
          try { localStorage.removeItem('zt_auth') } catch { /* ignore */ }
        }
      })
      .catch(() => { /* 后端不可达：保持登出 */ })
  }, [])

  // 登录态确立后拉取真实数据（网络 + 成员 + 对等节点状态）。
  useEffect(() => {
    if (authed) reloadNetworks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  async function reloadNetworks() {
    setLoading(true)
    setError(null)
    try {
      const nets = await fetchNetworks()
      const peers = await fetchPeers()
      const ctlAddr = nets[0]?.id.slice(0, 10) || ''
      const byNet: Record<string, Member[]> = {}
      await Promise.all(
        nets.map(async (n) => {
          const ms = await fetchMembers(n.id)
          byNet[n.id] = withPeerStatus(ms, peers, ctlAddr)
        }),
      )
      setNetworks(nets)
      setMembersByNetwork(byNet)
      setCurrentNwid((cur) => (nets.find((n) => n.id === cur) ? cur : nets[0]?.id ?? ''))
      try {
        setController(await fetchControllerStatus(nets))
      } catch {
        /* 控制器状态非关键，失败不影响列表 */
      }
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  async function reloadMembers(nwid: string) {
    try {
      const [ms, peers] = await Promise.all([fetchMembers(nwid), fetchPeers()])
      setMembersByNetwork((prev) => ({ ...prev, [nwid]: withPeerStatus(ms, peers, controller.address) }))
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  async function login(user: string, pass: string): Promise<boolean> {
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user, pass }),
      })
      if (r.ok) {
        try {
          const d = await r.json()
          setMustChange(Boolean(d.must_change))
        } catch { /* ignore */ }
        try { localStorage.setItem('zt_auth', '1') } catch { /* ignore */ }
        setAuthed(true)
        return true
      }
    } catch { /* ignore */ }
    return false
  }
  async function changePassword(current: string, next: string): Promise<boolean> {
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ current, new: next }),
      })
      if (r.ok) {
        setMustChange(false)
        return true
      }
      return false
    } catch {
      return false
    }
  }
  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch { /* ignore */ }
    try { localStorage.removeItem('zt_auth') } catch { /* ignore */ }
    setAuthed(false)
  }

  const currentNetwork = networks.find((n) => n.id === currentNwid)
  const members = membersByNetwork[currentNwid] || []

  const selected = members.find((m) => m.id === selectedId)
  const editingNet = networks.find((n) => n.id === editingNetId)

  const visible = useMemo(() => {
    const base = members.filter((m) => (authFilter === 'unauth' ? !m.authorized : m.authorized))
    const q = search.trim().toLowerCase()
    if (!q) return base
    return base.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
  }, [members, authFilter, search])
  const pending = useMemo(
    () => sortMembers(visible.filter((m) => memberGroup(m) === 'pending'), sortKey),
    [visible, sortKey],
  )
  const assigned = useMemo(
    () => sortMembers(visible.filter((m) => memberGroup(m) === 'assigned'), sortKey),
    [visible, sortKey],
  )
  const unauthList = useMemo(() => sortMembers(visible, sortKey), [visible])

  function updateMembers(fn: (ms: Member[]) => Member[]) {
    setMembersByNetwork((prev) => ({ ...prev, [currentNwid]: fn(prev[currentNwid] || []) }))
  }

  function select(m: Member) {
    setSelectedId(m.id)
    setMobileOpen(true)
  }

  async function toggleAuth(id: string) {
    const m = members.find((x) => x.id === id)
    if (!m || !currentNwid) return
    try {
      await saveMember(currentNwid, id, { authorized: !m.authorized })
      await reloadMembers(currentNwid)
    } catch (e: any) { setError(String(e?.message || e)) }
  }
  async function toggleBridge(id: string) {
    const m = members.find((x) => x.id === id)
    if (!m || !currentNwid) return
    try {
      await saveMember(currentNwid, id, { bridge: !m.bridge })
      await reloadMembers(currentNwid)
    } catch (e: any) { setError(String(e?.message || e)) }
  }
  async function assignManual(id: string, ip: string) {
    if (!currentNwid) return
    try {
      await saveMember(currentNwid, id, { ipAssignments: [ip] })
      await reloadMembers(currentNwid)
    } catch (e: any) { setError(String(e?.message || e)) }
  }
  async function assignAuto(id: string) {
    if (!currentNwid) return
    try {
      await saveMember(currentNwid, id, { ipAssignments: [nextFreeIp(members, currentNetwork)] })
      await reloadMembers(currentNwid)
    } catch (e: any) { setError(String(e?.message || e)) }
  }
  async function clearIp(id: string) {
    if (!currentNwid) return
    try {
      await saveMember(currentNwid, id, { ipAssignments: [] })
      await reloadMembers(currentNwid)
    } catch (e: any) { setError(String(e?.message || e)) }
  }
  async function rename(id: string, name: string) {
    if (!currentNwid) return
    try {
      await saveMember(currentNwid, id, { name })
      await reloadMembers(currentNwid)
    } catch (e: any) { setError(String(e?.message || e)) }
  }
  function validateIpFor(id: string, ip: string): string | null {
    if (!isValidIp(ip)) return 'IP 格式不正确'
    if (ipInUse(ip, members, id)) return '该 IP 已被占用'
    if (!ipInPool(ip, currentNetwork)) return '不在本网络 IP 池范围内'
    return null
  }
  // autoAssign 映射到控制器 noAutoAssignIps，落盘。
  async function toggleMemberAuto(id: string) {
    const m = members.find((x) => x.id === id)
    if (!m || !currentNwid) return
    try {
      await saveMember(currentNwid, id, { autoAssign: !m.autoAssign })
      await reloadMembers(currentNwid)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  async function remove(id: string) {
    if (!currentNwid) return
    const ok = typeof window !== 'undefined' ? window.confirm('确定移除该终端？此操作不可撤销。') : true
    if (!ok) return
    try {
      await deleteMemberApi(currentNwid, id)
      if (selectedId === id) {
        setSelectedId(undefined)
        setMobileOpen(false)
      }
      await reloadMembers(currentNwid)
    } catch (e: any) { setError(String(e?.message || e)) }
  }

  // ---- Network ops ----
  async function patchNetwork(id: string, updater: (n: Network) => Network) {
    const net = networks.find((n) => n.id === id)
    if (!net) return
    try {
      await saveNetwork(id, updater(net))
      await reloadNetworks()
    } catch (e: any) { setError(String(e?.message || e)) }
  }
  async function deleteNetwork(id: string) {
    const name = networks.find((n) => n.id === id)?.name ?? ''
    const ok = typeof window !== 'undefined' ? window.confirm(`确定删除网络「${name}」？此操作不可撤销。`) : true
    if (!ok) return
    try {
      await deleteNetworkApi(id)
      setEditingNetId(undefined)
      await reloadNetworks()
    } catch (e: any) { setError(String(e?.message || e)) }
  }
  async function createNetwork() {
    try {
      const nwid = await createNetworkApi(newNetworkDraft())
      await reloadNetworks()
      if (nwid) {
        setCurrentNwid(nwid)
        setEditingNetId(nwid)
      }
    } catch (e: any) { setError(String(e?.message || e)) }
  }

  function onSelectNetwork(nwid: string) {
    setCurrentNwid(nwid)
    setView('members')
    setSelectedId(undefined)
    setMobileOpen(false)
  }
  function onView(v: View) {
    if (v === 'settings') {
      setView('settings')
      return
    }
    setView(v)
    setSelectedId(undefined)
    setMobileOpen(false)
  }

  const isMembers = view === 'members'
  const isNetworks = view === 'networks'

  if (!authed) return <LoginGate onLogin={login} />

  return (
    <div className="min-h-screen app-bg flex flex-col md:flex-row">
      <Sidebar
        networks={networks}
        currentNwid={currentNwid}
        onSelect={onSelectNetwork}
        onManage={() => onView('networks')}
        controllerAddress={controller.address}
        apiVersion={controller.apiVersion}
        databaseReady={controller.databaseReady}
      />

      <main className="flex-1 flex flex-col min-w-0">
        {error && (
          <div className="px-4 pt-3">
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-[13px] px-3 py-2">
              加载失败：{error}
            </div>
          </div>
        )}
        {isNetworks ? (
          <div className="px-4 pt-3 pb-24 lg:pb-4">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-2xl font-semibold text-black">网络</h1>
              <button
                onClick={createNetwork}
                className="px-3 py-1.5 rounded-lg bg-sysblue text-white text-[14px] font-medium"
              >
                新建网络
              </button>
            </div>
            {loading && networks.length === 0 ? (
              <div className="text-sysgray text-[14px] py-8 text-center">加载中…</div>
            ) : networks.length === 0 ? (
              <div className="text-sysgray text-[14px] py-8 text-center">还没有网络，点击右上角新建。</div>
            ) : (
              <div className="space-y-2">
                {networks.map((n) => (
                  <NetworkCard
                    key={n.id}
                    net={n}
                    count={countByNetwork(n, membersByNetwork[n.id] || [])}
                    onOpen={() => setEditingNetId(n.id)}
                    onDelete={() => deleteNetwork(n.id)}
                    onManageMembers={() => onSelectNetwork(n.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 glass px-4 pt-3 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <h1 className="text-2xl font-semibold text-black flex-shrink-0">成员</h1>
                  {isMembers && (
                    <NetworkSwitcher
                      networks={networks}
                      currentNwid={currentNwid}
                      onSelect={(id) => onSelectNetwork(id)}
                    />
                  )}
                </div>
                <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-grouped text-sysgray min-w-0 max-w-[40vw] lg:max-w-[220px]">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
                    <circle cx="11" cy="11" r="7" />
                    <line x1="16.5" y1="16.5" x2="21" y2="21" />
                  </svg>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索"
                    className="bg-transparent outline-none text-[13px] text-black w-14 lg:w-32 placeholder:text-sysgray min-w-0"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="text-sysgray text-[12px] leading-none flex-shrink-0"
                      aria-label="清除搜索"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3">
                <Segmented value={authFilter} onChange={setAuthFilter} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <SortMenu value={sortKey} onChange={setSortKey} />
                <span className="text-[13px] text-sysgray">{visible.length} 台</span>
              </div>
            </div>

            <div className="flex-1 px-4 pb-24 lg:pb-4">
              {loading && members.length === 0 ? (
                <div className="text-sysgray text-[14px] py-8 text-center">加载中…</div>
              ) : (
                <>
                  {/* Card list (phone + iPad) */}
                  <div className="lg:hidden space-y-4">
                    {authFilter === 'auth' ? (
                      <>
                        {pending.length > 0 && (
                          <Section title="待分配 IP">
                            {pending.map((m) => (
                              <MemberCard key={m.id} m={m} selected={m.id === selectedId} onClick={() => select(m)} controllerAddress={controller.address} />
                            ))}
                          </Section>
                        )}
                        <Section title="已分配 IP">
                          {assigned.map((m) => (
                            <MemberCard key={m.id} m={m} selected={m.id === selectedId} onClick={() => select(m)} controllerAddress={controller.address} />
                          ))}
                        </Section>
                      </>
                    ) : (
                      <Section title="未认证终端">
                        {unauthList.map((m) => (
                          <MemberCard key={m.id} m={m} selected={m.id === selectedId} onClick={() => select(m)} controllerAddress={controller.address} />
                        ))}
                      </Section>
                    )}
                  </div>

                  {/* Table (macOS web) */}
                  <div className="hidden lg:block">
                    <MemberTable
                      members={[...pending, ...assigned]}
                      selectedId={selectedId}
                      onSelect={select}
                      sortKey={sortKey}
                      onSortIp={() => setSortKey('ip')}
                      controllerAddress={controller.address}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </main>

      {/* Detail / Inspector (iPad + macOS), only in members view */}
      {isMembers && currentNetwork && (
        <aside className="hidden md:flex flex-col w-[320px] lg:w-[260px] flex-shrink-0 border-l border-separator glass p-4 md:pb-24 lg:pb-4 overflow-y-auto">
          {selected ? (
            <MemberDetail
              m={selected}
              onToggleAuth={() => toggleAuth(selected.id)}
              onToggleBridge={() => toggleBridge(selected.id)}
              onDelete={() => remove(selected.id)}
              onRename={(name) => rename(selected.id, name)}
              autoAssign={selected.autoAssign}
              onToggleAuto={() => toggleMemberAuto(selected.id)}
              networkAutoOff={currentNetwork?.v4AssignMode === 'none'}
              suggestedIp={nextFreeIp(members, currentNetwork)}
              validateIp={(ip) => validateIpFor(selected.id, ip)}
              onAssignIp={(ip) => assignManual(selected.id, ip)}
              onAutoAssign={() => assignAuto(selected.id)}
              onClearIp={() => clearIp(selected.id)}
              network={currentNetwork}
            />
          ) : (
            <div className="text-sysgray text-[13px] m-auto text-center">选择一台终端查看详情</div>
          )}
        </aside>
      )}

      <TabBar view={view} onView={onView} />

      {/* Network config modal */}
      {editingNet && (
        <NetworkConfig
          net={editingNet}
          onUpdate={(updater) => patchNetwork(editingNet.id, updater)}
          onDelete={() => deleteNetwork(editingNet.id)}
          onClose={() => setEditingNetId(undefined)}
        />
      )}

      {/* Settings modal */}
      {view === 'settings' && (
        <Settings
          defaultAutoAssign={defaultAutoAssign}
          onToggleDefaultAuto={() => setDefaultAutoAssign((v) => !v)}
          onLogout={logout}
          onChangePassword={changePassword}
          onClose={() => setView('members')}
          controllerAddress={controller.address}
          apiVersion={controller.apiVersion}
        />
      )}

      {/* 首次登录强制改密：覆盖全屏、不可取消，改完才解锁 */}
      {authed && mustChange && (
        <ChangePasswordSheet forced onSubmit={changePassword} onCancel={() => setMustChange(false)} />
      )}

      {/* Phone detail sheet */}
      {isMembers && mobileOpen && selected && currentNetwork && (
        <div
          className="md:hidden fixed inset-0 z-20 flex items-end bg-black/30"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="w-full glass-strong rounded-t-2xl p-4 max-h-[85vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-[13px] text-sysgray">终端详情</span>
              <button onClick={() => setMobileOpen(false)} className="text-sysblue text-[15px]">
                完成
              </button>
            </div>
            <MemberDetail
              m={selected}
              onToggleAuth={() => toggleAuth(selected.id)}
              onToggleBridge={() => toggleBridge(selected.id)}
              onDelete={() => remove(selected.id)}
              onRename={(name) => rename(selected.id, name)}
              autoAssign={selected.autoAssign}
              onToggleAuto={() => toggleMemberAuto(selected.id)}
              networkAutoOff={currentNetwork?.v4AssignMode === 'none'}
              suggestedIp={nextFreeIp(members, currentNetwork)}
              validateIp={(ip) => validateIpFor(selected.id, ip)}
              onAssignIp={(ip) => assignManual(selected.id, ip)}
              onAutoAssign={() => assignAuto(selected.id)}
              onClearIp={() => clearIp(selected.id)}
              network={currentNetwork}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[13px] text-sysgray font-medium px-1 mb-1.5">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
