import {
  Users,
  ClipboardList,
  Clock,
  Square,
  ChevronDown,
  ChevronRight,
  Wrench,
  MessageSquare,
  Loader2,
  Bot,
  ArrowRight,
  SendHorizonal,
  Trash2,
  Zap
} from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Separator } from '@renderer/components/ui/separator'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { useTeamStore } from '@renderer/stores/team-store'
import { abortTeammate, abortAllTeammates } from '@renderer/lib/agent/teams/teammate-runner'
import { resetTeamAutoTrigger } from '@renderer/hooks/use-chat-actions'
import { removeTeamLimiter } from '@renderer/lib/agent/sub-agents/create-tool'
import { teamEvents } from '@renderer/lib/agent/teams/events'
import { ToolCallCard } from '@renderer/components/chat/ToolCallCard'
import { cn } from '@renderer/lib/utils'
import { nanoid } from 'nanoid'
import type { TeamMember, TeamTask, TeamMessage } from '@renderer/lib/agent/teams/types'
import { useTranslation } from 'react-i18next'
import * as React from 'react'
import { useShallow } from 'zustand/react/shallow'

// ── Helpers ────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(1)}s`
  return `${Math.floor(secs / 60)}m${Math.round(secs % 60)}s`
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`
  return `${Math.round(diff / 3600_000)}h ago`
}

function formatTokenCount(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1_000
    return k < 10 ? `${k.toFixed(1)}k` : `${k.toFixed(0)}k`
  }
  const m = n / 1_000_000
  return m < 10 ? `${m.toFixed(2)}M` : `${m.toFixed(1)}M`
}

const statusDots: Record<string, string> = {
  working: 'bg-green-500 animate-pulse',
  idle: 'bg-cyan-400',
  waiting: 'bg-amber-400',
  stopped: 'bg-muted-foreground/30'
}

const taskStatusConfig: Record<string, { bg: string; label: string }> = {
  pending: { bg: 'bg-muted text-muted-foreground/60', label: 'pending' },
  in_progress: { bg: 'bg-blue-500/15 text-blue-500', label: 'active' },
  completed: { bg: 'bg-green-500/15 text-green-500', label: 'done' }
}

// ── Message Input (send to teammate from UI) ─────────────────────

function MessageInput({ targetName }: { targetName: string }): React.JSX.Element {
  const { t } = useTranslation('cowork')
  const [text, setText] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const isBroadcast = targetName === 'all'

  const send = (): void => {
    const content = text.trim()
    if (!content) return
    teamEvents.emit({
      type: 'team_message',
      message: {
        id: nanoid(8),
        from: 'user',
        to: targetName,
        type: isBroadcast ? 'broadcast' : 'message',
        content,
        timestamp: Date.now()
      }
    })
    setText('')
    inputRef.current?.focus()
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
        placeholder={
          isBroadcast
            ? t('team.broadcastPlaceholder')
            : t('team.messagePlaceholder', { name: targetName })
        }
        className="flex-1 min-w-0 rounded-md border bg-background px-2 py-1 text-[11px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
      />
      <button
        onClick={send}
        disabled={!text.trim()}
        className="shrink-0 rounded-md p-1 text-muted-foreground/40 hover:text-cyan-500 hover:bg-cyan-500/5 disabled:opacity-30 disabled:hover:text-muted-foreground/40 transition-colors"
        title="Send"
      >
        <SendHorizonal className="size-3" />
      </button>
    </div>
  )
}

// ── Member Detail Row (Expandable) ────────────────────────────────

const MemberDetailRow = React.memo(function MemberDetailRow({
  member,
  task,
  defaultOpen,
  onStop
}: {
  member: TeamMember
  task: TeamTask | null
  defaultOpen: boolean
  onStop: (id: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('cowork')
  const [open, setOpen] = React.useState(defaultOpen)
  const [toolsOpen, setToolsOpen] = React.useState(false)
  const isWorking = member.status === 'working'

  const [now, setNow] = React.useState(member.startedAt)
  React.useEffect(() => {
    if (!isWorking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isWorking, member.startedAt])
  const elapsed = (member.completedAt ?? now) - member.startedAt

  const lastTool =
    member.toolCalls.length > 0 ? member.toolCalls[member.toolCalls.length - 1] : null
  const currentAction = isWorking
    ? lastTool?.status === 'running'
      ? lastTool.name
      : member.streamingText
        ? 'thinking...'
        : 'working...'
    : member.status

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all duration-200',
            'hover:bg-muted/40',
            isWorking && 'bg-cyan-500/5 hover:bg-cyan-500/8',
            open && 'bg-muted/30'
          )}
        >
          <span className={cn('size-2 rounded-full shrink-0', statusDots[member.status])} />
          <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 truncate min-w-0 flex-1">
            {member.name}
          </span>
          <span className="text-[9px] text-muted-foreground/50 truncate max-w-[80px] font-mono">
            {currentAction}
          </span>
          <span className="text-[9px] text-muted-foreground/40 tabular-nums shrink-0 flex items-center gap-0.5">
            <Clock className="size-2.5" />
            {formatElapsed(elapsed)}
          </span>
          {open ? (
            <ChevronDown className="size-3 text-muted-foreground/40 shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mr-1 mt-0.5 mb-2 space-y-2 border-l-2 border-cyan-500/15 pl-3">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/60">
            {member.model !== 'default' && (
              <span className="flex items-center gap-0.5">
                <Bot className="size-2.5" />
                {member.model}
              </span>
            )}
            {member.iteration > 0 && <span>Iter {member.iteration}</span>}
            <span>{member.toolCalls.length} tool calls</span>
            <span>{formatElapsed(elapsed)}</span>
            {member.usage && member.usage.inputTokens + member.usage.outputTokens > 0 && (
              <span className="flex items-center gap-0.5">
                <Zap className="size-2.5" />
                {formatTokenCount(member.usage.inputTokens + member.usage.outputTokens)} tokens
              </span>
            )}
          </div>

          {/* Task info */}
          {task && (
            <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <ClipboardList className="size-2.5 text-muted-foreground/50" />
                <span className="text-[10px] font-medium text-muted-foreground/70">Task</span>
                <Badge
                  variant="secondary"
                  className={cn('text-[8px] h-3.5 px-1', taskStatusConfig[task.status]?.bg)}
                >
                  {taskStatusConfig[task.status]?.label ?? task.status}
                </Badge>
              </div>
              <p className="text-[11px] text-foreground/80 mt-0.5 leading-snug">{task.subject}</p>
            </div>
          )}

          {/* Streaming text (live thinking) */}
          {isWorking && member.streamingText && (
            <div className="rounded-md bg-cyan-500/[0.03] border border-cyan-500/10 px-2.5 py-2 max-h-32 overflow-y-auto">
              <div className="flex items-center gap-1 mb-1">
                <Loader2 className="size-2.5 animate-spin text-cyan-400" />
                <span className="text-[9px] font-medium text-cyan-400/70 uppercase tracking-wider">
                  Thinking
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
                {member.streamingText.length > 600
                  ? `…${member.streamingText.slice(-600)}`
                  : member.streamingText}
              </p>
            </div>
          )}

          {/* Thinking indicator (no text yet) */}
          {isWorking && member.toolCalls.length === 0 && !member.streamingText && (
            <div className="flex items-center gap-2 py-1">
              <span className="flex gap-1">
                <span
                  className="size-1.5 rounded-full bg-cyan-400/50 animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="size-1.5 rounded-full bg-cyan-400/50 animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="size-1.5 rounded-full bg-cyan-400/50 animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </span>
              <span className="text-[10px] text-cyan-400/60">{t('team.working')}</span>
            </div>
          )}

          {/* Tool Calls (nested collapsible) */}
          {member.toolCalls.length > 0 && (
            <Collapsible open={toolsOpen} onOpenChange={setToolsOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors py-0.5">
                  <Wrench className="size-2.5" />
                  <span className="font-medium uppercase tracking-wider">
                    {t('team.toolCalls')}
                  </span>
                  <Badge variant="secondary" className="text-[8px] h-3.5 px-1 ml-0.5">
                    {member.toolCalls.length}
                  </Badge>
                  <span className="flex-1" />
                  {toolsOpen ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 space-y-1 max-h-[400px] overflow-y-auto">
                  {member.toolCalls.map((tc) => (
                    <ToolCallCard
                      key={tc.id}
                      toolUseId={tc.id}
                      name={tc.name}
                      input={tc.input}
                      output={tc.output}
                      status={tc.status}
                      error={tc.error}
                      startedAt={tc.startedAt}
                      completedAt={tc.completedAt}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Send message to this teammate */}
          {isWorking && <MessageInput targetName={member.name} />}

          {/* Stop button */}
          {isWorking && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onStop(member.id)
              }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground/50 hover:text-destructive hover:bg-destructive/5 transition-colors border border-transparent hover:border-destructive/20"
            >
              <Square className="size-2.5" />
              {t('team.stopMember', { name: member.name })}
            </button>
          )}

          {/* Completed summary for stopped members */}
          {member.status === 'stopped' && member.streamingText && (
            <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
              <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                {t('team.lastOutput')}
              </span>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug whitespace-pre-wrap break-words">
                {member.streamingText.length > 300
                  ? member.streamingText.slice(-300) + '…'
                  : member.streamingText}
              </p>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

// ── Message Row ───────────────────────────────────────────────────

const MessageRow = React.memo(function MessageRow({
  msg
}: {
  msg: TeamMessage
}): React.JSX.Element {
  const { t } = useTranslation('cowork')
  const [expanded, setExpanded] = React.useState(false)
  const isLong = msg.content.length > 120

  return (
    <div className="rounded-md px-2.5 py-1.5 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="font-medium text-cyan-600 dark:text-cyan-400">{msg.from}</span>
        <ArrowRight className="size-2.5 text-muted-foreground/30" />
        <span className="font-medium text-muted-foreground/70">{msg.to}</span>
        {msg.type !== 'message' && (
          <Badge variant="secondary" className="text-[7px] h-3 px-1">
            {msg.type}
          </Badge>
        )}
        <span className="flex-1" />
        <span className="text-[9px] text-muted-foreground/40">{timeAgo(msg.timestamp)}</span>
      </div>
      {msg.summary && !expanded && (
        <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{msg.summary}</p>
      )}
      {(!msg.summary || expanded) && (
        <p className="text-[10px] text-muted-foreground/60 mt-0.5 whitespace-pre-wrap break-words leading-snug">
          {isLong && !expanded ? msg.content.slice(0, 120) + '…' : msg.content}
        </p>
      )}
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] text-cyan-500/60 hover:text-cyan-500 mt-0.5 transition-colors"
        >
          {expanded ? t('team.showLess') : t('team.showMore')}
        </button>
      )}
    </div>
  )
})

// ── Messages Timeline (chronological order with auto-scroll) ─────

const MessagesTimeline = React.memo(function MessagesTimeline({
  messages
}: {
  messages: TeamMessage[]
}): React.JSX.Element {
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Only auto-scroll if user is near the bottom (within 60px)
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distFromBottom < 60) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  return (
    <div ref={containerRef} className="space-y-0.5 max-h-[300px] overflow-y-auto mb-2">
      {messages.map((msg) => (
        <MessageRow key={msg.id} msg={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
})

// ── Section Header ────────────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  count
}: {
  icon: React.ReactNode
  label: string
  count?: number
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      {icon}
      <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
        {label}
      </span>
      {count != null && count > 0 && (
        <Badge variant="secondary" className="text-[8px] h-3.5 px-1">
          {count}
        </Badge>
      )}
    </div>
  )
}

// ── Main TeamPanel ────────────────────────────────────────────────

export function TeamPanel(): React.JSX.Element {
  const { t } = useTranslation('cowork')
  const activeTeam = useTeamStore(
    useShallow((s) => {
      const team = s.activeTeam
      if (!team) return null
      return {
        name: team.name,
        description: team.description,
        members: team.members,
        tasks: team.tasks,
        messages: team.messages
      }
    })
  )

  const handleStopMember = React.useCallback((memberId: string): void => {
    abortTeammate(memberId)
  }, [])

  const handleClearAll = React.useCallback((): void => {
    const team = useTeamStore.getState().activeTeam
    // 1. Pause auto-trigger to prevent dead loops
    resetTeamAutoTrigger()
    // 2. Abort all running teammates
    abortAllTeammates()
    // 3. Clean up concurrency limiter
    if (team) removeTeamLimiter(team.name)
    // 4. Emit team_end so the store archives + clears
    teamEvents.emit({ type: 'team_end' })
  }, [])

  if (!activeTeam) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="mb-3 size-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{t('team.noTeam')}</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{t('team.noTeamDesc')}</p>
      </div>
    )
  }

  const { members, tasks, messages } = activeTeam
  const workingMembers = members.filter((m) => m.status === 'working')

  return (
    <div className="space-y-3">
      {/* ── Team Header ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center rounded-lg bg-cyan-500/15 p-1.5 text-cyan-500">
            <Users className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-cyan-600 dark:text-cyan-400 truncate">
                {activeTeam.name}
              </span>
              <Badge variant="secondary" className="text-[8px] h-3.5 px-1">
                {members.length}
              </Badge>
              {workingMembers.length > 0 && (
                <span className="text-[9px] text-cyan-500">
                  {t('team.workingCount', { count: workingMembers.length })}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/60 truncate">
              {activeTeam.description}
            </p>
          </div>
          <button
            onClick={handleClearAll}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/5 transition-colors"
            title={t('team.stopAll')}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <Separator />

      {/* ── Members (expandable detail rows) ── */}
      {members.length > 0 && (
        <div>
          <SectionHeader
            icon={<Users className="size-3 text-muted-foreground/50" />}
            label={t('team.members')}
            count={members.length}
          />
          <div className="space-y-0.5">
            {members.map((member) => {
              const memberTask = member.currentTaskId
                ? (tasks.find((t) => t.id === member.currentTaskId) ?? null)
                : null
              return (
                <MemberDetailRow
                  key={member.id}
                  member={member}
                  task={memberTask}
                  defaultOpen={false}
                  onStop={handleStopMember}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Messages Timeline ── */}
      {(messages.length > 0 || workingMembers.length > 0) && (
        <>
          <Separator />
          <div>
            <SectionHeader
              icon={<MessageSquare className="size-3 text-muted-foreground/50" />}
              label={t('team.messages')}
              count={messages.length || undefined}
            />
            {messages.length > 0 && <MessagesTimeline messages={messages} />}
            {/* Broadcast to all teammates */}
            {workingMembers.length > 0 && <MessageInput targetName="all" />}
          </div>
        </>
      )}
    </div>
  )
}
