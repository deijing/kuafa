/** 智能混剪「核心内容提取」规则（会传给后端 extract_rules） */
export const extractRules: {
  id: string
  label: string
  badge?: string
  checked: boolean
}[] = [
  {
    id: "bargain",
    label: "保留讲价/逼单环节",
    badge: "高转化",
    checked: true,
  },
  {
    id: "detail",
    label: "保留展示产品细节特写",
    checked: true,
  },
  {
    id: "silence",
    label: "去除无声/冗长卡顿片段",
    checked: true,
  },
]
