import { useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  CirclePlay,
  Download,
  Info,
  Layers,
  Loader2,
  Music,
  SlidersHorizontal,
  Upload,
  Volume2,
  WandSparkles,
  X,
  XCircle,
  Sparkles,
  ExternalLink,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { extractRules } from "@/data/extract-rules"
import { useMaterials } from "@/hooks/use-materials"
import { useNotifications } from "@/hooks/use-notifications"
import {
  createBatchJobs,
  fetchJob,
  uploadBgm,
  type BgmItem,
  type DurationPreference,
  type Job,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type BatchViewProps = {
  onGoLibrary?: () => void
}

export function BatchView({ onGoLibrary }: BatchViewProps) {
  const { groups, loading } = useMaterials()

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [count, setCount] = useState<"1" | "2" | "3">("1")
  const [duration, setDuration] = useState<DurationPreference>("mid")
  const [addSubtitles, setAddSubtitles] = useState(true)
  const [addBgm, setAddBgm] = useState(true)
  const [bgmVolume, setBgmVolume] = useState(25)
  const [customBgm, setCustomBgm] = useState<BgmItem | null>(null)
  const [uploadingBgm, setUploadingBgm] = useState(false)
  const bgmFileInputRef = useRef<HTMLInputElement>(null)

  const [rules, setRules] = useState<Record<string, boolean>>(
    Object.fromEntries(extractRules.map((r) => [r.id, r.checked]))
  )
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewJobId, setPreviewJobId] = useState<string | null>(null)

  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedGroupIds.includes(g.id)),
    [groups, selectedGroupIds]
  )
  const selectedMaterials = useMemo(
    () => selectedGroups.flatMap((g) => g.materials),
    [selectedGroups]
  )
  const totalClips = selectedMaterials.length
  const perGroupCount = Number(count) as 1 | 2 | 3
  const totalVideos = selectedGroups.length * perGroupCount

  // 默认勾选第一个有素材的组；组列表变化时清掉已不存在的选中项
  useEffect(() => {
    if (!groups.length) {
      setSelectedGroupIds([])
      return
    }
    setSelectedGroupIds((prev) => {
      const valid = prev.filter((id) => groups.some((g) => g.id === id))
      if (valid.length) return valid
      const first = groups.find((g) => g.material_count > 0) ?? groups[0]
      return first ? [first.id] : []
    })
  }, [groups])

  function toggleGroup(groupId: string) {
    if (busy) return
    setSelectedGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    )
  }

  function selectAllGroups() {
    if (busy) return
    setSelectedGroupIds(
      groups.filter((g) => g.material_count > 0).map((g) => g.id)
    )
  }

  function clearGroupSelection() {
    if (busy) return
    setSelectedGroupIds([])
  }

  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "running"
  )
  const allDone =
    jobs.length > 0 &&
    jobs.every((j) => j.status === "succeeded" || j.status === "failed")

  const { notify } = useNotifications()

  useEffect(() => {
    if (!jobs.length || allDone) {
      if (allDone) setBusy(false)
      return
    }
    const timer = window.setInterval(() => {
      void Promise.all(jobs.map((j) => fetchJob(j.id)))
        .then((next) => {
          setJobs(next)
          if (
            next.every((j) => j.status === "succeeded" || j.status === "failed")
          ) {
            setBusy(false)
            const succeededCount = next.filter((j) => j.status === "succeeded").length
            const failedCount = next.filter((j) => j.status === "failed").length

            const firstOk = next.find(
              (j) => j.status === "succeeded" && j.output_url
            )
            if (firstOk) setPreviewJobId(firstOk.id)

            if (succeededCount > 0) {
              notify({
                title: "批量混剪任务完成",
                message: `成功生成 ${succeededCount} 个成片${failedCount > 0 ? `，${failedCount} 个失败` : ""}！`,
                type: "success",
              })
            } else {
              notify({
                title: "批量任务生成失败",
                message: "所有批量合成任务均未成功，请检查素材和配置",
                type: "error",
              })
            }
          }
        })
        .catch(() => {
          /* keep polling */
        })
    }, 800)
    return () => window.clearInterval(timer)
  }, [jobs, allDone, notify])

  async function handleBgmUpload(file: File) {
    setUploadingBgm(true)
    setError(null)
    try {
      const uploaded = await uploadBgm(file)
      setCustomBgm(uploaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传音频失败")
    } finally {
      setUploadingBgm(false)
    }
  }

  async function startBatch() {
    if (!selectedGroups.length) {
      setError("请先勾选至少一个素材组")
      return
    }
    const usable = selectedGroups.filter((g) => g.materials.length > 0)
    if (!usable.length) {
      setError("所选素材组没有素材，请先到素材库上传")
      return
    }
    setError(null)
    setBusy(true)
    setJobs([])
    setPreviewJobId(null)
    try {
      const n = Number(count) as 1 | 2 | 3
      const results = await Promise.all(
        usable.map((group) =>
          createBatchJobs({
            group_id: group.id,
            count: n,
            material_ids: group.materials.map((m) => m.id),
            duration_preference: duration,
            add_captions: addSubtitles,
            add_sfx: addBgm,
            add_subtitles: addSubtitles,
            add_bgm: addBgm,
            bgm_volume: bgmVolume,
            bgm_file: customBgm ? customBgm.filename : null,
            mode: "sell",
            extract_rules: rules,
            title: `${group.name} · 带货成片`,
          })
        )
      )
      setJobs(results.flatMap((r) => r.jobs))
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建批量任务失败")
    }
  }

  const previewJob =
    jobs.find((j) => j.id === previewJobId) ??
    jobs.find((j) => j.status === "succeeded" && j.output_url) ??
    null

  const overallProgress =
    jobs.length === 0
      ? 0
      : Math.round(jobs.reduce((sum, j) => sum + j.progress, 0) / jobs.length)

  return (
    <div className="flex h-full gap-7">
      <Card className="flex h-full w-[380px] shrink-0 flex-col overflow-y-auto rounded-2xl border border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.02),0_10px_15px_-3px_rgba(0,0,0,0.03),0_20px_25px_-5px_rgba(0,0,0,0.02)]">
        <CardHeader className="py-5 px-6 border-b border-[#F3F4F6] dark:border-slate-800">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-[#111827] dark:text-slate-100">
            <SlidersHorizontal className="size-4 text-blue-600" />
            批量成片设置
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-between p-6">
          <div className="flex flex-col">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200">
                  素材组
                </h4>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    className="font-medium text-blue-600 hover:text-blue-700 cursor-pointer disabled:opacity-40"
                    disabled={busy || !groups.some((g) => g.material_count > 0)}
                    onClick={selectAllGroups}
                  >
                    全选
                  </button>
                  <span className="text-[#D1D5DB]">·</span>
                  <button
                    type="button"
                    className="font-medium text-[#9CA3AF] hover:text-[#4B5563] cursor-pointer disabled:opacity-40"
                    disabled={busy || !selectedGroupIds.length}
                    onClick={clearGroupSelection}
                  >
                    清空
                  </button>
                </div>
              </div>
              <p className="mb-3 text-[13px] text-[#9CA3AF] dark:text-slate-400 leading-relaxed">
                可多选素材组；每个组按下方条数各自成片。
              </p>
              <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-1.5">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#9CA3AF]">
                    <Loader2 className="size-3.5 animate-spin" />
                    加载素材组…
                  </div>
                ) : !groups.length ? (
                  <p className="py-6 text-center text-xs text-[#9CA3AF]">
                    暂无素材组，请先到素材库创建
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {groups.map((group) => {
                      const active = selectedGroupIds.includes(group.id)
                      const empty = group.material_count === 0
                      return (
                        <button
                          key={group.id}
                          type="button"
                          disabled={busy || empty}
                          onClick={() => toggleGroup(group.id)}
                          className={cn(
                            "flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left transition-all border",
                            active
                              ? "bg-blue-50/90 dark:bg-blue-950/60 border-blue-100/90 dark:border-blue-900/50 shadow-2xs"
                              : "border-transparent hover:bg-white dark:hover:bg-slate-800/60",
                            empty && "opacity-45 cursor-not-allowed",
                            !empty && !busy && "cursor-pointer"
                          )}
                        >
                          <Checkbox
                            checked={active}
                            disabled={busy || empty}
                            className="mt-0.5 rounded-[4px] border-slate-300 dark:border-slate-600 data-checked:bg-blue-600 data-checked:border-blue-600 pointer-events-none"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={cn(
                                  "truncate text-xs",
                                  active
                                    ? "font-semibold text-blue-900 dark:text-blue-200"
                                    : "font-medium text-slate-700 dark:text-slate-300"
                                )}
                              >
                                {group.name}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                  active
                                    ? "bg-blue-100/90 text-blue-700 dark:bg-blue-900/80 dark:text-blue-200"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                                )}
                              >
                                {group.material_count}
                              </span>
                            </div>
                            <p
                              className={cn(
                                "mt-0.5 truncate text-[11px]",
                                active
                                  ? "text-blue-600/70 dark:text-blue-400/70"
                                  : "text-slate-400 dark:text-slate-500"
                              )}
                              title={group.path}
                            >
                              {group.path}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              {selectedGroups.length ? (
                <p className="mt-2 text-[12px] text-[#9CA3AF]">
                  已选 {selectedGroups.length} 组 · {totalClips} 段素材
                  {totalVideos > 0 ? ` · 将生成 ${totalVideos} 条成片` : ""}
                </p>
              ) : (
                <p className="mt-2 text-[12px] text-[#9CA3AF]">
                  请勾选要批量制作的素材组
                </p>
              )}
            </div>

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-1.5">
                生成条数
              </h4>
              <p className="mb-3 text-[13px] text-[#9CA3AF] dark:text-slate-400 leading-relaxed">
                每个已选素材组各生成这么多条差异化成片，便于抖音 A/B。
              </p>
              <ToggleGroup
                type="single"
                value={count}
                onValueChange={(v) => {
                  if (v === "1" || v === "2" || v === "3") setCount(v)
                }}
                variant="outline"
                className="w-full"
                disabled={busy}
              >
                <ToggleGroupItem value="1" className="flex-1 text-xs">
                  1 条
                </ToggleGroupItem>
                <ToggleGroupItem value="2" className="flex-1 text-xs">
                  2 条
                </ToggleGroupItem>
                <ToggleGroupItem value="3" className="flex-1 text-xs">
                  3 条
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-1.5">
                核心内容提取
              </h4>
              <div className="flex flex-col gap-1">
                {extractRules.map((rule) => (
                  <label
                    key={rule.id}
                    className="flex cursor-pointer items-center justify-between rounded-xl py-2.5 px-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={rules[rule.id]}
                        onCheckedChange={(v) =>
                          setRules((prev) => ({
                            ...prev,
                            [rule.id]: Boolean(v),
                          }))
                        }
                        disabled={busy}
                        className="rounded-[4px] border-slate-300 dark:border-slate-700 data-checked:bg-blue-600 data-checked:border-blue-600"
                      />
                      <span className="text-sm font-medium text-[#4B5563] dark:text-slate-300">
                        {rule.label}
                      </span>
                    </div>
                    {rule.badge ? (
                      <span className="inline-flex items-center rounded-[4px] bg-[rgba(16,185,129,0.1)] dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-[#059669] dark:text-emerald-400 border border-emerald-500/20">
                        {rule.badge}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </div>

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5">
                成片时长偏好（约）
              </h4>
              <Select
                value={duration}
                onValueChange={(v) => setDuration(v as DurationPreference)}
                disabled={busy}
              >
                <SelectTrigger className="w-full text-xs h-10 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200 focus:ring-2 focus:ring-blue-500/20 transition-all">
                  <SelectValue placeholder="选择时长" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="short">抖音短版 (~35秒)</SelectItem>
                    <SelectItem value="mid">标准带货 (~60秒)</SelectItem>
                    <SelectItem value="long">完整讲解 (~90秒)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5">
                字幕 / 音乐 / 画幅
              </h4>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                        口播字幕（烧录）
                      </span>
                      <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                        逐段弹出，每段不超过 10 字、不换行
                      </span>
                  </div>
                  <Switch
                    checked={addSubtitles}
                    onCheckedChange={setAddSubtitles}
                    disabled={busy}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between py-1 px-1">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                        背景音乐
                      </span>
                      <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                        {customBgm
                          ? `音频: ${customBgm.filename}`
                          : "自动匹配热度 BGM 或自定义音频"}
                      </span>
                    </div>
                    <Switch
                      checked={addBgm}
                      onCheckedChange={setAddBgm}
                      disabled={busy}
                    />
                  </div>

                  {addBgm ? (
                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="file"
                          ref={bgmFileInputRef}
                          accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.aac,.flac,.ogg"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) void handleBgmUpload(file)
                            e.target.value = ""
                          }}
                        />

                        {customBgm ? (
                          <div className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-blue-200/80 bg-blue-50/80 px-2.5 py-1.5 dark:border-blue-900/60 dark:bg-blue-950/40">
                            <div className="flex min-w-0 items-center gap-2">
                              <Music className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                              <span className="truncate text-xs font-medium text-blue-700 dark:text-blue-300">
                                {customBgm.filename}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCustomBgm(null)}
                              className="ml-1 rounded p-0.5 text-slate-400 hover:bg-blue-100 hover:text-slate-600 cursor-pointer dark:hover:bg-blue-900"
                              title="移除自定义音乐"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingBgm || busy}
                            onClick={() => bgmFileInputRef.current?.click()}
                            className="w-full h-8 text-xs font-medium border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 cursor-pointer shadow-2xs"
                          >
                            {uploadingBgm ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin text-blue-600" />
                            ) : (
                              <Upload className="mr-1.5 size-3.5 text-blue-600" />
                            )}
                            {uploadingBgm ? "上传中…" : "上传自定义 BGM"}
                          </Button>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-[#4B5563] dark:text-slate-300">
                            <Volume2 className="size-3.5 text-slate-400" />
                            音乐音量
                          </span>
                          <span className="font-bold font-mono text-blue-600 dark:text-blue-400">
                            {bgmVolume}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={bgmVolume}
                          disabled={busy}
                          onChange={(e) => setBgmVolume(Number(e.target.value))}
                          className="h-1.5 w-full cursor-pointer rounded-lg bg-slate-200 dark:bg-slate-700 accent-blue-600"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3.5 text-[13px] text-[#4B5563] dark:text-slate-300 leading-relaxed flex items-start gap-2.5">
                  <Info className="size-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    输出固定{" "}
                    <strong className="text-[#111827] dark:text-slate-100 font-semibold">
                      9:16 · 1080×1920
                    </strong>
                    。AI 全程介入：必剪 ASR → DeepSeek 主观选句 → 自动剪辑；成片带 ≤10
                    字字幕与神奇大字动效。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6">
            {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}

            <Button
              className="h-11 w-full rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium text-sm shadow-[0_4px_14px_0_rgba(37,99,235,0.35)] transition-all active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2"
              disabled={busy || !selectedGroups.length || totalClips === 0}
              onClick={() => void startBatch()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <WandSparkles className="size-4" />
              )}
              {busy
                ? `批量处理中… ${overallProgress}%`
                : totalVideos > 0
                  ? `一键成片 · ${selectedGroups.length} 组 × ${count} 条`
                  : "一键成片"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card className="flex flex-col border border-black/[0.04] dark:border-slate-800 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)] bg-white dark:bg-slate-900 rounded-2xl">
          <CardHeader className="py-4 px-6 border-b border-[#F3F4F6] dark:border-slate-800 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-[#111827] dark:text-slate-100">
              {selectedGroups.length
                ? `已选 ${selectedGroups.length} 组 · ${totalClips} 段素材`
                : "勾选素材组后预览素材"}
            </CardTitle>
            <button
              type="button"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer transition-colors"
              onClick={onGoLibrary}
            >
              去素材库管理
            </button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5 p-5">
            <div className="relative flex items-center overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 p-4">
              <div className="flex h-20 min-w-max items-center gap-3">
                {selectedMaterials.length ? (
                  selectedMaterials.map((clip, index) => (
                    <div
                      key={clip.id}
                      className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-slate-200 shadow-2xs"
                      title={`${clip.group_name} · ${clip.filename}`}
                    >
                      {clip.thumb_url ? (
                        <img
                          src={clip.thumb_url}
                          alt=""
                          className="absolute inset-0 size-full object-cover opacity-90"
                        />
                      ) : null}
                      <span className="absolute bottom-1 left-1 rounded bg-[#111827]/80 px-1.5 py-0.5 text-[9px] font-bold font-mono text-white">
                        {index + 1}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center gap-2 py-4 text-xs text-[#9CA3AF]">
                    <Layers className="size-4 text-[#9CA3AF]" />
                    <span>请勾选一个或多个素材组，即可一键批量成片。</span>
                  </div>
                )}
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-[13px] text-[#9CA3AF]">
              <Info className="size-3.5 text-[#9CA3AF] shrink-0" />
              每个素材组独立成片；多条会自动换句序与结构侧重，避免内容完全重复。
            </p>
          </CardContent>
        </Card>

        {jobs.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job, index) => {
              const done = job.status === "succeeded"
              const failed = job.status === "failed"
              const active = job.status === "queued" || job.status === "running"
              const selected = previewJobId === job.id
              const groupName =
                groups.find((g) => g.id === job.group_id)?.name ?? "成片"
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => {
                    if (done && job.output_url) setPreviewJobId(job.id)
                  }}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-all",
                    selected
                      ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/30"
                      : "border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900",
                    done && "cursor-pointer hover:border-blue-400",
                    !done && "cursor-default"
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="truncate text-sm font-semibold text-[#111827] dark:text-slate-100">
                      {groupName}
                      <span className="ml-1.5 font-mono text-[11px] font-medium text-[#9CA3AF]">
                        #{index + 1}
                      </span>
                    </span>
                    {done ? (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    ) : failed ? (
                      <XCircle className="size-4 text-rose-500" />
                    ) : (
                      <Loader2 className="size-4 animate-spin text-blue-600" />
                    )}
                  </div>
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        failed
                          ? "bg-rose-500"
                          : done
                            ? "bg-emerald-500"
                            : "bg-blue-600"
                      )}
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <p className="text-[12px] text-[#9CA3AF] line-clamp-2">
                    {failed
                      ? job.error || "失败"
                      : active
                        ? job.message || "处理中…"
                        : done
                          ? `完成 · ${job.duration ? `${Math.round(job.duration)}秒` : "可预览"}`
                          : job.message}
                  </p>
                  {done ? (
                    <a
                      href={`/api/jobs/${job.id}/download`}
                      download
                      onClick={(e) => e.stopPropagation()}
                      className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-blue-600 hover:text-blue-700"
                    >
                      <Download className="size-3.5" />
                      下载
                    </a>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)]">
          {busy && activeJobs.length > 0 && !previewJob?.output_url ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
              <div className="mb-4 text-4xl font-bold font-mono text-[#111827] dark:text-slate-100 tracking-tight">
                {overallProgress}%
              </div>
              <Loader2 className="mb-3 size-8 animate-spin text-blue-600" />
              <p className="text-sm font-medium text-[#111827] dark:text-slate-100">
                正在批量生成 {jobs.length} 条成片…
              </p>
              <p className="mt-2 text-xs text-[#9CA3AF]">
                ASR 转写 → AI 选句 → 9:16 剪辑拼接 → 字幕/BGM
              </p>
            </div>
          ) : null}

          {previewJob?.output_url ? (
            <div className="absolute inset-0 z-30 flex flex-col md:flex-row bg-slate-950 rounded-2xl overflow-hidden">
              <div className="relative flex flex-1 items-center justify-center bg-black">
                <video
                  key={previewJob.output_url}
                  src={previewJob.output_url}
                  controls
                  className="size-full max-h-[85vh] object-contain"
                />
                <div className="absolute right-4 bottom-4 z-10">
                  <Button
                    asChild
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg rounded-xl"
                  >
                    <a href={`/api/jobs/${previewJob.id}/download`} download>
                      <Download className="mr-1.5 size-3.5" />
                      下载当前成片
                    </a>
                  </Button>
                </div>
              </div>

              {previewJob?.covers && previewJob.covers.length > 0 && (
                <div className="w-full md:w-[280px] shrink-0 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900/95 p-4 flex flex-col overflow-y-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="size-4 text-amber-400 shrink-0" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">
                        基于本切片卖点生成的封面
                      </h4>
                      {previewJob.headline && (
                        <p className="text-[11px] text-slate-400 truncate max-w-[200px]">
                          文案：「{previewJob.headline}」
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-1 gap-3 flex-1 overflow-y-auto">
                    {previewJob.covers.map((cover, idx) => (
                      <div
                        key={cover.id}
                        className="group relative flex flex-col rounded-xl border border-slate-800 bg-slate-950 p-2 transition-all hover:border-blue-500"
                      >
                        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-slate-900">
                          <img
                            src={cover.url}
                            alt=""
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-1">
                          <span className="text-[10px] font-medium text-slate-400">
                            封面 #{idx + 1}
                          </span>
                          <div className="flex items-center gap-1">
                            <a
                              href={cover.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 text-slate-400 hover:text-slate-200 text-[10px] flex items-center gap-0.5"
                              title="新窗口预览"
                            >
                              <ExternalLink className="size-3" />
                            </a>
                            <a
                              href={cover.url}
                              download={`cover_${idx + 1}`}
                              className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="size-2.5" />
                              下载
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {!busy && !previewJob?.output_url && jobs.every((j) => j.status !== "failed") ? (
            <div className="z-10 flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <div className="relative mb-5 flex size-20 items-center justify-center rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/40 shadow-xs">
                <CirclePlay className="size-10 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="mb-2 text-base font-semibold text-[#111827] dark:text-slate-100 tracking-tight">
                批量成片预览区
              </h3>
              <p className="text-[13px] text-[#4B5563] dark:text-slate-400 leading-relaxed max-w-[280px]">
                勾选一个或多个素材组后，点击左侧{" "}
                <span className="text-blue-600 dark:text-blue-400 font-medium">
                  「一键成片」
                </span>
                ，系统将自动产出可发布的抖音带货视频
              </p>
            </div>
          ) : null}

          {!busy &&
          jobs.length > 0 &&
          jobs.every((j) => j.status === "failed") ? (
            <div className="z-10 px-6 text-center">
              <p className="mb-2 text-sm font-semibold text-rose-600">
                全部成片失败
              </p>
              <p className="text-xs text-[#4B5563]">
                {jobs[0]?.error || "请检查素材与 ASR 配置后重试"}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
