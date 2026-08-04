export type TabId =
  | "dashboard"
  | "library"
  | "generator"
  | "batch"
  | "cover"
  | "history"

export const TAB_TITLES: Record<TabId, string> = {
  dashboard: "工作台概览",
  library: "素材库管理",
  generator: "AI 智能混剪",
  batch: "批量制作",
  cover: "视频封面生成",
  history: "成片历史",
}

/** 侧边栏路由路径 */
export const TAB_PATHS: Record<TabId, string> = {
  dashboard: "/",
  library: "/library",
  generator: "/generator",
  batch: "/batch",
  cover: "/cover",
  history: "/history",
}

export const PATH_TO_TAB: Record<string, TabId> = {
  "/": "dashboard",
  "/library": "library",
  "/generator": "generator",
  "/batch": "batch",
  "/cover": "cover",
  "/history": "history",
}
