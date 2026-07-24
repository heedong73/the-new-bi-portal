import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

import type { GroupResponse, UserListItem } from '@/types/admin'

interface PickerItem {
  id: number
  label: string
  description?: string
  searchText: string
}

interface SearchablePickerProps {
  items: PickerItem[]
  value: number | null
  onChange: (id: number | null) => void
  placeholder: string
  ariaLabel: string
  emptyText: string
  disabled?: boolean
  loading?: boolean
  className?: string
  inputClassName?: string
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ko')
}

function SearchablePicker({
  items,
  value,
  onChange,
  placeholder,
  ariaLabel,
  emptyText,
  disabled = false,
  loading = false,
  className = '',
  inputClassName = '',
}: SearchablePickerProps) {
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = items.find((item) => item.id === value)
  const term = normalize(query)
  const filtered = useMemo(
    () => (term ? items.filter((item) => normalize(item.searchText).includes(term)) : items),
    [items, term],
  )
  const visibleItems = filtered.slice(0, 100)

  function close() {
    setOpen(false)
    setQuery('')
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      event.currentTarget.blur()
    }
  }

  return (
    <div className={`relative ${className}`} onBlur={handleBlur}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        disabled={disabled}
        value={open ? query : selected?.label ?? ''}
        placeholder={loading ? '불러오는 중…' : placeholder}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          if (value !== null) onChange(null)
          setQuery(event.target.value)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        className={`w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-14 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400 ${inputClassName}`}
      />
      {value !== null && !disabled ? (
        <button
          type="button"
          aria-label={`${ariaLabel} 선택 해제`}
          onClick={() => {
            onChange(null)
            setQuery('')
            setOpen(true)
          }}
          className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
        >
          {loading ? (
            <p className="px-3 py-3 text-center text-xs text-slate-400">불러오는 중…</p>
          ) : visibleItems.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-slate-400">{emptyText}</p>
          ) : (
            <>
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === value}
                  onClick={() => {
                    onChange(item.id)
                    close()
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-blue-50 ${
                    item.id === value ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                  }`}
                >
                  <span className="min-w-0 truncate text-sm font-medium">{item.label}</span>
                  {item.description && (
                    <span className="shrink-0 truncate text-xs text-slate-400">{item.description}</span>
                  )}
                </button>
              ))}
              {filtered.length > visibleItems.length && (
                <p className="px-2.5 py-2 text-center text-xs text-slate-400">
                  {filtered.length - visibleItems.length}개가 더 있습니다. 검색어를 입력해 좁혀 주세요.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface EntityPickerBaseProps {
  value: number | null
  onChange: (id: number | null) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  loading?: boolean
  className?: string
  inputClassName?: string
}

interface UserPickerProps extends EntityPickerBaseProps {
  users: UserListItem[]
}

export function UserPicker({
  users,
  placeholder = '사용자 검색…',
  ariaLabel = '사용자 선택',
  ...props
}: UserPickerProps) {
  const items = useMemo<PickerItem[]>(
    () => users.map((user) => ({
      id: user.id,
      label: `${user.name} (${user.emp_no})`,
      description: user.department_name ?? user.email ?? undefined,
      searchText: [user.name, user.emp_no, user.email, user.department_name].filter(Boolean).join(' '),
    })),
    [users],
  )

  return (
    <SearchablePicker
      {...props}
      items={items}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      emptyText="검색 조건에 맞는 사용자가 없습니다."
    />
  )
}

interface GroupPickerProps extends EntityPickerBaseProps {
  groups: Pick<GroupResponse, 'id' | 'name'>[]
}

export function GroupPicker({
  groups,
  placeholder = '그룹 검색…',
  ariaLabel = '그룹 선택',
  ...props
}: GroupPickerProps) {
  const items = useMemo<PickerItem[]>(
    () => groups.map((group) => ({
      id: group.id,
      label: group.name,
      searchText: group.name,
    })),
    [groups],
  )

  return (
    <SearchablePicker
      {...props}
      items={items}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      emptyText="검색 조건에 맞는 그룹이 없습니다."
    />
  )
}
