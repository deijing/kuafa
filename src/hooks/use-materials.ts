import { createContext, useContext } from "react"
import type { LibrarySettings, Material, MaterialGroup } from "@/lib/api"

export type MaterialsContextValue = {
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

export function useMaterials() {
  const ctx = useContext(MaterialsContext)
  if (!ctx) {
    throw new Error("useMaterials must be used within MaterialsProvider")
  }
  return ctx
}

export { MaterialsContext }
