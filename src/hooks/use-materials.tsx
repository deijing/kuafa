import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  createGroup as apiCreateGroup,
  fetchGroups,
  fetchLibrarySettings,
  renameGroup as apiRenameGroup,
  resetLibrarySettings,
  updateLibrarySettings,
  uploadMaterial,
  type LibrarySettings,
  type Material,
  type MaterialGroup,
} from "@/lib/api"

type MaterialsContextValue = {
  groups: MaterialGroup[]
  materials: Material[]
  selectedIds: string[]
  activeGroupId: string | null
  settings: LibrarySettings | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setActiveGroupId: (id: string | null) => void
  toggleSelect: (id: string) => void
  selectGroup: (groupId: string) => void
  selectAll: () => void
  clearSelection: () => void
  createGroup: (name: string) => Promise<void>
  renameGroup: (groupId: string, name: string) => Promise<void>
  upload: (file: File, groupId?: string) => Promise<void>
  saveMaterialsDir: (dir: string) => Promise<void>
  resetMaterialsDir: () => Promise<void>
}

const MaterialsContext = createContext<MaterialsContextValue | null>(null)

export function MaterialsProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<MaterialGroup[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const materials = useMemo(
    () => groups.flatMap((g) => g.materials),
    [groups]
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, lib] = await Promise.all([
        fetchGroups(),
        fetchLibrarySettings(),
      ])
      setGroups(list)
      setSettings(lib)
      setActiveGroupId((prev) => {
        if (prev && list.some((g) => g.id === prev)) return prev
        return list[0]?.id ?? null
      })
      setSelectedIds((prev) => {
        const valid = new Set(list.flatMap((g) => g.materials.map((m) => m.id)))
        const kept = prev.filter((id) => valid.has(id))
        if (kept.length) return kept
        // default: select first group's materials
        return list[0]?.materials.map((m) => m.id) ?? []
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载素材失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }, [])

  const selectGroup = useCallback(
    (groupId: string) => {
      const group = groups.find((g) => g.id === groupId)
      if (!group) return
      setActiveGroupId(groupId)
      setSelectedIds(group.materials.map((m) => m.id))
    },
    [groups]
  )

  const selectAll = useCallback(() => {
    const group = groups.find((g) => g.id === activeGroupId)
    if (group) {
      setSelectedIds(group.materials.map((m) => m.id))
      return
    }
    setSelectedIds(materials.map((m) => m.id))
  }, [activeGroupId, groups, materials])

  const clearSelection = useCallback(() => {
    setSelectedIds([])
  }, [])

  const createGroup = useCallback(
    async (name: string) => {
      const group = await apiCreateGroup(name)
      await refresh()
      setActiveGroupId(group.id)
    },
    [refresh]
  )

  const renameGroup = useCallback(
    async (groupId: string, name: string) => {
      await apiRenameGroup(groupId, name)
      await refresh()
    },
    [refresh]
  )

  const upload = useCallback(
    async (file: File, groupId?: string) => {
      const target = groupId ?? activeGroupId
      if (!target) {
        throw new Error("请先创建或选择一个素材组")
      }
      await uploadMaterial(file, target)
      await refresh()
    },
    [activeGroupId, refresh]
  )

  const saveMaterialsDir = useCallback(
    async (dir: string) => {
      await updateLibrarySettings(dir)
      await refresh()
    },
    [refresh]
  )

  const resetMaterialsDirFn = useCallback(async () => {
    await resetLibrarySettings()
    await refresh()
  }, [refresh])

  const value = useMemo(
    () => ({
      groups,
      materials,
      selectedIds,
      activeGroupId,
      settings,
      loading,
      error,
      refresh,
      setActiveGroupId,
      toggleSelect,
      selectGroup,
      selectAll,
      clearSelection,
      createGroup,
      renameGroup,
      upload,
      saveMaterialsDir,
      resetMaterialsDir: resetMaterialsDirFn,
    }),
    [
      groups,
      materials,
      selectedIds,
      activeGroupId,
      settings,
      loading,
      error,
      refresh,
      toggleSelect,
      selectGroup,
      selectAll,
      clearSelection,
      createGroup,
      renameGroup,
      upload,
      saveMaterialsDir,
      resetMaterialsDirFn,
    ]
  )

  return (
    <MaterialsContext.Provider value={value}>{children}</MaterialsContext.Provider>
  )
}

export function useMaterials() {
  const ctx = useContext(MaterialsContext)
  if (!ctx) {
    throw new Error("useMaterials must be used within MaterialsProvider")
  }
  return ctx
}
