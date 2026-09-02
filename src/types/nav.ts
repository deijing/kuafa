export type TabId =
  | "dashboard"
  | "library"
  | "bgm"
  | "generator"
  | "material-cut"
  | "batch"
  | "cover"
  | "history"

export const TAB_TITLES: Record<TabId, string> = {
  dashboard: "工作台概览",
  library: "素材库管理",
  bgm: "背景音乐库",
  generator: "AI 智能混剪",
  "material-cut": "按素材分切拼接",
  batch: "批量制作",
  cover: "视频封面生成",
  history: "成片历史",
}

/** 侧边栏路由路径 */
export const TAB_PATHS: Record<TabId, string> = {
  dashboard: "/",
  library: "/library",
  bgm: "/bgm",
  generator: "/generator",
  "material-cut": "/material-cut",
  batch: "/batch",
  cover: "/cover",
  history: "/history",
}

export const PATH_TO_TAB: Record<string, TabId> = {
  "/": "dashboard",
  "/library": "library",
  "/bgm": "bgm",
  "/generator": "generator",
  "/material-cut": "material-cut",
  "/batch": "batch",
  "/cover": "cover",
  "/history": "history",
}

